import { z } from 'zod';
import type { Role, UserStatus } from './enums';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Password policy. Length does most of the work; the character-class rules
 * exist to stop trivially guessable strings, not to frustrate password
 * managers, so no symbol requirement.
 */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`)
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/[0-9]/, 'Password must contain a number.');

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  // Ordered so an empty field reads "Enter your email address." rather than
  // Zod's default length message.
  .min(1, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.');

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  fullName: z.string().trim().min(1, 'Enter your name.').max(120),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * The refresh token normally travels in an httpOnly cookie. The body field is
 * a fallback for non-browser clients (mobile, CLI) that cannot store cookies.
 */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here before.',
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** The authenticated user as returned to the client. Never includes secrets. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly emailVerified: boolean;
  readonly fullName: string | null;
  readonly createdAt: string;
}

export interface AuthTokens {
  readonly accessToken: string;
  /** Present only for clients that opted out of cookie-based refresh. */
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly tokenType: 'Bearer';
}

export interface AuthSession {
  readonly user: AuthUser;
  readonly tokens: AuthTokens;
}

/** Claims embedded in the access token. */
export interface AccessTokenPayload {
  readonly sub: string;
  readonly email: string;
  readonly role: Role;
  readonly iat: number;
  readonly exp: number;
}

/** Claims embedded in the refresh token. `jti` identifies the stored hash. */
export interface RefreshTokenPayload {
  readonly sub: string;
  readonly jti: string;
  readonly fid: string;
  readonly iat: number;
  readonly exp: number;
}
