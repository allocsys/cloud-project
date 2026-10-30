// The public address of the app, for the sitemap, canonical links and link previews. Same fixed address as the invite and
// email links (lib/server/account.js). Set APP_URL once the app has its own domain.
// The social pages shown in the landing footer. A network with an empty address is not shown, so fill each in once the
// account exists (full address, e.g. https://x.com/name, https://t.me/name, https://instagram.com/name).
// telegram = the channel, bot = the Telegram app (mini app / bot).
export const SOCIALS = { x: '', telegram: '', bot: '', instagram: '' };

export const SITE_URL = (process.env.APP_URL || 'https://vertexhash.com').replace(/\/+$/, '');
