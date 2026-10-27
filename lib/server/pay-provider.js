// Crypto checkout. PAY_PROVIDER picks the provider: 'nowpayments' (default) or 'gateway' (our own service in gateway/).
// Gateway env: GATEWAY_URL, GATEWAY_API_SECRET (sent as a Bearer token), GATEWAY_WEBHOOK_SECRET (signs the callback).
// NOWPayments: NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET switch it on. NOWPAYMENTS_API_URL points it at the sandbox
// (https://api-sandbox.nowpayments.io/v1). APP_URL is the public address used for the return and callback links.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = () => (process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1').replace(/\/+$/, '');
export const baseUrl = () => (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');
// The admin's choice (meta "payprovider", loaded by lib/server/pay-setting.js) wins over PAY_PROVIDER, which stays the fallback.
let chosen = null;
export const setProviderChoice = (v) => {
  chosen = v === 'gateway' || v === 'nowpayments' ? v : null;
};
export const provider = () => chosen || (String(process.env.PAY_PROVIDER || '').trim().toLowerCase() === 'gateway' ? 'gateway' : 'nowpayments');
// The gateway address must be https. Plain http is allowed only inside Railway's private network (*.railway.internal) or
// on this machine, where the traffic never crosses the internet. The Bearer secret would otherwise travel in clear.
export function gatewayUrlOk(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  const h = u.hostname;
  return u.protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.railway.internal'));
}

// Gateway secrets must be 16+ characters, the same minimum the gateway enforces on its own side.
const gatewayReady = () =>
  gatewayUrlOk(process.env.GATEWAY_URL) && String(process.env.GATEWAY_API_SECRET || '').length >= 16 && String(process.env.GATEWAY_WEBHOOK_SECRET || '').length >= 16;

export const nowReady = () => !!(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET);
// Whether a provider has everything it needs (the admin can switch only to one that is ready).
export const readyFor = (name) => (name === 'gateway' ? gatewayReady() : nowReady());
export const cryptoEnabled = () => readyFor(provider());
// Callbacks of either provider are accepted while its secret is set, so an order opened before a switch still settles.
export const callbacksEnabled = () => !!(process.env.GATEWAY_WEBHOOK_SECRET || process.env.NOWPAYMENTS_IPN_SECRET);

// Gateway invoice for the order: a direct address in the coin chosen on the order (order.network and order.asset, BTC when none), a payment uri and the exact amount. Asking again with the same
// order id returns the same invoice (200), so a retry is safe. 409 (same ref, other details) and 503 (no price) fail.
async function createGatewayInvoice(order) {
  const res = await fetch(`${process.env.GATEWAY_URL.replace(/\/+$/, '')}/v1/invoices`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GATEWAY_API_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ref: order.id, usd: order.usd, network: order.network || 'btc', asset: order.asset || 'btc', kind: 'order' }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => null);
  const inv = j?.invoice;
  if (!(res.status === 200 || res.status === 201) || !inv?.id || !inv?.address || !inv?.uri) throw new Error(`gateway invoice failed (${res.status})`);
  return {
    id: String(inv.id),
    url: null,
    address: String(inv.address),
    uri: String(inv.uri),
    amount: String(inv.amount),
    expiresAt: inv.expires_at ? String(inv.expires_at) : null,
  };
}

// Connect wallet on Solana: the gateway writes the unsigned transfer for the order's invoice, paid from `from` (a wallet address).
// { ok: true, tx (base64) } or { ok: false, status, error }.
export async function gatewaySolTx(ref, from) {
  if (provider() !== 'gateway' || !gatewayReady()) return { ok: false, status: 503, error: 'Not available.' };
  try {
    const res = await fetch(`${process.env.GATEWAY_URL.replace(/\/+$/, '')}/v1/invoices/${encodeURIComponent(ref)}/sol-tx?from=${encodeURIComponent(from)}`, {
      headers: { authorization: `Bearer ${process.env.GATEWAY_API_SECRET}` },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (res.ok && typeof j?.tx === 'string' && j.tx) return { ok: true, tx: j.tx };
    return { ok: false, status: res.status >= 400 && res.status < 600 ? res.status : 502, error: String(j?.error || 'Not available.').slice(0, 120) };
  } catch {
    return { ok: false, status: 502, error: 'Not available.' };
  }
}

// One invoice for the order. NOWPayments: a hosted page where the buyer picks the coin. Gateway: address + uri + amount.
export async function createInvoice(order, description) {
  if (provider() === 'gateway') return createGatewayInvoice(order);
  const base = baseUrl();
  const back = order.kind === 'deposit' ? 'wallet' : 'plans'; // a top-up returns to the wallet, a plan order to the plans
  const res = await fetch(`${API()}/invoice`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      price_amount: order.usd,
      price_currency: 'usd',
      order_id: order.id,
      order_description: description,
      ipn_callback_url: `${base}/api/payments/webhook`,
      success_url: `${base}/${back}?paid=1`,
      cancel_url: `${base}/${back}`,
    }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.id || !j?.invoice_url) throw new Error(`invoice failed (${res.status})`);
  return { id: String(j.id), url: String(j.invoice_url) };
}

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// The callback carries x-nowpayments-sig: HMAC-SHA512 of the body with its keys sorted, signed with the IPN secret.
// Both the nested and the top-level-only key sort are accepted, since they differ only for nested objects.
export function verifySig(raw, sig) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  const got = String(sig || '').trim().toLowerCase();
  if (!secret || !got) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sign = (s) => createHmac('sha512', secret).update(s).digest('hex');
  const ok = same(sign(JSON.stringify(sortDeep(body))), got) || same(sign(JSON.stringify(body, Object.keys(body).sort())), got);
  return ok ? body : null;
}

// The gateway callback carries x-gateway-sig: hex HMAC-SHA512 of the JSON body with keys sorted recursively, signed with
// GATEWAY_WEBHOOK_SECRET. Constant-time compare. Returns the parsed body, or null when the signature is not valid.
export function verifyGatewaySig(raw, sig) {
  const secret = process.env.GATEWAY_WEBHOOK_SECRET;
  const got = String(sig || '').trim().toLowerCase();
  if (!secret || !got) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const want = createHmac('sha512', secret).update(JSON.stringify(sortDeep(body))).digest('hex');
  return same(want, got) ? body : null;
}

// Checks the callback by the signature header it carries (x-gateway-sig or x-nowpayments-sig), whichever provider is in use now.
export function verifyCallback(raw, headers) {
  const gw = headers.get('x-gateway-sig');
  const np = headers.get('x-nowpayments-sig');
  return (gw ? verifyGatewaySig(raw, gw) : null) || (np ? verifySig(raw, np) : null);
}
