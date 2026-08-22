import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/modules/prisma/prisma.service';

export interface Harness {
  readonly app: INestApplication;
  readonly prisma: PrismaService;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /**
   * Rate limiting is off by default: a test file makes far more requests from
   * one address than a real user ever would, and every suite would otherwise
   * turn into a 429 test. `rate-limit.e2e.test.ts` turns it back on and is the
   * one place the limiter itself is asserted.
   */
  readonly throttling?: boolean;
}

/**
 * Boots the real application — same modules, same guards, same middleware as
 * production — against the configured test database. Integration tests that
 * stub the HTTP layer tend to pass while the deployed app 401s, so this
 * deliberately exercises the whole stack.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  // Read once at module creation by the ENV provider, so it must be set before
  // compile(). Vitest isolates each test file in its own worker, so this does
  // not leak between suites.
  process.env.THROTTLE_ENABLED = options.throttling ? 'true' : 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    async close() {
      await app.close();
    },
  };
}

/**
 * True when the configured database accepts connections. Integration tests
 * skip themselves rather than fail when no database is running, so `pnpm test`
 * stays useful on a machine with nothing else started.
 */
export async function isDatabaseReachable(): Promise<boolean> {
  const { PrismaClient } = await import('@jobpilot/database');
  const client = new PrismaClient();
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

/** Unique per run, so parallel test files never collide on the email index. */
export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}+${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@jobpilot.test`;
}
