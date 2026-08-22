import { Injectable, Logger } from '@nestjs/common';
import {
  type AuthSession,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@jobpilot/shared';
import { isUniqueConstraintViolation, type User } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { AuditAction, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService, type IssueContext, type IssuedTokens } from './token.service';

export interface AuthResult {
  readonly session: AuthSession;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

type UserWithProfile = User & { profile: { fullName: string } | null };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, context: IssueContext = {}): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(input.password);

    let user: UserWithProfile;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          profile: { create: { fullName: input.fullName } },
        },
        include: { profile: { select: { fullName: true } } },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'email')) {
        throw AppException.conflict('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }

    const issued = await this.tokens.issue(
      { id: user.id, email: user.email, role: user.role },
      context,
    );

    await this.audit.record({
      action: AuditAction.UserRegistered,
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    this.logger.log({ userId: user.id }, 'User registered');
    return this.toAuthResult(user, issued);
  }

  async login(input: LoginInput, context: IssueContext = {}): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: { select: { fullName: true } } },
    });

    // Same failure and roughly the same cost whether the email is unknown or
    // the password is wrong, so the endpoint cannot be used to enumerate users.
    if (!user || !user.passwordHash) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record({
        action: AuditAction.UserLoginFailed,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'unknown_account' },
      });
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      await this.audit.record({
        action: AuditAction.UserLoginFailed,
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'bad_password' },
      });
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    if (user.status !== 'ACTIVE') {
      throw AppException.forbidden('ACCOUNT_SUSPENDED');
    }

    // Transparently upgrade hashes written under older Argon2 parameters.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const rehashed = await this.passwords.hash(input.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: rehashed },
      });
    }

    const issued = await this.tokens.issue(
      { id: user.id, email: user.email, role: user.role },
      context,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.UserLoggedIn,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toAuthResult(user, issued);
  }

  async refresh(presentedToken: string, context: IssueContext = {}): Promise<AuthResult> {
    const issued = await this.tokens.rotate(presentedToken, context);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: issued.userId },
      include: { profile: { select: { fullName: true } } },
    });

    await this.audit.record({
      action: AuditAction.TokenRefreshed,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toAuthResult(user, issued);
  }

  async logout(presentedToken: string | undefined, userId?: string): Promise<void> {
    if (presentedToken) {
      await this.tokens.revoke(presentedToken);
    }
    if (userId) {
      await this.audit.record({ action: AuditAction.UserLoggedOut, userId });
    }
  }

  async logoutEverywhere(userId: string): Promise<{ revoked: number }> {
    const revoked = await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      action: AuditAction.UserLoggedOut,
      userId,
      metadata: { scope: 'all_devices', revoked },
    });
    return { revoked };
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw AppException.badRequest('INVALID_CREDENTIALS');
    }

    const valid = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!valid) {
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // A password change ends every other session; the device that made the
    // change gets a fresh pair from the client immediately afterwards.
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({ action: AuditAction.PasswordChanged, userId });
  }

  toAuthUser(user: UserWithProfile): AuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      fullName: user.profile?.fullName ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toAuthResult(user: UserWithProfile, issued: IssuedTokens): AuthResult {
    return {
      session: { user: this.toAuthUser(user), tokens: issued.tokens },
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt,
    };
  }
}
