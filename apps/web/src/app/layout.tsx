import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { InstallApp } from '@/components/install-app';

export const metadata: Metadata = {
  title: { default: 'ZABY TRACKER', template: '%s · ZABY TRACKER' },
  description: 'Track company IT devices through their full lifecycle.',
  applicationName: 'ZABY TRACKER',
  // Installed on an iPhone it runs full screen, with its own name under the icon.
  appleWebApp: { capable: true, title: 'ZABY TRACKER', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          {children}
          <InstallApp />
        </Providers>
      </body>
    </html>
  );
}
