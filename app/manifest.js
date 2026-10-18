// Web app manifest. Served at /manifest.webmanifest and linked automatically.
export default function manifest() {
  return {
    name: 'Opus Cloud Mining',
    short_name: 'Opus',
    description: 'Rent hash power and mine bitcoin without owning a machine.',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#12110d',
    theme_color: '#12110d',
    categories: ['finance'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
