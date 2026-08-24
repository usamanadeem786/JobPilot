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

/**
 * True when the proxy could not reach the backend at all.
 *
 * Next answers a failed rewrite with a plain-text 500 ("Internal Server
 * Error"), which is indistinguishable from a real API fault unless the body
 * is inspected. The API always replies with JSON, so a 5xx that is not JSON
 * means the request never arrived — a different problem with a different fix,
 * and telling the user "something went wrong on our side" sends them to wait
 * for a server that is not coming back on its own.
 */
function isProxyFailure(response: Response): boolean {
  if (response.status < 500) return false;
  const contentType = response.headers.get('content-type') ?? '';
  return !contentType.includes('application/json');
}

/**
 * What to say when the proxy could not reach the backend.
 *
 * The same failure has two completely different causes depending on where the
 * page is running, and one generic sentence sends people to debug the wrong
 * one. On a developer's machine it almost always means the API process is not
 * running; on a deployment it means API_PROXY_TARGET points somewhere that is
 * not answering. Naming the likely cause is the difference between a one-line
 * fix and an afternoon spent reading deployment settings.
 */
function proxyFailureMessage(): string {
  const host = typeof window === 'undefined' ? '' : window.location.hostname;

  if (LOOPBACK_HOST.test(host)) {
    return (
      'The API server is not responding. It usually is not running — start it ' +
      'with `pnpm --filter @jobpilot/api dev`, then try again.'
    );
  }

  return (
    'The API could not be reached. This deployment forwards requests to a ' +
    'backend that is not responding — check that the API is deployed and that ' +
    'API_PROXY_TARGET points at it, then redeploy.'
  );
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

  // FormData carries its own multipart boundary in the Content-Type header,
  // and only the browser can generate it. Setting that header by hand — or
  // stringifying the body — makes the upload unreadable at the other end.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const send = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (body !== undefined && !isFormData && !requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }
    if (accessToken) {
      requestHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    return fetch(`${API_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
      credentials: 'include',
      ...(body !== undefined
        ? { body: isFormData ? (body as FormData) : JSON.stringify(body) }
        : {}),
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

  if (isProxyFailure(response)) {
    throw new ConfigurationError(proxyFailureMessage());
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

/**
 * Fetches a file and hands it to the browser as a download.
 *
 * `apiFetch` cannot be reused: it parses every response as JSON, and a PDF is
 * not JSON. The access token lives in memory rather than a cookie, so a plain
 * link would arrive unauthenticated — the bytes have to come through fetch and
 * be handed over as an object URL.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const requestHeaders = new Headers();
  if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: requestHeaders,
      credentials: 'include',
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryHeaders = new Headers();
      if (accessToken) retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      response = await fetch(`${API_URL}${path}`, {
        headers: retryHeaders,
        credentials: 'include',
      });
    }
  }

  if (!response.ok) throw await toApiError(response);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filenameFrom(response.headers.get('content-disposition'), fallbackName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next tick: released synchronously, the click may not have
    // started reading the blob yet and the download arrives empty.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Reads the filename the server chose, falling back to one we supply. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = quoted?.[1]?.trim();
  if (!name) return fallback;

  try {
    // A server may percent-encode a non-ASCII name (RFC 5987).
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export { API_URL, refreshSession };
