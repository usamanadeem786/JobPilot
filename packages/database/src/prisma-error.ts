import { Prisma } from '@prisma/client';

/** Prisma error codes we translate into domain errors. */
export const PrismaErrorCode = {
  UniqueConstraintViolation: 'P2002',
  ForeignKeyConstraintViolation: 'P2003',
  RecordNotFound: 'P2025',
} as const;

export type PrismaErrorCodeValue = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

export function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export function isUniqueConstraintViolation(error: unknown, target?: string): boolean {
  if (!isPrismaKnownError(error) || error.code !== PrismaErrorCode.UniqueConstraintViolation) {
    return false;
  }
  if (!target) return true;

  const meta = error.meta as { target?: string[] | string } | undefined;
  const fields = Array.isArray(meta?.target) ? meta.target : meta?.target ? [meta.target] : [];
  return fields.includes(target);
}

export function isRecordNotFound(error: unknown): boolean {
  return isPrismaKnownError(error) && error.code === PrismaErrorCode.RecordNotFound;
}
