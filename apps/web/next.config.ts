import type { NextConfig } from 'next';

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
 *  - No rebuild to repoint it. `NEXT_PUBLIC_*` values are inlined into the
 *    client bundle at build time and cannot be changed by editing an env var.
 */
const apiProxyTarget = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship compiled CommonJS; Next still needs to know they
  // are part of the monorepo so it resolves and re-bundles them correctly.
  transpilePackages: ['@jobpilot/shared'],
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

    return [{ source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` }];
  },
};

export default nextConfig;
