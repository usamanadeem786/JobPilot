import { LoginSchema, RegisterSchema } from '@jobpilot/shared';
import { describe, expect, it } from 'vitest';
import type { ArgumentMetadata } from '@nestjs/common';
import { AppException } from '../errors/app-exception';
import { ZodValidationPipe } from './zod-validation.pipe';

const META: ArgumentMetadata = { type: 'body' };

describe('ZodValidationPipe', () => {
  it('returns the parsed value on success', () => {
    const pipe = new ZodValidationPipe(RegisterSchema);

    const result = pipe.transform(
      { email: 'Ada@Example.COM ', password: 'Str0ngPassword!23', fullName: '  Ada Lovelace ' },
      META,
    );

    // The schema normalises as well as validates.
    expect(result.email).toBe('ada@example.com');
    expect(result.fullName).toBe('Ada Lovelace');
  });

  it('strips keys the schema does not declare', () => {
    const pipe = new ZodValidationPipe(LoginSchema);

    const result = pipe.transform(
      { email: 'ada@example.com', password: 'whatever', role: 'ADMIN' },
      META,
    ) as Record<string, unknown>;

    expect(result.role).toBeUndefined();
  });

  it('throws a VALIDATION_FAILED AppException with per-field detail', () => {
    const pipe = new ZodValidationPipe(RegisterSchema);

    try {
      pipe.transform({ email: 'not-an-email', password: 'short', fullName: '' }, META);
      expect.unreachable('pipe should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const exception = error as AppException;
      expect(exception.code).toBe('VALIDATION_FAILED');
      expect(exception.getStatus()).toBe(400);

      const paths = (exception.fieldErrors ?? []).map((issue) => issue.path);
      expect(paths).toContain('email');
      expect(paths).toContain('password');
      expect(paths).toContain('fullName');
    }
  });

  it('rejects a password missing an uppercase letter', () => {
    const pipe = new ZodValidationPipe(RegisterSchema);

    try {
      pipe.transform(
        { email: 'ada@example.com', password: 'alllowercase123', fullName: 'Ada' },
        META,
      );
      expect.unreachable('pipe should have thrown');
    } catch (error) {
      const messages = ((error as AppException).fieldErrors ?? []).map((issue) => issue.message);
      expect(messages.join(' ')).toMatch(/uppercase/i);
    }
  });

  it('rejects a non-object payload', () => {
    const pipe = new ZodValidationPipe(LoginSchema);
    expect(() => pipe.transform('nope', META)).toThrow(AppException);
  });
});
