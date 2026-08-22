import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema';
import { clearRefreshCookie, refreshCookieOptions, readRefreshToken } from './refresh-cookie';
import type { Request, Response } from 'express';

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'development',
    API_GLOBAL_PREFIX: 'api',
    COOKIE_SAMESITE: 'lax',
    ...overrides,
  } as unknown as Env;
}

const EXPIRES = new Date('2030-01-01T00:00:00.000Z');

describe('refreshCookieOptions', () => {
  it('is httpOnly and scoped to the auth path, so it is not sent with every call', () => {
    const options = refreshCookieOptions(env(), EXPIRES);

    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe('/api/auth');
    expect(options.expires).toBe(EXPIRES);
  });

  it('defaults to Lax, which is the CSRF defence for the refresh endpoint', () => {
    expect(refreshCookieOptions(env(), EXPIRES).sameSite).toBe('lax');
  });

  it('is not Secure in development, so it works over plain http on localhost', () => {
    expect(refreshCookieOptions(env(), EXPIRES).secure).toBe(false);
  });

  it('is Secure in production', () => {
    expect(refreshCookieOptions(env({ NODE_ENV: 'production' }), EXPIRES).secure).toBe(true);
  });

  it('forces Secure when SameSite is None, which browsers require', () => {
    const options = refreshCookieOptions(
      env({ NODE_ENV: 'production', COOKIE_SAMESITE: 'none' }),
      EXPIRES,
    );

    expect(options.sameSite).toBe('none');
    expect(options.secure).toBe(true);
  });

  it('honours a custom API prefix', () => {
    expect(refreshCookieOptions(env({ API_GLOBAL_PREFIX: 'v1' }), EXPIRES).path).toBe('/v1/auth');
  });
});

describe('clearRefreshCookie', () => {
  it('clears with the same attributes the cookie was set with', () => {
    // A mismatch leaves the original cookie in place and "sign out" does
    // nothing, so the attributes are asserted rather than assumed.
    const captured: { name?: string; options?: Record<string, unknown> } = {};
    const response = {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        captured.name = name;
        captured.options = options;
      },
    } as unknown as Response;

    const current = env({ NODE_ENV: 'production', COOKIE_SAMESITE: 'none' });
    clearRefreshCookie(response, current);
    const set = refreshCookieOptions(current, EXPIRES);

    expect(captured.name).toBe('jp_refresh');
    expect(captured.options?.path).toBe(set.path);
    expect(captured.options?.sameSite).toBe(set.sameSite);
    expect(captured.options?.secure).toBe(set.secure);
    expect(captured.options?.httpOnly).toBe(set.httpOnly);
  });
});

describe('readRefreshToken', () => {
  it('prefers the cookie', () => {
    const request = { cookies: { jp_refresh: 'from-cookie' } } as unknown as Request;
    expect(readRefreshToken(request, 'from-body')).toBe('from-cookie');
  });

  it('falls back to the body for clients that cannot hold cookies', () => {
    const request = { cookies: {} } as unknown as Request;
    expect(readRefreshToken(request, 'from-body')).toBe('from-body');
  });

  it('returns undefined when neither is present', () => {
    expect(readRefreshToken({ cookies: {} } as unknown as Request)).toBeUndefined();
    expect(readRefreshToken({} as unknown as Request)).toBeUndefined();
  });
});
