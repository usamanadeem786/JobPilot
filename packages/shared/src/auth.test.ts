import { describe, expect, it } from 'vitest';
import {
  ChangePasswordSchema,
  EmailSchema,
  LoginSchema,
  PASSWORD_MIN_LENGTH,
  PasswordSchema,
  RegisterSchema,
} from './auth';

/**
 * These schemas are the single definition of the rules — the browser and the
 * API both enforce this exact object — so the tests here cover the contract
 * for both sides at once.
 */

describe('EmailSchema', () => {
  it('trims and lower-cases, so the same address cannot register twice', () => {
    expect(EmailSchema.parse('  Ada@Example.COM  ')).toBe('ada@example.com');
  });

  it.each([
    ['', 'Enter your email address.'],
    ['not-an-email', 'Enter a valid email address.'],
    ['missing@tld', 'Enter a valid email address.'],
    ['@example.com', 'Enter a valid email address.'],
  ])('rejects %j with a readable message', (input, expected) => {
    const result = EmailSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(expected);
    }
  });

  it('rejects an address longer than the RFC limit', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(EmailSchema.safeParse(tooLong).success).toBe(false);
  });

  it('accepts plus-addressing', () => {
    expect(EmailSchema.parse('ada+jobs@example.com')).toBe('ada+jobs@example.com');
  });
});

describe('PasswordSchema', () => {
  it('accepts a password meeting every rule', () => {
    expect(PasswordSchema.safeParse('Str0ngPassword!23').success).toBe(true);
  });

  it(`rejects anything shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    const result = PasswordSchema.safeParse('Sh0rtPass');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(`at least ${PASSWORD_MIN_LENGTH}`);
    }
  });

  it.each([
    ['alllowercase123', /uppercase/i],
    ['ALLUPPERCASE123', /lowercase/i],
    ['NoDigitsInHereAtAll', /number/i],
  ])('rejects %j', (password, expected) => {
    const result = PasswordSchema.safeParse(password);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(expected);
    }
  });

  it('does not require a symbol, so passphrases from a manager are accepted', () => {
    expect(PasswordSchema.safeParse('correctHorseBattery9').success).toBe(true);
  });

  it('rejects an absurdly long password rather than hashing it', () => {
    expect(PasswordSchema.safeParse(`Aa1${'x'.repeat(200)}`).success).toBe(false);
  });
});

describe('RegisterSchema', () => {
  it('normalises the whole payload', () => {
    const parsed = RegisterSchema.parse({
      email: ' Ada@Example.com ',
      password: 'Str0ngPassword!23',
      fullName: '  Ada Lovelace  ',
    });

    expect(parsed).toEqual({
      email: 'ada@example.com',
      password: 'Str0ngPassword!23',
      fullName: 'Ada Lovelace',
    });
  });

  it('strips keys the schema does not declare, closing mass assignment', () => {
    const parsed = RegisterSchema.parse({
      email: 'ada@example.com',
      password: 'Str0ngPassword!23',
      fullName: 'Ada',
      role: 'ADMIN',
      emailVerified: true,
    }) as Record<string, unknown>;

    expect(parsed.role).toBeUndefined();
    expect(parsed.emailVerified).toBeUndefined();
  });

  it('rejects a name that is only whitespace', () => {
    const result = RegisterSchema.safeParse({
      email: 'ada@example.com',
      password: 'Str0ngPassword!23',
      fullName: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('reports every invalid field at once, not just the first', () => {
    const result = RegisterSchema.safeParse({ email: 'bad', password: 'x', fullName: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(new Set(paths)).toEqual(new Set(['email', 'password', 'fullName']));
    }
  });
});

describe('LoginSchema', () => {
  it('does not apply the password policy — an old password must still sign in', () => {
    expect(
      LoginSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(true);
  });

  it('still requires a password to be present', () => {
    expect(LoginSchema.safeParse({ email: 'ada@example.com', password: '' }).success).toBe(false);
  });
});

describe('ChangePasswordSchema', () => {
  it('accepts a genuine change', () => {
    expect(
      ChangePasswordSchema.safeParse({
        currentPassword: 'OldPassword!23',
        newPassword: 'NewPassword!456',
      }).success,
    ).toBe(true);
  });

  it('rejects reusing the current password, reporting it on the new field', () => {
    const result = ChangePasswordSchema.safeParse({
      currentPassword: 'SamePassword!23',
      newPassword: 'SamePassword!23',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['newPassword']);
    }
  });

  it('applies the password policy to the new password', () => {
    expect(
      ChangePasswordSchema.safeParse({ currentPassword: 'OldPassword!23', newPassword: 'weak' })
        .success,
    ).toBe(false);
  });
});
