import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AccessTokenPayload, AuthTokens, RefreshTokenPayload, Role } from '@jobpilot/shared';
import { AppException } from '../../common/errors/app-exception';
import { hashToken } from '../../common/crypto/encryption.service';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditService } from '../audit/audit.service';

export interface TokenSubject {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

export interface IssueContext {
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

export interface IssuedTokens {
  readonly tokens: AuthTokens;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  /** Primary key of the stored refresh-token row (equals the token's `jti`). */
  readonly refreshTokenId: string;
  readonly userId: string;
}

/**
 * Issues and rotates the token pair.
 *
 * Refresh tokens are single-use and belong to a *family*: rotating one revokes
 * it and issues a successor in the same family. If a token that was already
 * rotated is presented again, the only plausible explanations are theft or a
 * cloned client, so the entire family is revoked and the user must sign in
 * again. Only SHA-256 hashes are stored, so a database leak does not hand an
 * attacker usable sessions.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Records a detected replay.
   *
   * Token reuse is the strongest signal available that a refresh token has
   * been stolen, so it belongs in the audit trail and not only in the
   * application log: the audit table is the queryable, retained record, and
   * an incident review reads that rather than grepping stdout.
   */
  private async auditReuse(
    userId: string,
    familyId: string,
    detail: string,
    context: IssueContext,
  ): Promise<void> {
    await this.audit.record({
      action: AuditAction.TokenReuseDetected,
      userId,
      entityType: 'RefreshTokenFamily',
      entityId: familyId,
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      metadata: { detail },
    });
  }

  async issue(subject: TokenSubject, context: IssueContext = {}): Promise<IssuedTokens> {
    return this.createPair(subject, randomUUID(), context);
  }

  /**
   * Validates a presented refresh token and returns a fresh pair.
   * Throws TOKEN_REUSE_DETECTED (and kills the family) on replay.
   */
  async rotate(presentedToken: string, context: IssueContext = {}): Promise<IssuedTokens> {
    const payload = await this.verifyRefreshToken(presentedToken);
    const tokenHash = hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      // A signature-valid token we have never stored means the row was pruned
      // or the token was forged with a leaked secret. Either way: reject.
      throw AppException.unauthorized('TOKEN_EXPIRED');
    }

    if (stored.revokedAt) {
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'Refresh token reuse detected; revoking token family',
      );
      await this.revokeFamily(stored.familyId);
      await this.auditReuse(
        stored.userId,
        stored.familyId,
        'A refresh token that had already been rotated was presented again.',
        context,
      );
      throw AppException.unauthorized('TOKEN_REUSE_DETECTED');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized('TOKEN_EXPIRED');
    }

    if (stored.user.status !== 'ACTIVE') {
      await this.revokeFamily(stored.familyId);
      throw AppException.forbidden('ACCOUNT_SUSPENDED');
    }

    // Compare-and-swap: only the request that flips `revokedAt` may mint a
    // successor. Two concurrent uses of the same token cannot both win, so a
    // replayed token is caught even under a race.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claimed.count !== 1) {
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'Concurrent use of a single refresh token; revoking token family',
      );
      await this.revokeFamily(stored.familyId);
      await this.auditReuse(
        stored.userId,
        stored.familyId,
        'The same refresh token was used by two concurrent requests.',
        context,
      );
      throw AppException.unauthorized('TOKEN_REUSE_DETECTED');
    }

    const next = await this.createPair(
      { id: stored.user.id, email: stored.user.email, role: stored.user.role },
      payload.fid,
      context,
    );

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: next.refreshTokenId },
    });

    return next;
  }

  /** Revokes a single presented token (sign-out on this device). */
  async revoke(presentedToken: string): Promise<void> {
    const tokenHash = hashToken(presentedToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live token for a user (sign-out everywhere). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw AppException.unauthorized('TOKEN_EXPIRED');
    }
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw AppException.unauthorized('TOKEN_EXPIRED');
    }
  }

  private async createPair(
    subject: TokenSubject,
    familyId: string,
    context: IssueContext,
  ): Promise<IssuedTokens> {
    const jti = randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: subject.id, email: subject.email, role: subject.role },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: subject.id, jti, fid: familyId },
      { secret: this.env.JWT_REFRESH_SECRET, expiresIn: this.env.JWT_REFRESH_TTL },
    );

    const decoded = this.jwt.decode<RefreshTokenPayload>(refreshToken);
    const refreshExpiresAt = new Date(decoded.exp * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId: subject.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
      },
    });

    const accessPayload = this.jwt.decode<AccessTokenPayload>(accessToken);

    return {
      tokens: {
        accessToken,
        expiresIn: Math.max(0, accessPayload.exp - Math.floor(Date.now() / 1000)),
        tokenType: 'Bearer',
      },
      refreshToken,
      refreshExpiresAt,
      refreshTokenId: jti,
      userId: subject.id,
    };
  }

  /** Housekeeping: drops rows that can no longer authenticate anyone. */
  async pruneExpired(olderThan: Date = new Date()): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: olderThan } },
    });
    return result.count;
  }
}
