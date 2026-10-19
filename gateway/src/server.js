// Opus gateway entry point. Plain node:http, no framework, so it runs unchanged on any host.
// Config comes only from environment variables. Nothing here imports from the app (app/, lib/, components/).
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 4000;

export function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'opus-gateway' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found.' }));
}

const server = createServer(handler);

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  server.listen(PORT, '0.0.0.0', () => console.log(`[gateway] listening on ${PORT}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
