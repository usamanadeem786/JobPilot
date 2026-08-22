import { Injectable } from '@nestjs/common';
import type { AuthUser, UpdateProfileInput, UserProfileDto } from '@jobpilot/shared';
import type { Prisma, UserProfile } from '@jobpilot/database';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppException } from '../../common/errors/app-exception';
import { AuditAction, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  async getAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: { select: { fullName: true } } },
    });
    if (!user) throw AppException.notFound('NOT_FOUND', 'That account no longer exists.');

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

  async getProfile(userId: string): Promise<UserProfileDto> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) throw AppException.notFound('NOT_FOUND', 'No profile exists for this account.');
    return this.toDto(profile);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfileDto> {
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!existing) throw AppException.notFound('NOT_FOUND', 'No profile exists for this account.');

    const data: Prisma.UserProfileUpdateInput = {};

    // Only fields actually present in the request are written, so a partial
    // update from one screen cannot blank out fields owned by another.
    assignIfPresent(data, input, 'fullName');
    assignIfPresent(data, input, 'headline');
    assignIfPresent(data, input, 'locationCity');
    assignIfPresent(data, input, 'locationCountry');
    assignIfPresent(data, input, 'timezone');
    assignIfPresent(data, input, 'yearsExperience');
    assignIfPresent(data, input, 'desiredRoles');
    assignIfPresent(data, input, 'desiredLocations');
    assignIfPresent(data, input, 'remotePreference');
    assignIfPresent(data, input, 'minSalary');
    assignIfPresent(data, input, 'salaryCurrency');
    assignIfPresent(data, input, 'skills');
    assignIfPresent(data, input, 'linkedinUrl');
    assignIfPresent(data, input, 'githubUrl');
    assignIfPresent(data, input, 'portfolioUrl');

    if (input.phone !== undefined) {
      data.phone = input.phone ? this.encryption.encrypt(input.phone) : null;
    }

    const updated = await this.prisma.userProfile.update({ where: { userId }, data });

    await this.audit.record({
      action: AuditAction.ProfileUpdated,
      userId,
      entityType: 'UserProfile',
      entityId: updated.id,
      metadata: { fields: Object.keys(data) },
    });

    return this.toDto(updated);
  }

  private toDto(profile: UserProfile): UserProfileDto {
    return {
      id: profile.id,
      fullName: profile.fullName,
      headline: profile.headline,
      phone: this.encryption.tryDecrypt(profile.phone),
      locationCity: profile.locationCity,
      locationCountry: profile.locationCountry,
      timezone: profile.timezone,
      yearsExperience: profile.yearsExperience,
      desiredRoles: profile.desiredRoles,
      desiredLocations: profile.desiredLocations,
      remotePreference: profile.remotePreference,
      minSalary: profile.minSalary,
      salaryCurrency: profile.salaryCurrency,
      skills: profile.skills,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}

/** Copies a key only when the caller actually sent it. */
function assignIfPresent<K extends keyof UpdateProfileInput & keyof Prisma.UserProfileUpdateInput>(
  target: Prisma.UserProfileUpdateInput,
  source: UpdateProfileInput,
  key: K,
): void {
  const value = source[key];
  if (value === undefined) return;
  (target as Record<string, unknown>)[key] = value;
}
