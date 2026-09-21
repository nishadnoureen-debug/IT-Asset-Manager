import type { NextConfig } from 'next';

/**
 * Where the Next.js server forwards /api/v1 requests (the browser never talks to the API directly).
 * Baked in at build time. A bare host (Render's private-network hostname) means http://<host>:4000.
 */
function apiInternalUrl(raw = process.env.API_INTERNAL_URL?.trim() || 'http://localhost:4000') {
  const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}${raw.includes(':') ? '' : ':4000'}`;
  return url.replace(/\/+$/, '');
}
const API_INTERNAL_URL = apiInternalUrl();

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
