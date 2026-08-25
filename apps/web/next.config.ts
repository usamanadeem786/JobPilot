import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the browser's `/api/*` calls are forwarded.
 *
 * Deliberately NOT a `NEXT_PUBLIC_*` variable. The browser never needs the
 * backend's address: it calls this app's own origin and Next forwards the
 * request server-side. That buys three things over exposing the API URL:
 *
 *  - No CORS. The call is same-origin from the browser's point of view.
 *  - A first-party session cookie. `Set-Cookie` comes back on this app's own
 *    domain, so `SameSite=Lax` keeps working. Pointing the browser straight at
 *    another domain makes the refresh cookie cross-site and forces the weaker
 *    `SameSite=None`.
 *  - It is not shipped to the browser, so the backend's address is not part
 *    of the public bundle.
 *
 * IMPORTANT: this is still a BUILD-TIME value. Next compiles rewrites into
 * routes-manifest.json during `next build`, so changing API_PROXY_TARGET
 * requires a redeploy, exactly like a NEXT_PUBLIC_* variable. Setting it only
 * in the runtime environment produces a build with no rewrite at all, and
 * every /api call then falls through to the Next router and 404s.
 */
/**
 * Reads one variable out of the monorepo's root `.env`.
 *
 * Next only loads `.env` files sitting beside the app, but this repo keeps a
 * single `.env` at the root — which is where the API reads it from too. Without
 * this, `API_PROXY_TARGET` is simply absent in development, no rewrite is
 * generated, and every API call 404s against the Next router. A real platform
 * environment variable still wins; this is only the local fallback.
 */
function fromRootEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];

  try {
    const contents = readFileSync(resolve(process.cwd(), '../../.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      if (trimmed.slice(0, separator).trim() !== key) continue;

      return trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  } catch {
    // No root .env — a normal deployment, where the platform supplies the
    // variable directly.
  }

  return undefined;
}

const apiProxyTarget = fromRootEnv('API_PROXY_TARGET')?.trim().replace(/\/+$/, '');

/**
 * Whether the proxy target is this very deployment.
 *
 * Vercel exposes both the immutable deployment host and the production alias;
 * either can be what someone pasted in. Compared by host so a trailing slash,
 * a path or http-versus-https does not hide the match.
 */
function pointsAtThisDeployment(target: string): boolean {
  const own = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase());

  if (own.length === 0) return false;

  let host: string;
  try {
    host = new URL(target.includes('://') ? target : `https://${target}`).host.toLowerCase();
  } catch {
    return false;
  }

  return own.includes(host);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship compiled CommonJS; Next still needs to know they
  // are part of the monorepo so it resolves and re-bundles them correctly.
  //
  // @jobpilot/cv is imported only via its `/schema` subpath, which is plain
  // zod. The package root pulls in docx, pdf-lib, unpdf and mammoth, and docx
  // uses a dynamic require that webpack cannot statically analyse — importing
  // it from a client component fails the build outright.
  transpilePackages: ['@jobpilot/shared', '@jobpilot/cv'],
  /*
   * Standalone output is what the Docker image runs, but producing it requires
   * creating symlinks, which Windows refuses without Developer Mode or an
   * elevated shell. It is therefore opt-in: the Dockerfile sets the flag, a
   * developer machine builds normally.
   */
  ...(process.env.NEXT_OUTPUT_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  // Link hrefs are checked against the actual route tree at build time.
  typedRoutes: true,

  async rewrites() {
    if (!apiProxyTarget) {
      // Nothing to forward to. Requests then fall through to the Next router
      // and 404, which the API client reports as a configuration problem —
      // far more diagnosable than silently posting to the visitor's own
      // machine, which is what a localhost fallback does.
      return [];
    }

    if (pointsAtThisDeployment(apiProxyTarget)) {
      // Refusing beats obeying. A rewrite from /api to this same host forwards
      // to itself, and the platform answers every API call with
      // 508 INFINITE_LOOP_DETECTED — a message that names no cause and sends
      // people looking at their backend, which is not even involved.
      //
      // Skipping the rewrite instead produces the ordinary "no API configured"
      // path, and this line is in the build log to say why.
      console.error(
        `\n[jobpilot] API_PROXY_TARGET is set to ${apiProxyTarget}, which is this ` +
          'deployment itself. That would make /api forward to itself forever, so no ' +
          'rewrite was generated. Point it at the API service, e.g. ' +
          'https://jobpilot-api.onrender.com, and redeploy.\n',
      );
      return [];
    }

    return [{ source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` }];
  },
};

export default nextConfig;
