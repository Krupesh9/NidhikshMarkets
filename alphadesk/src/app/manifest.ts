import type { MetadataRoute } from 'next';

/** Web app manifest: lets Nidhiksh Pulse be installed with its own icon (Dock, home screen, Start menu). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nidhiksh Pulse',
    short_name: 'Pulse',
    description: 'Private markets research: live prices, analyst views, news and calendar.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: '#0b0d10',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
