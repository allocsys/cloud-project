// Deposit invoices for an app order (kind 'order') or wallet top-up (kind 'deposit').
// A network with an extended public key gives each invoice its own address. A network in fixed-address mode gives every invoice
// the same address and a unique exact amount instead (see alloc.js).
// Creating is idempotent on `ref`: the same ref returns the same invoice, and never uses a second address or amount.
import { randomBytes } from 'node:crypto';
import { q, tx } from './db.js';
import { config } from './config.js';
import { CHAINS } from './chains/index.js';
import { usdRate } from './rates.js';
import { ApiError } from './http.js';
import { quantumRule, quantumAtomic, pickAmount } from './alloc.js';

const REF = /^[A-Za-z0-9_-]{1,64}$/;

// Smallest wallet top-up. Keep in step with MIN_DEPOSIT_USD in the app's lib/data.js. Plan orders are not deposits.
export const MIN_DEPOSIT_USD = 30;

export function fmtAtomic(atomic, dec) {
  const s = BigInt(atomic).toString().padStart(dec + 1, '0');
  return `${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`;
}

export function publicInvoice(r) {
  const ch = CHAINS[r.network];
  const amount = r.expected_atomic === null ? null : fmtAtomic(r.expected_atomic, ch.decimalsOf(r.asset));
  return {
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    network: r.network,
    asset: r.asset,
    address: r.address,
    usd: r.usd === null ? null : Number(r.usd),
    amount,
    amount_atomic: r.expected_atomic,
    received_atomic: r.received_atomic,
    rate_usd: r.rate_usd === null ? null : Number(r.rate_usd),
    status: r.status,
    uri: ch.uri(r.address, amount, r.asset),
    created_at: r.created_at.toISOString(),
    expires_at: r.expires_at.toISOString(),
    paid_at: r.paid_at ? r.paid_at.toISOString() : null,
  };
}

function parse(input) {
  const ref = String(input.ref ?? '');
  if (!REF.test(ref)) throw new ApiError(400, 'Invalid ref.');
  const kind = input.kind ?? 'order';
  if (kind !== 'order' && kind !== 'deposit') throw new ApiError(400, 'Invalid kind.');
  const network = String(input.network ?? 'btc');
  const asset = String(input.asset ?? 'btc');
  const chain = Object.hasOwn(CHAINS, network) ? CHAINS[network] : null;
  if (!chain || !chain.assets.includes(asset)) throw new ApiError(400, 'Unsupported coin or network.');
  if (!chain.configured()) throw new ApiError(503, 'This network is not set up yet.');
  let usd = null;
  if (input.usd !== undefined && input.usd !== null) {
    const n = Number(input.usd);
    if (!Number.isFinite(n) || n < 0.01 || n > 1_000_000) throw new ApiError(400, 'Invalid usd amount.');
    usd = Math.round(n * 100) / 100;
  }
  if (kind === 'order' && usd === null) throw new ApiError(400, 'usd is required for an order.');
  if (chain.shared() && usd === null) throw new ApiError(400, 'usd is required on this network.');
  const userRef = input.user_ref === undefined || input.user_ref === null ? null : String(input.user_ref).slice(0, 100);
  if (kind === 'deposit' && !userRef) throw new ApiError(400, 'user_ref is required for a deposit.');
  if (kind === 'deposit' && usd !== null && usd < MIN_DEPOSIT_USD) throw new ApiError(400, `The minimum deposit is $${MIN_DEPOSIT_USD}.`);
  return { ref, kind, network, asset, usd, userRef, chain };
}

const sameAs = (ex, p) =>
  ex.kind === p.kind && ex.network === p.network && ex.asset === p.asset && p.usd === (ex.usd === null ? null : Number(ex.usd));

function replay(ex, p) {
  if (!sameAs(ex, p)) throw new ApiError(409, 'This ref is already used with different details.');
  return { invoice: publicInvoice(ex), created: false };
}

export async function createInvoice(input) {
  const p = parse(input);
  const ex = (await q('SELECT * FROM invoices WHERE ref = $1', [p.ref])).rows[0];
  if (ex) return replay(ex, p);

  const dec = p.chain.decimalsOf(p.asset);
  let rate = null;
  let expected = null;
  if (p.usd !== null) {
    try {
      rate = await usdRate(p.asset);
    } catch (e) {
      console.error('[invoices] no rate:', e.message);
      throw new ApiError(503, 'Price unavailable. Try again shortly.');
    }
    // The payer sends a little more than the price (default 2%) so fees, commissions and a price move do not leave the invoice short.
    // Any extra stays with us: the order is settled at its dollar price.
    const base = (p.usd / rate) * 10 ** dec;
    const margin = config().invoiceBufferPct;
    expected = BigInt(Math.ceil(margin > 0 ? (base * (100 + margin)) / 100 : base)).toString();
  }
  const shared = p.chain.shared();

  const out = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice:${p.ref}`]);
    const again = (await c.query('SELECT * FROM invoices WHERE ref = $1', [p.ref])).rows[0];
    if (again) return { row: again, created: false };
    // Pausing a network takes the same lock exclusively and refuses while invoices are open, so no invoice can slip in as it pauses.
    await c.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [`pause:${p.network}`]);
    if ((await c.query('SELECT 1 FROM paused_networks WHERE network = $1', [p.network])).rows.length) throw new ApiError(503, 'This network is paused.');
    const next = await c.query(
      `INSERT INTO address_counters (network, next_index) VALUES ($1, 1)
       ON CONFLICT (network) DO UPDATE SET next_index = address_counters.next_index + 1
       RETURNING next_index - 1 AS idx`,
      [p.network],
    );
    const index = Number(next.rows[0].idx);
    const address = p.chain.address(index);
    let amount = expected;
    if (shared) {
      // One address for everyone: pick an amount no other open or recent invoice on this address and asset expects.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`alloc:${p.network}:${p.asset}:${address}`]);
      const rows = (
        await c.query(
          `SELECT expected_atomic::text AS a FROM invoices
           WHERE network = $1 AND asset = $2 AND address = $3 AND expected_atomic IS NOT NULL
             AND (status IN ('pending', 'confirming', 'partial') OR created_at > now() - interval '14 days')`,
          [p.network, p.asset, address],
        )
      ).rows;
      const rule = quantumRule(p.asset);
      const pick = pickAmount(BigInt(expected), quantumAtomic(rule.usd, rate, dec), new Set(rows.map((r) => r.a)), rule.slots);
      if (pick === null) throw new ApiError(503, 'Too many open invoices. Try again shortly.');
      amount = pick.toString();
    }
    const id = `inv_${randomBytes(9).toString('base64url')}`;
    const ins = await c.query(
      `INSERT INTO invoices (id, ref, kind, user_ref, network, asset, address, deriv_index, usd, expected_atomic, rate_usd, expires_at, match_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [id, p.ref, p.kind, p.userRef, p.network, p.asset, address, index, p.usd, amount, rate, new Date(Date.now() + config().invoiceTtlMs), shared],
    );
    await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('app', 'invoice.create', $1, $2::jsonb)", [
      id,
      JSON.stringify({ ref: p.ref, network: p.network, asset: p.asset, index, usd: p.usd, shared }),
    ]);
    return { row: ins.rows[0], created: true };
  });
  return out.created ? { invoice: publicInvoice(out.row), created: true } : replay(out.row, p);
}

export async function getInvoice(ref) {
  const r = REF.test(String(ref)) ? (await q('SELECT * FROM invoices WHERE ref = $1', [String(ref)])).rows[0] : null;
  if (!r) throw new ApiError(404, 'Invoice not found.');
  return publicInvoice(r);
}
