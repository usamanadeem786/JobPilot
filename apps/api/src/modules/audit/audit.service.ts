import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@jobpilot/database';
import { PrismaService } from '../prisma/prisma.service';

/** Actions worth keeping a durable record of. Extended as phases land. */
export const AuditAction = {
  UserRegistered: 'user.registered',
  UserLoggedIn: 'user.logged_in',
  UserLoginFailed: 'user.login_failed',
  UserLoggedOut: 'user.logged_out',
  TokenRefreshed: 'auth.token_refreshed',
  TokenReuseDetected: 'auth.token_reuse_detected',
  PasswordChanged: 'user.password_changed',
  ProfileUpdated: 'user.profile_updated',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  readonly action: AuditAction;
  readonly userId?: string | null;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only audit trail.
 *
 * Recording is best-effort by design: an audit write must never turn a
 * successful user action into a failed request. Failures are logged loudly so
 * a broken trail is still visible in monitoring.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          userId: entry.userId ?? null,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          requestId: entry.requestId ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: entry.metadata ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit log entry');
    }
  }
}
