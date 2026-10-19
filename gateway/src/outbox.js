// Outbox sender: delivers the signed payment callbacks that settle.js queued in webhook_outbox to the app.
//
// Delivery is AT LEAST ONCE. The app's settleOrder activates an order once however often it is told, so a repeat is harmless.
// Safe with several replicas: a due row is claimed with FOR UPDATE SKIP LOCKED and given a short lease (next_try_at pushed
// forward) before any network call, so no row is held locked while we wait for the app, and two replicas do not send the same row.
// The lease (60 s) is longer than the request timeout (10 s), so a row is only re-sent early if this process dies mid-send.
//
// Failure policy (one retry layer): a failed send (network error, timeout, any non-2xx answer) records the error and schedules the
// next try with exponential backoff (30 s, 1 min, 2 min ... up to 1 hour). After MAX_ATTEMPTS the row is parked (next_try_at =
// infinity), an audit entry is written, and it stays undelivered for a person to look at. Nothing is ever dropped silently.
// Redirects are refused (a signed body must not be forwarded elsewhere). Neither the secret nor the body is ever logged.
import { createHmac } from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

export const MAX_ATTEMPTS = 24;
const LEASE_SECONDS = 60;
const TIMEOUT_MS = 10_000;
const note = (log, level, msg, data) => log[level](JSON.stringify({ level, msg, ...data }));

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

// hex HMAC-SHA512 of the JSON body with its keys sorted recursively. The app verifies the same way (verifyGatewaySig).
export const signBody = (payload, secret) => createHmac('sha512', secret).update(JSON.stringify(sortDeep(payload))).digest('hex');

// Seconds to wait after the nth failed attempt (n starts at 1): 30, 60, 120 ... capped at one hour.
export const backoffSeconds = (attempts) => Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);

// The place callbacks go to, or null when it is not set up. Throws on a bad setup so the service refuses to start.
export function webhookTarget(c = config()) {
  if (!c.appWebhookUrl && !c.webhookSecret) return null;
  if (!c.appWebhookUrl) throw new Error('GATEWAY_WEBHOOK_SECRET is set but APP_WEBHOOK_URL is not');
  let u;
  try {
    u = new URL(c.appWebhookUrl);
  } catch {
    throw new Error('APP_WEBHOOK_URL is not a valid URL');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('APP_WEBHOOK_URL must be https');
  if (c.webhookSecret.length < 16) throw new Error('GATEWAY_WEBHOOK_SECRET must be at least 16 characters');
  return { url: u.toString(), secret: c.webhookSecret };
}

async function send(row, { url, secret }, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs); // a real timer: it is cleared below, and never leaves the loop hanging
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gateway-sig': signBody(row.payload, secret),
        'x-gateway-event': row.event,
        'x-gateway-delivery': String(row.id),
      },
      body: JSON.stringify(row.payload),
      redirect: 'error',
      signal: ctl.signal,
    });
    try {
      await res.body?.cancel();
    } catch {}
    if (!res.ok) throw new Error(`app answered HTTP ${res.status}`);
  } catch (e) {
    throw new Error(ctl.signal.aborted ? 'timed out' : String(e.message || 'request failed').slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
}

// Sends every row that is due (at most `limit`). Returns { claimed, delivered, failed, parked }.
export async function deliverDue({ target, fetchImpl = fetch, limit = 20, timeoutMs = TIMEOUT_MS, log = console } = {}) {
  const t = target || webhookTarget();
  const out = { claimed: 0, delivered: 0, failed: 0, parked: 0 };
  if (!t) return out;
  const rows = (
    await q(
      `UPDATE webhook_outbox SET next_try_at = now() + make_interval(secs => $2)
       WHERE id IN (SELECT id FROM webhook_outbox WHERE delivered_at IS NULL AND next_try_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, invoice_id, event, payload, attempts`,
      [limit, LEASE_SECONDS],
    )
  ).rows;
  out.claimed = rows.length;
  for (const row of rows) {
    try {
      await send(row, t, fetchImpl, timeoutMs);
      await q('UPDATE webhook_outbox SET delivered_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1 AND delivered_at IS NULL', [row.id]);
      out.delivered++;
      note(log, 'info', 'outbox.delivered', { id: row.id, invoice: row.invoice_id, event: row.event });
    } catch (e) {
      const attempts = row.attempts + 1;
      const park = attempts >= MAX_ATTEMPTS;
      await q(
        `UPDATE webhook_outbox SET attempts = $2, last_error = $3, next_try_at = ${park ? "'infinity'" : 'now() + make_interval(secs => $4)'} WHERE id = $1 AND delivered_at IS NULL`,
        park ? [row.id, attempts, e.message] : [row.id, attempts, e.message, backoffSeconds(attempts)],
      );
      if (park) {
        out.parked++;
        await q("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('gateway', 'webhook.gave_up', $1, $2::jsonb)", [row.invoice_id, JSON.stringify({ outbox: row.id, event: row.event, attempts, error: e.message })]);
        note(log, 'error', 'outbox.gave_up', { id: row.id, invoice: row.invoice_id, event: row.event, attempts, error: e.message });
      } else {
        out.failed++;
        note(log, 'error', 'outbox.failed', { id: row.id, invoice: row.invoice_id, event: row.event, attempts, error: e.message });
      }
    }
  }
  return out;
}

// Starts the sender loop. Returns stop(), which waits for a round in progress to finish.
export function startOutbox({ target, intervalMs, fetchImpl, log = console }) {
  let stopped = false;
  let timer = null;
  let running = Promise.resolve();

  async function tick() {
    running = deliverDue({ target, fetchImpl, log }).catch((e) => note(log, 'error', 'outbox.tick_failed', { error: e.message }));
    await running;
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  }

  timer = setTimeout(tick, 0);
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
