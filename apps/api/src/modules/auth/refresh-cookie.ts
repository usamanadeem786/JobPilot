import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/config.module';

export const REFRESH_COOKIE_NAME = 'jp_refresh';

/**
 * The refresh token lives in an httpOnly cookie so JavaScript on the page —
 * including anything injected by an XSS — cannot read it. The access token,
 * which is short-lived, is held in memory by the client instead.
 *
 * `sameSite: 'lax'` is what protects the refresh endpoint from CSRF: browsers
 * do not attach a Lax cookie to a cross-site POST, and refresh is POST-only.
 * `path` narrows the cookie so it is not sent with every API call.
 */
export function refreshCookieOptions(env: Env, expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/${env.API_GLOBAL_PREFIX}/auth`,
    expires: expiresAt,
  };
}

export function setRefreshCookie(
  response: Response,
  env: Env,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(env, expiresAt));
}

export function clearRefreshCookie(response: Response, env: Env): void {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/${env.API_GLOBAL_PREFIX}/auth`,
  });
}

/**
 * Cookie first, body second. Browsers use the cookie; native and CLI clients
 * that cannot hold cookies send the token in the body instead.
 */
export function readRefreshToken(request: Request, bodyToken?: string): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME] ?? bodyToken;
}
