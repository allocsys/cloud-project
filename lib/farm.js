// "Our farm" section on the landing page: videos the admin adds by pasting a link (Google Drive, YouTube or Vimeo).
// Nothing is uploaded to our server and the files stay in the admin's own account. This file holds the rules and has no imports.
// Storage is lib/server/farm.js (meta entry "farm").
export const FARM_MAX = 12; // videos kept
export const TITLE_MAX = 60;

const YT = /^[A-Za-z0-9_-]{11}$/;
const DRIVE = /^[A-Za-z0-9_-]{10,80}$/;

// Turns a pasted link into a safe player address. Only an id that matches a strict pattern is used, so nothing else from the link reaches the page.
// Returns { kind, embed, thumb } or null. thumb is empty when the provider has no picture we can reach without a key.
export function parseVideo(raw) {
  let u;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = '';
    if (host === 'youtu.be') id = parts[0] || '';
    else if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
    if (!YT.test(id)) return null;
    return { kind: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    if (host === 'player.vimeo.com' && parts[0] !== 'video') return null;
    const id = (host === 'vimeo.com' ? parts[0] : parts[1]) || '';
    if (!/^\d{4,15}$/.test(id)) return null;
    // An unlisted Vimeo video carries a hash: vimeo.com/ID/HASH or player.vimeo.com/video/ID?h=HASH.
    const h = (host === 'vimeo.com' ? parts[1] : u.searchParams.get('h')) || '';
    if (h && !/^[a-f0-9]{6,20}$/i.test(h)) return null;
    return { kind: 'vimeo', embed: `https://player.vimeo.com/video/${id}?${h ? `h=${h}&` : ''}playsinline=1`, thumb: '' };
  }

  if (host === 'drive.google.com') {
    let id = '';
    if (parts[0] === 'file' && parts[1] === 'd') id = parts[2] || '';
    else if (parts[0] === 'open' || parts[0] === 'uc') id = u.searchParams.get('id') || '';
    if (!DRIVE.test(id)) return null;
    return { kind: 'drive', embed: `https://drive.google.com/file/d/${id}/preview`, thumb: '' };
  }
  return null;
}

// Checks one video typed by the admin. Returns { video } or { error }. A title is never cut short: too long is refused.
export function cleanVideo(input) {
  const title = String(input?.title ?? '').trim().replace(/\s+/g, ' ');
  const url = String(input?.url ?? '').trim();
  if (!title) return { error: 'Add a short title.' };
  if (title.length > TITLE_MAX) return { error: `The title is over ${TITLE_MAX} characters. Shorten it.` };
  if (url.length > 300) return { error: 'The link is too long.' };
  const p = parseVideo(url);
  if (!p) return { error: 'Paste a Google Drive, YouTube or Vimeo link (https://...).' };
  return { video: { title, url, kind: p.kind, embed: p.embed, thumb: p.thumb } };
}
