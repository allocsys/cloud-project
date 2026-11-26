// The public address the app file is downloaded from. It is the API's own Railway address on purpose: downloads do not pass
// the Cloudflare Worker (daily request limit). proxy.js lets this one path through without the edge header, with its own limit.
export const DOWNLOAD_PATH = '/api/download';
export const DOWNLOAD_URL = `https://api-production-c43ecae7.up.railway.app${DOWNLOAD_PATH}`;
