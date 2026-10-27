// Routes under /v1, called by the app with `Authorization: Bearer <GATEWAY_API_SECRET>`.
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { hasDb } from './db.js';
import { ApiError, json, readJson } from './http.js';
import { createInvoice, getInvoice } from './invoices.js';
import { adminOverview, closeInvoice, handleUnmatched, setNetworkPaused } from './admin-api.js';
import { solTransferTx } from './sol-tx.js';

const digest = (s) => createHash('sha256').update(s).digest();

function authorized(req) {
  const secret = config().apiSecret;
  if (!secret) throw new ApiError(503, 'The gateway API is not configured.');
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return !!m && timingSafeEqual(digest(m[1]), digest(secret));
}

export async function handleApi(req, res, url) {
  try {
    if (!authorized(req)) return json(res, 401, { ok: false, error: 'Unauthorized.' });
    if (!hasDb()) throw new ApiError(503, 'No database.');

    if (url.pathname === '/v1/invoices' && req.method === 'POST') {
      const { invoice, created } = await createInvoice(await readJson(req));
      return json(res, created ? 201 : 200, { ok: true, invoice });
    }
    if (url.pathname === '/v1/admin/overview' && req.method === 'GET') {
      return json(res, 200, { ok: true, ...(await adminOverview()) });
    }
    if (url.pathname === '/v1/admin/unmatched/handle' && req.method === 'POST') {
      return json(res, 200, { ok: true, ...(await handleUnmatched(await readJson(req))) });
    }
    if (url.pathname === '/v1/admin/invoice/close' && req.method === 'POST') {
      return json(res, 200, { ok: true, ...(await closeInvoice(await readJson(req))) });
    }
    if (url.pathname === '/v1/admin/network/pause' && req.method === 'POST') {
      return json(res, 200, { ok: true, ...(await setNetworkPaused(await readJson(req))) });
    }
    const sm = /^\/v1\/invoices\/([^/]+)\/sol-tx$/.exec(url.pathname);
    if (sm && req.method === 'GET') {
      let ref = sm[1];
      try {
        ref = decodeURIComponent(ref);
      } catch {}
      return json(res, 200, { ok: true, tx: await solTransferTx(ref, url.searchParams.get('from')) });
    }
    const m = /^\/v1\/invoices\/([^/]+)$/.exec(url.pathname);
    if (m && req.method === 'GET') {
      let ref = m[1];
      try {
        ref = decodeURIComponent(ref);
      } catch {}
      return json(res, 200, { ok: true, invoice: await getInvoice(ref) });
    }
    return json(res, 404, { ok: false, error: 'Not found.' });
  } catch (e) {
    if (e instanceof ApiError) return json(res, e.status, { ok: false, error: e.message });
    console.error('[api] failed:', e.message);
    return json(res, 500, { ok: false, error: 'Server error.' });
  }
}
