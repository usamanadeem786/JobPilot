import { describe, expect, it } from 'vitest';
import { resolvePort, validateEnv } from './env.schema';

const VALID: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = validateEnv({ ...VALID });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.RESPECT_ROBOTS_TXT).toBe(true);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses comma-separated lists and trims blanks', () => {
    const env = validateEnv({
      ...VALID,
      CORS_ORIGINS: 'http://localhost:3000, https://app.example.com ,',
      GREENHOUSE_BOARD_TOKENS: 'acme, globex',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(env.GREENHOUSE_BOARD_TOKENS).toEqual(['acme', 'globex']);
  });

  it('rejects the placeholder secrets shipped in .env.example', () => {
    expect(() =>
      validateEnv({ ...VALID, JWT_ACCESS_SECRET: 'replace-with-a-long-random-string-at-least-32' }),
    ).toThrow(/still holds the placeholder/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...VALID, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateEnv({ ...VALID, JWT_REFRESH_SECRET: VALID.JWT_ACCESS_SECRET as string }),
    ).toThrow(/must differ from JWT_ACCESS_SECRET/);
  });

  it('rejects an encryption key that is not exactly 32 bytes', () => {
    expect(() =>
      validateEnv({ ...VALID, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/exactly 32 bytes/);
  });

  it('requires an OpenAI key when the OpenAI provider is selected', () => {
    expect(() => validateEnv({ ...VALID, LLM_PROVIDER: 'openai' })).toThrow(
      /OPENAI_API_KEY is required/,
    );
    expect(() =>
      validateEnv({ ...VALID, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }),
    ).not.toThrow();
  });

  it('requires an Anthropic key when the Anthropic provider is selected', () => {
    expect(() => validateEnv({ ...VALID, LLM_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it('requires CORS origins in production', () => {
    expect(() => validateEnv({ ...VALID, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });

  it('requires bucket and region when storage is s3', () => {
    expect(() => validateEnv({ ...VALID, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('leaves PORT unset when the platform does not assign one', () => {
    expect(validateEnv({ ...VALID }).PORT).toBeUndefined();
  });

  it('lists every problem at once rather than failing on the first', () => {
    let message = '';
    try {
      validateEnv({ ...VALID, JWT_ACCESS_SECRET: 'short', REDIS_URL: 'not-a-url' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).toContain('REDIS_URL');
  });
});

describe('resolvePort', () => {
  it('uses API_PORT when the platform assigns no PORT', () => {
    expect(resolvePort(validateEnv({ ...VALID, API_PORT: '4000' }))).toBe(4000);
  });

  it('prefers a platform-assigned PORT over API_PORT', () => {
    // Railway, Render and Fly all inject PORT and route only to that port.
    expect(resolvePort(validateEnv({ ...VALID, API_PORT: '4000', PORT: '8080' }))).toBe(8080);
  });

  it('ignores an empty PORT rather than coercing it to 0', () => {
    expect(resolvePort(validateEnv({ ...VALID, PORT: '' }))).toBe(4000);
  });
});
