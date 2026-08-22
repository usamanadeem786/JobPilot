import { ERROR_MESSAGES, type ApiErrorBody, type ApiFieldError, type ErrorCode } from '@jobpilot/shared';

/**
 * Base URL for API calls.
 *
 * Defaults to the same-origin path `/api`, which `next.config.ts` forwards to
 * the real backend. A localhost default used to live here, and it is exactly
 * the wrong failure mode in production: the bundle ships with
 * `http://localhost:4000` inlined, every visitor's browser posts to its own
 * machine, and the only symptom is a generic "could not reach the server".
 *
 * Set `NEXT_PUBLIC_API_URL` only to bypass the proxy and call a backend
 * directly — which then requires CORS and a cross-site cookie policy.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/+$/, '');

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i;

/**
 * True when the client is configured to call a loopback address from a page
 * that is not itself on loopback — a production build that never received its
 * API URL. Reported as the configuration error it is, rather than as a
 * mysterious network failure that sends the user to check their wifi.
 *
 * Pure, so the interesting combinations are testable without a fake DOM.
 */
export function isLoopbackMismatch(apiUrl: string, pageHostname: string): boolean {
  const match = /^https?:\/\/([^/:]+|\[[^\]]+\])/i.exec(apiUrl);
  if (!match?.[1]) return false;
  return LOOPBACK_HOST.test(match[1]) && !LOOPBACK_HOST.test(pageHostname);
}

function isUnreachableLoopbackTarget(): boolean {
  if (typeof window === 'undefined') return false;
  return isLoopbackMismatch(API_URL, window.location.hostname);
}

/**
 * The access token is held in a module variable rather than localStorage.
 *
 * Anything readable by JavaScript is readable by an XSS payload, but a value
 * in memory dies with the tab and is never persisted. The long-lived refresh
 * token lives in an httpOnly cookie the page cannot read at all, and a page
 * reload silently re-establishes the session from it.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** A failed API call, carrying the machine-readable code from the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors: ApiFieldError[];
  readonly requestId?: string;

  constructor(body: ApiErrorBody) {
    super(body.message || ERROR_MESSAGES[body.code] || 'Request failed.');
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors ?? [];
    if (body.requestId) this.requestId = body.requestId;
  }

  /** Maps field errors onto react-hook-form's setError shape. */
  fieldErrorMap(): Record<string, string> {
    return Object.fromEntries(this.fieldErrors.map((issue) => [issue.path, issue.message]));
  }
}

/** The request never reached a server: offline, DNS failure, TLS error. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * The app is pointing somewhere it can never reach. Distinct from
 * NetworkError because no amount of retrying or reconnecting will fix it —
 * a deployment setting has to change.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for the refresh call itself, to stop it recursing. */
  skipRefresh?: boolean;
}

/**
 * A single in-flight refresh shared by every caller. Without this, five
 * parallel requests hitting an expired token would fire five refreshes, and
 * rotation would flag four of them as token reuse and kill the session.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        setAccessToken(null);
        return false;
      }
      const session = (await response.json()) as { tokens?: { accessToken?: string } };
      const token = session.tokens?.accessToken;
      if (!token) {
        setAccessToken(null);
        return false;
      }
      setAccessToken(token);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * A 404 from the API is JSON; a 404 from the Next router is an HTML page.
 * The content type is what separates "no such user" from "no such backend".
 */
function isNextRouterHtml(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/html');
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = {
      statusCode: response.status,
      code: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES.INTERNAL_ERROR,
      timestamp: new Date().toISOString(),
    };
  }
  return new ApiError(body);
}

/**
 * Typed fetch wrapper. Attaches the access token, refreshes once on expiry,
 * and turns every failure into an `ApiError` the UI can branch on.
 */
export async function apiFetch<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { body, skipRefresh, headers, ...rest } = options;

  const send = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (body !== undefined && !requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }
    if (accessToken) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    return fetch(`${API_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  if (isUnreachableLoopbackTarget()) {
    throw new ConfigurationError(
      'This deployment is not connected to an API. It is configured to call ' +
        `${API_URL}, which is only reachable from the machine running it.`,
    );
  }

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    throw new NetworkError(error);
  }

  // A proxied /api path that reaches the Next router instead of the backend
  // means no rewrite is configured. Returning "not found" here would send the
  // user hunting for a missing account rather than a missing deployment.
  if (response.status === 404 && API_URL.startsWith('/') && isNextRouterHtml(response)) {
    throw new ConfigurationError(
      'The API proxy is not configured for this deployment, so API requests are ' +
        'not reaching a backend. Set API_PROXY_TARGET and redeploy.',
    );
  }

  // One retry, and only for an expired token: a 401 for any other reason
  // (revoked session, suspended account) must surface immediately.
  if (response.status === 401 && !skipRefresh) {
    const error = await toApiError(response.clone());
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHENTICATED') {
      const refreshed = await refreshSession();
      if (refreshed) {
        try {
          response = await send();
        } catch (networkError) {
          throw new NetworkError(networkError);
        }
      }
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

export { API_URL, refreshSession };
