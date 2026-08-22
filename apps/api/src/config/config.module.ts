import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv, type Env } from './env.schema';

/** DI token for the validated, fully typed environment. */
export const ENV = Symbol('ENV');

export type { Env };

/**
 * `@nestjs/config` is used only to load .env files into `process.env`; the
 * application never reads untyped values out of `ConfigService`. Everything
 * downstream injects the validated `Env` object instead.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The monorepo keeps a single .env at the root; a per-app .env wins if present.
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
