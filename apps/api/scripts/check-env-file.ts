/**
 * Validates a .env file against the API's own schema, without starting it.
 *
 * A deployment that boots and immediately exits on a missing variable is the
 * slowest possible way to discover a typo. This runs the exact same validation
 * the API runs at startup, against a file you are about to paste into a host.
 *
 *   pnpm --filter @jobpilot/api env:check -- <path-to-env-file>
 */
import { readFileSync } from 'node:fs';
import { validateEnv } from '../src/config/env.schema';

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    values[key] = value;
  }

  return values;
}

function main(): void {
  const path = process.argv.slice(2).find((argument) => argument !== '--');
  if (!path) {
    console.error('Usage: env:check -- <path-to-env-file>');
    process.exit(1);
  }

  const parsed = parseEnvFile(readFileSync(path, 'utf8'));

  try {
    const env = validateEnv(parsed);
    console.log(`${path} is valid.\n`);
    console.log(`  NODE_ENV        ${env.NODE_ENV}`);
    console.log(`  storage driver  ${env.STORAGE_DRIVER}`);
    console.log(`  LLM provider    ${env.LLM_PROVIDER}`);
    console.log(`  cookie SameSite ${env.COOKIE_SAMESITE}`);
    console.log(`  CORS origins    ${env.CORS_ORIGINS.join(', ') || '(none)'}`);
    console.log(`  job sources     greenhouse=${env.GREENHOUSE_BOARD_TOKENS.length} lever=${env.LEVER_COMPANY_SLUGS.length}`);
  } catch (error) {
    console.error(`${path} is NOT valid:\n`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
