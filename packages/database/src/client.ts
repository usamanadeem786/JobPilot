import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient };

/**
 * Prisma keeps a connection pool per client instance. In development Next.js
 * and ts-node reload modules on every change, which would otherwise leak a new
 * pool per reload, so the instance is cached on `globalThis`.
 */
const globalForPrisma = globalThis as unknown as { __jobpilotPrisma?: PrismaClient };

export interface PrismaClientOptions {
  readonly databaseUrl?: string;
  readonly logQueries?: boolean;
}

export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
  });
}

export function getPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  if (!globalForPrisma.__jobpilotPrisma) {
    globalForPrisma.__jobpilotPrisma = createPrismaClient(options);
  }
  return globalForPrisma.__jobpilotPrisma;
}
