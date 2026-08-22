import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ENV, type Env } from './config/config.module';

/**
 * Everything that has to be true of the HTTP layer, in one place.
 *
 * The e2e tests call this with the same arguments as `main.ts`, so a security
 * header or CORS rule can never be enabled in production but missing under
 * test (or the reverse).
 */
export function configureApp(app: INestApplication): Env {
  const env = app.get<Env>(ENV);
  const expressApp = app as NestExpressApplication;

  app.setGlobalPrefix(env.API_GLOBAL_PREFIX);

  // Behind a load balancer, `req.ip` must come from X-Forwarded-For or the
  // audit log and rate limiter would only ever see the proxy's address.
  expressApp.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON only; a restrictive CSP costs nothing here and
      // hardens error pages and any future static asset route.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(cookieParser());

  app.enableCors({
    // An explicit allowlist, never a reflected origin: `credentials: true`
    // with a reflected origin would let any site call the API with the user's
    // cookies attached.
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.enableShutdownHooks();

  return env;
}
