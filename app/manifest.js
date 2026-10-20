// Web app manifest. Served at /manifest.webmanifest and linked automatically.
export default function manifest() {
  return {
    name: 'Miner Opus',
    short_name: 'Miner Opus',
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
      { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
