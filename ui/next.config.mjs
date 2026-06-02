/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep playwright/cheerio out of the webpack bundle — Node.js-only packages
    serverComponentsExternalPackages: ['playwright', 'cheerio'],
    // Enables src/instrumentation.ts to run on server boot. Used to
    // auto-resume persisted watch processes after a Railway redeploy.
    // (Default in Next.js 15; opt-in in 14.x.)
    instrumentationHook: true,
  },
  webpack: (config, { isServer, nextRuntime }) => {
    // instrumentation.ts pulls in watchResume → watchSpawner → child_process.
    // In Next.js 14.x the instrumentation hook is also compiled for Edge,
    // which doesn't have child_process. Stub Node built-ins as `false` so
    // webpack doesn't fail trying to resolve them — the runtime check in
    // instrumentation.ts already prevents execution outside Node.
    if (!isServer || nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        child_process: false,
        fs: false,
        'fs/promises': false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
