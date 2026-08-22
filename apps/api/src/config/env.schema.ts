import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot.
 *
 * The process refuses to start when a required secret is missing or weak, so
 * a misconfigured deployment fails loudly instead of running with, say, a
 * default JWT secret. Optional integrations validate to `undefined`, and the
 * feature that needs them reports "not configured" at the API surface.
 */

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/**
 * An optional numeric variable. `.coerce` alone turns the empty string that an
 * unset-but-present key produces ("CLAMAV_PORT=") into 0, which then fails a
 * positivity check, so blank is normalised to absent first.
 */
const optionalPort = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional(),
);

const commaSeparated = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

/**
 * A duration in the `<number><unit>` form that `jsonwebtoken` understands.
 * Typing it precisely (rather than as `string`) means the value can be handed
 * straight to `signAsync` without a cast.
 */
export type DurationString = `${number}s` | `${number}m` | `${number}h` | `${number}d`;

const duration = (fallback: DurationString) =>
  z
    .string()
    .regex(/^\d+[smhd]$/, 'Use a duration such as "15m", "24h" or "30d".')
    .default(fallback)
    .transform((value) => value as DurationString);

/** Rejects the placeholder values shipped in .env.example. */
const strongSecret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters.`)
    .refine((value) => !value.toLowerCase().startsWith('replace-with'), {
      message: `${name} still holds the placeholder from .env.example.`,
    });

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_GLOBAL_PREFIX: z.string().default('api'),
    CORS_ORIGINS: commaSeparated,
    /**
     * In-process rate limiting. Disable only when a gateway or CDN in front of
     * the API already enforces limits — never to make a load test pass.
     */
    THROTTLE_ENABLED: booleanFromString.default(true),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string.'),
    REDIS_URL: z.string().url('REDIS_URL must be a valid connection string.'),

    JWT_ACCESS_SECRET: strongSecret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: strongSecret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL: duration('15m'),
    JWT_REFRESH_TTL: duration('30d'),
    ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        message: 'ENCRYPTION_KEY must be exactly 32 bytes encoded as base64.',
      }),

    GOOGLE_OAUTH_CLIENT_ID: optionalString,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
    GITHUB_OAUTH_CLIENT_ID: optionalString,
    GITHUB_OAUTH_CLIENT_SECRET: optionalString,
    OAUTH_CALLBACK_BASE_URL: optionalString,

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    S3_ENDPOINT: optionalString,
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    CLAMAV_HOST: optionalString,
    CLAMAV_PORT: optionalPort,

    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'mock']).default('mock'),
    LLM_DEFAULT_MODEL: optionalString,
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    OPENAI_API_KEY: optionalString,
    OPENAI_BASE_URL: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    EMBEDDINGS_PROVIDER: z.enum(['openai', 'none']).default('none'),
    EMBEDDINGS_MODEL: optionalString,

    GREENHOUSE_BOARD_TOKENS: commaSeparated,
    LEVER_COMPANY_SLUGS: commaSeparated,
    ASHBY_JOB_BOARD_NAMES: commaSeparated,
    ADZUNA_APP_ID: optionalString,
    ADZUNA_APP_KEY: optionalString,
    ADZUNA_COUNTRY: z.string().length(2).default('gb'),
    JOOBLE_API_KEY: optionalString,
    LINKEDIN_PARTNER_API_TOKEN: optionalString,
    INDEED_PARTNER_API_TOKEN: optionalString,
    GLASSDOOR_PARTNER_API_TOKEN: optionalString,

    HTTP_USER_AGENT: z.string().default('JobPilot/0.1'),
    SOURCE_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
    RESPECT_ROBOTS_TXT: booleanFromString.default(true),

    SMTP_HOST: optionalString,
    SMTP_PORT: optionalPort,
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET.',
      });
    }

    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list the allowed browser origins in production.',
      });
    }

    if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET and S3_REGION are required when STORAGE_DRIVER is "s3".',
      });
    }

    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER is "openai".',
      });
    }

    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER is "anthropic".',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Formats Zod issues into an operator-readable startup error. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}
