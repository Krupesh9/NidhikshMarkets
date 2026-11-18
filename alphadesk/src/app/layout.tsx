import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Nidhiksh Pulse', template: '%s · Nidhiksh Pulse' },
  description: 'Research and decision platform for PMs and equity analysts. Research only — not investment advice.',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Pulse', statusBarStyle: 'black-translucent' },
  applicationName: 'Nidhiksh Pulse',
};

export const viewport: Viewport = { themeColor: '#0b0d10', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
