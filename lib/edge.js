// Edge guard. When API_EDGE_SECRET is set, the API answers only calls that carry it in x-vtx-edge (the Cloudflare Worker adds it).
// The visitor's address then comes from x-vtx-ip, and only with a valid edge header. Off while the variable is unset.
// Shared file: no Node-only imports (middleware.js uses it).

const same = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export const edgeOn = () => !!process.env.API_EDGE_SECRET;

export function fromEdge(headers) {
  const s = process.env.API_EDGE_SECRET;
  return !!s && same(String(headers.get('x-vtx-edge') || ''), s);
}

// The visitor's address as the Worker saw it. null = not from the edge, or no usable value.
export function edgeAddress(headers) {
  if (!fromEdge(headers)) return null;
  const ip = String(headers.get('x-vtx-ip') || '').trim();
  return ip && ip.length <= 64 ? ip : null;
}

// Calls that need no edge header: Railway's health check and the signed machine calls (gateway webhook, hall telemetry, bot).
export const edgeFree = (pathname) => pathname === '/api/health' || pathname === '/api/payments/webhook' || pathname === '/api/telemetry' || pathname.startsWith('/api/bot/');
