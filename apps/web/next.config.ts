import type { NextConfig } from 'next';

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
};

export default nextConfig;
