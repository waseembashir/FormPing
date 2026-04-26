/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep playwright/cheerio out of the webpack bundle — Node.js-only packages
    serverComponentsExternalPackages: ['playwright', 'cheerio'],
  },
};

export default nextConfig;
