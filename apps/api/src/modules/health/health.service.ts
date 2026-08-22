import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

export interface LivenessResult {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  readonly status: 'ok' | 'degraded';
  readonly dependencies: Record<string, { status: DependencyStatus; detail?: string }>;
  readonly timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  liveness(): LivenessResult {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResult> {
    const dependencies: Record<string, { status: DependencyStatus; detail?: string }> = {};

    try {
      await this.prisma.ping();
      dependencies.database = { status: 'up' };
    } catch (error) {
      this.logger.error({ err: error }, 'Database readiness check failed');
      dependencies.database = { status: 'down', detail: 'Database is not reachable.' };
    }

    // Redis is wired in Phase 3 alongside BullMQ. Nothing connects to it yet,
    // so an absent URL is reported for visibility but must not make the
    // instance unready — that would take a perfectly serviceable deployment
    // out of rotation over an unused dependency.
    dependencies.redis = this.env.REDIS_URL
      ? { status: 'up', detail: 'Configured; the queue module connects in Phase 3.' }
      : { status: 'up', detail: 'Not configured. Required from Phase 3 onwards.' };

    const allUp = Object.values(dependencies).every((dep) => dep.status === 'up');
    return {
      status: allUp ? 'ok' : 'degraded',
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }
}
