import type { MetadataRoute } from 'next';

/**
 * What a browser reads before offering to install the app. Served at /manifest.webmanifest and
 * linked from every page by Next.
 *
 * The icons are built from the logo by `node scripts/make-icons.mjs` — rerun it after a rebrand.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ZABY TRACKER',
    short_name: 'ZABY',
    description: 'Track company IT devices through their full lifecycle.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#233952',
    orientation: 'any',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Long-press the installed icon to land straight on the job in hand.
    shortcuts: [
      { name: 'Scan a label', url: '/scan', description: 'Look up whoever holds a device' },
      { name: 'Assets', url: '/assets', description: 'Every device the company owns' },
      { name: 'Employees', url: '/employees', description: 'Who has what' },
    ],
  };
}
