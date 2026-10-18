// Wallet ledger and withdrawals. In memory for now (resets on deploy): swap the `db` object
// for Postgres on Railway and keep the function signatures.
import { history as seed, MIN_WITHDRAW, START_BTC } from '@/lib/data';
import { ASSETS, NETWORKS, quote } from '@/lib/assets';
import { getPrices } from '@/lib/server/prices';

const SAT = 1e-8;
const SATS_PER_SEC = 0.22; // about the pace of the simulated feed. Replace with real mining accounting.
const TOLERANCE = 2e-6; // BTC. Covers the browser's simulated ticks running slightly ahead.
const BOOT = Date.now();

const db = (globalThis.__opusDb ||= { users: new Map(), idem: new Map() });

function userOf(id) {
  let u = db.users.get(id);
  if (!u) {
    u = { id, withdrawn: 0, history: seed.map((h) => ({ ...h })) };
    db.users.set(id, u);
  }
  return u;
}

function dateLabel(h, now) {
  if (!h.at) return h.date;
  if (now - h.at < 60_000) return 'Just now';
  return new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Single demo user until real auth lands: pass the signed-in user's id here.
export function getWallet(userId = 'demo') {
  const u = userOf(userId);
  const now = Date.now();
  return {
    earned: START_BTC + ((now - BOOT) / 1000) * SATS_PER_SEC * SAT,
    withdrawn: u.withdrawn,
    history: u.history.map((h) => ({ ...h, date: dateLabel(h, now) })),
    asOf: now,
  };
}

const fail = (status, error, field) => ({ ok: false, status, error, field });

// Validates against server prices and the server ledger, then applies the withdrawal.
// Same Idempotency-Key twice returns the first result instead of withdrawing twice.
export async function withdraw(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `${userId}:${key}` : null;
  if (idemKey && db.idem.has(idemKey)) return db.idem.get(idemKey);

  const asset = String(input?.asset ?? '');
  const net = String(input?.net ?? '');
  const amount = Number(input?.amount);
  const address = String(input?.address ?? '').trim();

  const A = Object.hasOwn(ASSETS, asset) ? ASSETS[asset] : null;
  if (!A || !Object.hasOwn(A.nets, net)) return fail(400, 'Unknown coin or network.');
  if (!Number.isFinite(amount) || amount <= 0) return fail(422, 'Enter an amount to withdraw.', 'amount');
  if (!NETWORKS[net].pattern.test(address)) return fail(422, `Enter a valid ${NETWORKS[net].label} address.`, 'address');

  const { prices } = await getPrices();
  const q = quote(asset, net, amount, prices);
  if (q.btc < MIN_WITHDRAW) return fail(422, `Below the minimum of ${MIN_WITHDRAW} BTC.`, 'amount');
  if (q.receive <= 0) return fail(422, 'Too small to cover the fees.', 'amount');

  // No awaits from here on, so the balance check and the write cannot interleave with another request.
  const u = userOf(userId);
  const available = getWallet(userId).earned - u.withdrawn;
  if (q.btc > available + TOLERANCE) return fail(409, 'More than your available balance.', 'amount');

  const entry = {
    kind: 'withdrawal',
    label: `Withdrawal · ${A.sym}`,
    date: 'Just now',
    at: Date.now(),
    amount: `-${amount.toFixed(A.dec)}`,
    coin: A.sym,
    net: NETWORKS[net].short,
    fee: `${q.netFee} ${A.sym}${q.swapUsd ? ` + $${q.swapUsd.toFixed(2)} swap` : ''}`,
  };
  u.withdrawn += q.btc;
  u.history.unshift(entry);

  const result = { ok: true, status: 200, entry, withdrawn: u.withdrawn, receive: q.receive, receiveUsd: q.receiveUsd };
  if (idemKey) {
    db.idem.set(idemKey, result);
    if (db.idem.size > 500) db.idem.delete(db.idem.keys().next().value);
  }
  return result;
}
