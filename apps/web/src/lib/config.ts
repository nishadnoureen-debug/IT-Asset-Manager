/**
 * Browser calls go to the same origin (`/api/v1`), which Next.js proxies to the API (see next.config.ts).
 * This keeps the refresh-token cookie first-party and avoids CORS in the browser.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '/api/v1').replace(/\/+$/, '');
