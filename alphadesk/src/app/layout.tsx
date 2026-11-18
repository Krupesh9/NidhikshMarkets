import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'NidhikshDesk', template: '%s · NidhikshDesk' },
  description: 'Research and decision platform for PMs and equity analysts. Research only — not investment advice.',
  icons: { icon: '/nidhiksh-logo.png', apple: '/nidhiksh-logo.png' },
  applicationName: 'NidhikshDesk',
};

export const viewport: Viewport = { themeColor: '#0b0d10', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
