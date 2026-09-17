import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IT Asset Management', template: '%s · IT Asset Management' },
  description: 'Track company IT devices through their full lifecycle.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
