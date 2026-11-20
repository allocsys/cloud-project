// How the web pages read data that lives in the database (reviews, flags, network figures). They ask the API over HTTP and never
// import lib/server, so the pages and the API can run as two services. API_URL = the API service; unset = this same server.
// A slow or failing answer gives the fallback, so a page still renders when the API is down.
//   siteData(path, fallback)                    fresh on every request (dynamic pages)
//   siteData(path, fallback, { revalidate: n }) kept n seconds (static pages: they stay static and refresh in the background)
const root = () => (process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');

export async function siteData(path, fallback, { revalidate = 0, timeout = 3000 } = {}) {
  try {
    const res = await fetch(root() + path, {
      headers: {
        accept: 'application/json',
        'user-agent': 'vtx-web',
        ...(process.env.API_SVC_SECRET ? { 'x-vtx-svc': process.env.API_SVC_SECRET } : {}),
      },
      signal: AbortSignal.timeout(timeout),
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' }),
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    return json && typeof json === 'object' && !Array.isArray(json) ? { ...fallback, ...json } : fallback;
  } catch {
    return fallback;
  }
}
