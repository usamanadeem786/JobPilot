import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Test environment bootstrap.
 *
 * Unit tests must not need a running database or a hand-maintained .env, so
 * every required variable gets a deterministic default here. Integration tests
 * override `DATABASE_URL` via `TEST_DATABASE_URL` and skip themselves when no
 * database is reachable — see `test/db.ts`.
 */
loadEnv({ path: resolve(__dirname, '../../../.env'), override: false });

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  API_PORT: '4001',
  API_GLOBAL_PREFIX: 'api',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://jobpilot:jobpilot@localhost:5432/jobpilot?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-1234567890',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-0987654321',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  // 32 zero bytes, base64. Test-only: never used outside this process.
  ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  LLM_PROVIDER: 'mock',
  STORAGE_DRIVER: 'local',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

// Always force these, even when a developer .env says otherwise: request logs
// from pino-http would otherwise bury the test reporter's output.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
