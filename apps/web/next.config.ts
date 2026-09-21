import type { NextConfig } from 'next';

/** Where the Next.js server forwards /api/v1 requests (the browser never talks to the API directly). */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@itam/shared'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_INTERNAL_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Camera is needed for QR scanning on this origin only.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
