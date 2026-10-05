/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * The end-to-end suite builds into its own directory.
   *
   * Playwright starts its own Next dev server on a dedicated port and never
   * reuses one that is already listening — but a port is not the only thing two
   * dev servers share. Both compile on demand into `.next`, so running the
   * suite while `npm run dev` is up has them racing over the same build output:
   * whichever page a test reaches mid-compile fails, and a different handful
   * fails each run.
   *
   * That is worse than an inconvenience. A suite that is red, then green, then
   * red teaches people to re-run until it passes, which is how a real failure
   * gets waved through.
   *
   * Set by playwright.config.ts, so only the test server sees it.
   */
  distDir: process.env.NEXT_TEST_BUILD ? '.next-e2e' : '.next',
  experimental: {
    // Keep playwright/cheerio out of the webpack bundle — Node.js-only packages
    serverComponentsExternalPackages: ['playwright', 'cheerio'],
    // Enables src/instrumentation.ts to run on server boot. Used to
    // auto-resume persisted watch processes after a Railway redeploy.
    // (Default in Next.js 15; opt-in in 14.x.)
    instrumentationHook: true,
  },
  webpack: (config, { isServer, nextRuntime }) => {
    // instrumentation.ts pulls in watchResume → watchSpawner → child_process,
    // and (since FR-67) the Form Watch ticker → formShots → crypto.
    // Anything a module reachable from instrumentation imports must be listed.
    // In Next.js 14.x the instrumentation hook is also compiled for Edge,
    // which has neither. Stub these Node built-ins as `false` so
    // webpack doesn't fail trying to resolve them — the runtime check in
    // instrumentation.ts already prevents execution outside Node.
    if (!isServer || nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        child_process: false,
        crypto: false,
        fs: false,
        'fs/promises': false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
