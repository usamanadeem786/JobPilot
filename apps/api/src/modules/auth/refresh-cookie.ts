import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/config.module';

export const REFRESH_COOKIE_NAME = 'jp_refresh';

/**
 * The refresh token lives in an httpOnly cookie so JavaScript on the page —
 * including anything injected by an XSS — cannot read it. The access token,
 * which is short-lived, is held in memory by the client instead.
 *
 * `sameSite` defaults to 'lax', which is what protects the refresh endpoint
 * from CSRF: browsers do not attach a Lax cookie to a cross-site POST, and
 * refresh is POST-only. Deployments that split the frontend and API across
 * unrelated domains must set COOKIE_SAMESITE=none, which forces Secure and
 * leans entirely on the CORS allowlist instead.
 *
 * `path` narrows the cookie so it is not sent with every API call.
 */
export function refreshCookieOptions(env: Env, expiresAt: Date): CookieOptions {
  return {
    ...baseCookieOptions(env),
    expires: expiresAt,
  };
}

function baseCookieOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    // SameSite=None is meaningless without Secure, so it implies it.
    secure: env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: `/${env.API_GLOBAL_PREFIX}/auth`,
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
  // The attributes must match the ones the cookie was set with, or the browser
  // keeps the original and "sign out" leaves a live session behind.
  response.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions(env));
}

/**
 * Cookie first, body second. Browsers use the cookie; native and CLI clients
 * that cannot hold cookies send the token in the body instead.
 */
export function readRefreshToken(request: Request, bodyToken?: string): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME] ?? bodyToken;
}
