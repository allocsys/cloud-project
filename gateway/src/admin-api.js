// Read-only overview for the app's admin Gateway tab. Called by the app (never by a browser) with the same Bearer secret as /v1/invoices.
// It changes nothing. Amounts are shown in coin units; txids, addresses and invoice ids are public chain or random data.
import { q } from './db.js';
import { CHAINS } from './chains/index.js';
import { fmtAtomic } from './invoices.js';

// Atomic units as a decimal string in the coin's own unit, or null when the network or asset is not known.
function coin(network, asset, atomic) {
  if (atomic === null || atomic === undefined) return null;
  try {
    const dec = Object.hasOwn(CHAINS, network) ? CHAINS[network].decimalsOf(asset) : undefined;
    return dec === undefined ? null : fmtAtomic(atomic, dec);
  } catch {
    return null;
  }
}

function networks() {
  return Object.entries(CHAINS).map(([network, ch]) => {
    let configured = false;
    let address = null;
    try {
      configured = !!ch.configured();
      if (configured && ch.shared()) address = ch.address(0);
    } catch {}
    return { network, configured, shared: !!ch.shared(), assets: ch.assets, confirmations: ch.confirmations(), address };
  });
}

export async function adminOverview() {
  const [cursors, counts, recent, unmatched, unmatchedCount, outbox, failing, audit] = await Promise.all([
    q('SELECT network, height::text AS height, tip::text AS tip, EXTRACT(EPOCH FROM now() - updated_at)::int AS age_s FROM chain_cursors ORDER BY network'),
    q('SELECT status, count(*)::int AS n FROM invoices GROUP BY status'),
    q(
      `SELECT id, ref, kind, network, asset, usd, expected_atomic::text AS expected, received_atomic::text AS received, status, created_at, expires_at, paid_at
       FROM invoices ORDER BY created_at DESC LIMIT 25`,
    ),
    q('SELECT network, asset, address, txid, vout, amount_atomic::text AS amount, confirmations, seen_at FROM unmatched_txs ORDER BY seen_at DESC LIMIT 50'),
    q('SELECT count(*)::int AS n FROM unmatched_txs'),
    q(
      `SELECT count(*) FILTER (WHERE delivered_at IS NULL)::int AS pending,
              count(*) FILTER (WHERE delivered_at IS NULL AND attempts > 0)::int AS failing
       FROM webhook_outbox`,
    ),
    q(
      `SELECT o.event, o.attempts, o.last_error, o.next_try_at, i.ref
       FROM webhook_outbox o JOIN invoices i ON i.id = o.invoice_id
       WHERE o.delivered_at IS NULL AND o.attempts > 0 ORDER BY o.next_try_at LIMIT 10`,
    ),
    q('SELECT at, actor, action, subject FROM audit_log ORDER BY id DESC LIMIT 20'),
  ]);
  return {
    now: new Date().toISOString(),
    networks: networks(),
    scanners: cursors.rows.map((r) => ({ network: r.network, height: r.height, tip: r.tip, age_s: r.age_s })),
    invoices: {
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      recent: recent.rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        kind: r.kind,
        network: r.network,
        asset: r.asset,
        usd: r.usd === null ? null : Number(r.usd),
        expected: coin(r.network, r.asset, r.expected),
        received: coin(r.network, r.asset, r.received),
        status: r.status,
        created_at: r.created_at,
        expires_at: r.expires_at,
        paid_at: r.paid_at,
      })),
    },
    unmatched: {
      total: unmatchedCount.rows[0].n,
      recent: unmatched.rows.map((r) => ({
        network: r.network,
        asset: r.asset,
        address: r.address,
        txid: r.txid,
        vout: r.vout,
        amount: coin(r.network, r.asset, r.amount),
        confirmations: r.confirmations,
        seen_at: r.seen_at,
      })),
    },
    callbacks: {
      pending: outbox.rows[0].pending,
      failing: outbox.rows[0].failing,
      stuck: failing.rows.map((r) => ({ ref: r.ref, event: r.event, attempts: r.attempts, last_error: r.last_error ? String(r.last_error).slice(0, 200) : null, next_try_at: r.next_try_at })),
    },
    audit: audit.rows,
  };
}
