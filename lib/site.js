// The public address of the app, for the sitemap, canonical links and link previews. Same fixed address as the invite and
// email links (lib/server/account.js). Set APP_URL once the app has its own domain.
export const SITE_URL = (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');
