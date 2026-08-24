import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ApiFieldError } from '@jobpilot/shared';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppException } from '../errors/app-exception';

/**
 * Validates and *transforms* a request payload with a Zod schema.
 *
 * The parsed output replaces the raw input, so handlers receive exactly the
 * shape the schema describes — trimmed, coerced, and with unknown keys
 * stripped. Using the schemas from `@jobpilot/shared` means the browser and
 * the server enforce identical rules.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppException.badRequest('VALIDATION_FAILED', undefined, toFieldErrors(result.error));
  }
}

export function toFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Convenience factory so controllers read `@Body(zodBody(LoginSchema))`. */
export function zodBody<TSchema extends ZodTypeAny>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}

/**
 * The same pipe, named for query strings.
 *
 * Identical behaviour - the distinction is at the call site, where
 * `@Query(zodQuery(...))` says which half of the request is being validated.
 * Query schemas do the heavier lifting of the two: everything arrives as a
 * string, so they must coerce numbers and booleans rather than merely check
 * them.
 */
export function zodQuery<TSchema extends ZodTypeAny>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}
