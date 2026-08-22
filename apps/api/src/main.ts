import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Replaces Nest's default logger, so framework logs are structured JSON too.
  app.useLogger(app.get(PinoLogger));

  const env = configureApp(app);

  await app.listen(env.API_PORT, '0.0.0.0');
  app
    .get(PinoLogger)
    .log(`API listening on http://localhost:${env.API_PORT}/${env.API_GLOBAL_PREFIX}`);
}

void bootstrap().catch((error: unknown) => {
  // Config validation failures land here; print them plainly and exit non-zero
  // so a container orchestrator restarts or halts the rollout.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
