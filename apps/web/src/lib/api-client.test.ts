import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  ApiError,
  getAccessToken,
  isLoopbackMismatch,
  NetworkError,
  setAccessToken,
} from './api-client';
// The configuration suite re-imports the module with a different environment,
// so it needs the module's type without a value import.
import type * as ApiClient from './api-client';

const API_URL = 'http://localhost:4000/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number, message = 'failed'): Response {
  return jsonResponse(
    { statusCode: status, code, message, timestamp: new Date().toISOString() },
    status,
  );
}

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAccessToken(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('sends credentials so the refresh cookie travels with the request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/users/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('attaches the access token as a bearer header when one is set', async () => {
    setAccessToken('token-123');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/users/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('omits the Authorization header when signed out', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/health');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('serialises the body as JSON with the right content type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.co' } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/auth/login`);
    expect(init.body).toBe('{"email":"a@b.co"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for a 204 rather than trying to parse a body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws an ApiError carrying the server error code', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse('EMAIL_ALREADY_REGISTERED', 409, 'Taken.'));

    await expect(apiFetch('/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'Taken.',
    });
  });

  it('exposes field errors as a path → message map', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Invalid.',
          fieldErrors: [{ path: 'password', message: 'Too short.' }],
          timestamp: new Date().toISOString(),
        },
        400,
      ),
    );

    try {
      await apiFetch('/auth/register', { method: 'POST', body: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).fieldErrorMap()).toEqual({ password: 'Too short.' });
    }
  });

  it('wraps a transport failure in a NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/users/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('refreshes once on an expired token and replays the original request', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(errorResponse('TOKEN_EXPIRED', 401))
      .mockResolvedValueOnce(jsonResponse({ tokens: { accessToken: 'fresh' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }));

    await expect(apiFetch<{ id: string }>('/users/me')).resolves.toEqual({ id: 'user-1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API_URL}/auth/refresh`);
    expect(getAccessToken()).toBe('fresh');

    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(retryInit.headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('clears the token and surfaces the error when the refresh itself fails', async () => {
    setAccessToken('stale');
    fetchMock
      .mockResolvedValueOnce(errorResponse('TOKEN_EXPIRED', 401))
      .mockResolvedValueOnce(errorResponse('TOKEN_REUSE_DETECTED', 401));

    await expect(apiFetch('/users/me')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(getAccessToken()).toBeNull();
  });

  it('does not attempt a refresh for a non-expiry 401', async () => {
    setAccessToken('valid');
    fetchMock.mockResolvedValueOnce(errorResponse('ACCOUNT_SUSPENDED', 401));

    await expect(apiFetch('/users/me')).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never refreshes when skipRefresh is set, so the refresh call cannot recurse', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse('TOKEN_EXPIRED', 401));

    await expect(apiFetch('/auth/refresh', { method: 'POST', skipRefresh: true })).rejects.toThrow(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refreshes into one, so rotation is not flagged as reuse', async () => {
    setAccessToken('stale');

    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        // Hold the refresh open so both callers queue behind the same promise.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({ tokens: { accessToken: 'fresh' } });
      }
      return getAccessToken() === 'fresh'
        ? jsonResponse({ ok: true })
        : errorResponse('TOKEN_EXPIRED', 401);
    });

    await Promise.all([apiFetch('/users/me'), apiFetch('/users/me/profile')]);

    expect(refreshCalls).toBe(1);
  });

  it('falls back to a generic error when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));

    await expect(apiFetch('/users/me')).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('isLoopbackMismatch', () => {
  it('flags a production page configured to call localhost', () => {
    // The exact failure that shipped: NEXT_PUBLIC_API_URL was never set, the
    // localhost default was inlined into the bundle, and every visitor's
    // browser posted to its own machine.
    expect(isLoopbackMismatch('http://localhost:4000/api', 'job-pilot-web.vercel.app')).toBe(true);
    expect(isLoopbackMismatch('http://127.0.0.1:4000/api', 'example.com')).toBe(true);
  });

  it('allows localhost when the page is itself on localhost', () => {
    expect(isLoopbackMismatch('http://localhost:4000/api', 'localhost')).toBe(false);
    expect(isLoopbackMismatch('http://127.0.0.1:4000/api', '127.0.0.1')).toBe(false);
  });

  it('ignores a same-origin relative base, which is the default', () => {
    expect(isLoopbackMismatch('/api', 'job-pilot-web.vercel.app')).toBe(false);
  });

  it('allows a real remote API from a production page', () => {
    expect(isLoopbackMismatch('https://api.example.com/api', 'app.example.com')).toBe(false);
  });
});

describe('configuration failures', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /**
   * Re-imports the client with NEXT_PUBLIC_API_URL unset, which is the
   * production default: the base URL becomes the same-origin `/api` path that
   * next.config.ts forwards. The module reads the variable once at load, so a
   * fresh module registry is the only way to exercise it.
   */
  async function importWithSameOriginDefault(): Promise<typeof ApiClient> {
    const previous = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.resetModules();
    try {
      return await import('./api-client');
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_API_URL = previous;
    }
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults to the same-origin /api path so nothing is baked into the bundle', async () => {
    const client = await importWithSameOriginDefault();
    fetchMock.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await client.apiFetch('/users/me');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/me');
  });

  it('reports a missing proxy rather than a 404, when the Next router answers', async () => {
    // With the same-origin default, an unconfigured rewrite means /api/* falls
    // through to the Next router, which returns an HTML 404. Surfacing that as
    // "not found" would send the user looking for a missing account.
    const client = await importWithSameOriginDefault();
    fetchMock.mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );

    await expect(
      client.apiFetch('/auth/register', { method: 'POST', body: {} }),
    ).rejects.toBeInstanceOf(client.ConfigurationError);
  });

  it('still treats a JSON 404 from the API as a normal not-found', async () => {
    const client = await importWithSameOriginDefault();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'No such job.',
          timestamp: new Date().toISOString(),
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(client.apiFetch('/jobs/missing')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
    });
  });
});
