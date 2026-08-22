/**
 * Vercel serverless entrypoint for the API.
 *
 * Why this file imports from `../dist` rather than `../src`:
 * Vercel compiles functions with esbuild, which does not emit
 * `design:paramtypes` decorator metadata. Nest resolves constructor
 * dependencies from exactly that metadata, so a Nest app compiled by esbuild
 * fails to inject anything at runtime — with no compile-time error. The build
 * command runs `nest build` (tsc) first, and this thin handler, which contains
 * no decorators of its own, simply hands off to the already-compiled app.
 *
 * Scope: this suits the API as it stands. From Phase 3, background job
 * processing (BullMQ) and the SSE progress stream need a process that outlives
 * a request, and `apps/workers` has to run somewhere that provides one.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type Express, type Request, type Response } from 'express';

import { AppModule } from '../dist/app.module';
import { configureApp } from '../dist/bootstrap';

/**
 * Cached across invocations that reuse a warm container, so the Nest graph and
 * the Prisma connection pool are built once per instance rather than per
 * request. The promise — not the resolved app — is cached, so concurrent cold
 * invocations share a single bootstrap instead of racing to build several.
 */
let bootstrapPromise: Promise<Express> | null = null;

async function bootstrap(): Promise<Express> {
  const expressApp = express();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bufferLogs: true,
  });

  configureApp(app, { shutdownHooks: false });

  // `init()` rather than `listen()`: Vercel owns the socket and routes the
  // request in directly.
  await app.init();

  return expressApp;
}

export default async function handler(request: Request, response: Response): Promise<void> {
  bootstrapPromise ??= bootstrap().catch((error: unknown) => {
    // Do not cache a failed bootstrap: a transient database outage at cold
    // start would otherwise poison the instance for its whole lifetime.
    bootstrapPromise = null;
    throw error;
  });

  const server = await bootstrapPromise;
  server(request, response);
}
