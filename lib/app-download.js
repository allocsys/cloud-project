// The public address the app file is downloaded from. It is the API's own Railway address on purpose: downloads do not pass
// the Cloudflare Worker (daily request limit). proxy.js lets this one path through without the edge header, with its own limit.
export const DOWNLOAD_PATH = '/api/download';
export const DOWNLOAD_URL = `https://api-production-c43ecae7.up.railway.app${DOWNLOAD_PATH}`;
// Store pages: set each one when the app is published there. Empty = not shown. With one or more set, the menu item opens a list.
export const GOOGLE_PLAY_URL = '';
export const APP_STORE_URL = '';
