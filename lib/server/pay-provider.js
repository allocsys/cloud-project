// Crypto checkout through NOWPayments hosted invoices.
// Env: NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET switch it on. NOWPAYMENTS_API_URL points it at the sandbox
// (https://api-sandbox.nowpayments.io/v1). APP_URL is the public address used for the return and callback links.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = () => (process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1').replace(/\/+$/, '');
export const baseUrl = () => (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');
export const cryptoEnabled = () => !!(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET);

// One hosted invoice for the order. The buyer picks the coin on the provider's page.
export async function createInvoice(order, description) {
  const base = baseUrl();
  const res = await fetch(`${API()}/invoice`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      price_amount: order.usd,
      price_currency: 'usd',
      order_id: order.id,
      order_description: description,
      ipn_callback_url: `${base}/api/payments/webhook`,
      success_url: `${base}/plans?paid=1`,
      cancel_url: `${base}/plans`,
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
