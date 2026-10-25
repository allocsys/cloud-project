// Web app manifest. Served at /manifest.webmanifest and linked automatically.
// The description, lang and dir follow the language cookie. The name stays Miner Opus.
import { getLang, getT } from '@/lib/i18n/server';
import { LANGS } from '@/lib/i18n/langs';

export default async function manifest() {
  const lang = await getLang();
  const t = await getT();
  return {
    name: 'Miner Opus',
    short_name: 'Miner Opus',
    description: t('meta.manifest'),
    lang,
    dir: LANGS[lang].dir,
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
