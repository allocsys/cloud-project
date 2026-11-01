// Overview for the app's admin Gateway tab. Called by the app (never by a browser) with the same Bearer secret as /v1/invoices.
// The overview changes nothing. The one write is handleUnmatched(): a person returned an unmatched payment by hand and marks it
// done (the gateway holds no keys and sends no money). Amounts are shown in coin units; txids, addresses and invoice ids are public chain or random data.
import { q, tx } from './db.js';
import { CHAINS } from './chains/index.js';
import { fmtAtomic } from './invoices.js';
import { ApiError } from './http.js';
import { payload } from './settle.js';

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

// paused: Set of paused network names. open: Map of network to its number of open invoices.
function networks(paused = new Set(), open = new Map()) {
  return Object.entries(CHAINS).map(([network, ch]) => {
    let configured = false;
    let address = null;
    try {
      configured = !!ch.configured();
      if (configured && ch.shared()) address = ch.address(0);
    } catch {}
    return { network, configured, shared: !!ch.shared(), assets: ch.assets, confirmations: ch.confirmations(), address, paused: paused.has(network), open: open.get(network) || 0 };
  });
}

// Marks one unmatched payment handled, with a short note (how it was returned). Repeating it is fine: nothing changes the second time.
// The watcher never re-opens it (recordUnmatched only updates confirmations on a conflict).
export async function handleUnmatched(input) {
  const network = typeof input?.network === 'string' ? input.network : '';
  const txid = typeof input?.txid === 'string' ? input.txid : '';
  const vout = input?.vout;
  const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 80) : '';
  if (!Object.hasOwn(CHAINS, network) || !txid || txid.length > 128 || !Number.isInteger(vout) || vout < 0) throw new ApiError(400, 'Invalid request.');
  return tx(async (c) => {
    const row = (await c.query('SELECT id, handled_at FROM unmatched_txs WHERE network = $1 AND txid = $2 AND vout = $3 FOR UPDATE', [network, txid, vout])).rows[0];
    if (!row) throw new ApiError(404, 'Not found.');
    if (row.handled_at) return { handled: true, already: true };
    await c.query('UPDATE unmatched_txs SET handled_at = now(), handled_note = $2 WHERE id = $1', [row.id, note || null]);
    await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('admin', 'unmatched.handled', $1, $2::jsonb)", [
      `${network}:${txid}`,
      JSON.stringify({ vout, note }),
    ]);
    return { handled: true, already: false };
  });
}

// Closes one order invoice that is still waiting and that nobody will pay: it becomes 'expired' and the usual 'expired' callback is queued,
// so the app closes the order too. Refused when a payment was seen on it (let the watcher finish) or when its outcome is already queued.
// Repeating it is fine. The row lock pairs with observe(), so the watcher and this never both decide.
// A payment sent after closing does not count for the invoice; it shows up in the unmatched list (on its own address the watcher keeps looking for 14 days).
export async function closeInvoice(input) {
  const id = typeof input?.id === 'string' ? input.id : '';
  if (!id || id.length > 80) throw new ApiError(400, 'Invalid request.');
  return tx(async (c) => {
    const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!inv || inv.kind !== 'order' || inv.expected_atomic === null) throw new ApiError(404, 'Not found.');
    const queued = (await c.query('SELECT event FROM webhook_outbox WHERE invoice_id = $1', [id])).rows;
    if (inv.status === 'expired' && queued.some((r) => r.event === 'expired')) return { closed: true, already: true };
    if (inv.status !== 'pending' || queued.length > 0) throw new ApiError(409, 'This invoice is not waiting any more.');
    if ((await c.query('SELECT 1 FROM chain_txs WHERE invoice_id = $1 LIMIT 1', [id])).rowCount > 0) throw new ApiError(409, 'A payment was seen on it. Let it finish.');
    await c.query("UPDATE invoices SET status = 'expired' WHERE id = $1", [id]);
    await c.query('INSERT INTO webhook_outbox (invoice_id, event, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (invoice_id, event) DO NOTHING', [
      id,
      'expired',
      JSON.stringify(payload(inv, 'expired', 0n)),
    ]);
    await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('admin', 'invoice.closed', $1, $2::jsonb)", [id, JSON.stringify({ from: inv.status })]);
    return { closed: true, already: false };
  });
}

// Puts parked callbacks (the ones that failed MAX_ATTEMPTS times) back in the queue with a fresh set of tries. { id } picks one outbox row,
// no id means all of them. A row that is delivered or still waiting is not touched, so repeating it is fine. Audited as 'webhook.retry'.
export async function retryParked(input) {
  const id = input?.id;
  if (id !== undefined && id !== null && !Number.isInteger(id)) throw new ApiError(400, 'Invalid request.');
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE webhook_outbox SET attempts = 0, next_try_at = now()
       WHERE delivered_at IS NULL AND next_try_at = 'infinity' AND ($1::bigint IS NULL OR id = $1)
       RETURNING id`,
      [id ?? null],
    );
    if (r.rowCount > 0) {
      await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('admin', 'webhook.retry', 'outbox', $1::jsonb)", [JSON.stringify({ ids: r.rows.map((x) => Number(x.id)) })]);
    }
    return { retried: r.rowCount };
  });
}

// How many address indexes in a row, after the last one that ever received money, have been handed out with nothing on them.
// A wallet restored from the seed stops looking after 20 unused addresses in a row, so money past that may not show in it.
export const BTC_GAP_LIMIT = 20;
export const gapCount = (next, used) => Math.max(0, Number(next ?? 0) - 1 - (used === null || used === undefined ? -1 : Number(used)));

// Pauses or resumes one network. A paused network refuses new invoices, the watcher skips it and its block scanner stops calling the node.
// Pausing is refused while invoices are open on it (nothing would check them). Resuming changes nothing else: when an invoice opens the
// scanner wakes and reads back at most EVM_CATCHUP_HOURS (payments older than that are not tracked).
// The exclusive lock pairs with the shared lock createInvoice() takes, so an invoice cannot slip in while the network is pausing.
export async function setNetworkPaused(input) {
  const network = typeof input?.network === 'string' ? input.network : '';
  const paused = input?.paused;
  if (!Object.hasOwn(CHAINS, network) || typeof paused !== 'boolean') throw new ApiError(400, 'Invalid request.');
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pause:${network}`]);
    const was = (await c.query('SELECT 1 FROM paused_networks WHERE network = $1', [network])).rows.length > 0;
    if (paused === was) return { paused, already: true };
    if (paused) {
      const open = Number(
        (
          await c.query(
            `SELECT count(*) AS n FROM invoices i
             WHERE i.kind = 'order' AND i.network = $1 AND i.status IN ('pending', 'confirming', 'partial')
               AND NOT EXISTS (SELECT 1 FROM webhook_outbox o WHERE o.invoice_id = i.id)`,
            [network],
          )
        ).rows[0].n,
      );
      if (open > 0) throw new ApiError(409, `${open} open invoice${open === 1 ? '' : 's'} on this network. Wait until ${open === 1 ? 'it is' : 'they are'} paid or expired.`);
      await c.query('INSERT INTO paused_networks (network) VALUES ($1)', [network]);
    } else {
      await c.query('DELETE FROM paused_networks WHERE network = $1', [network]);
    }
    await c.query("INSERT INTO audit_log (actor, action, subject) VALUES ('admin', $1, $2)", [paused ? 'network.pause' : 'network.resume', network]);
    return { paused, already: false };
  });
}

export async function adminOverview() {
  const [cursors, counts, recent, unmatched, unmatchedCount, outbox, failing, audit, pausedRows, openRows, alertRows, gapRows] = await Promise.all([
    q('SELECT network, height::text AS height, tip::text AS tip, EXTRACT(EPOCH FROM now() - updated_at)::int AS age_s FROM chain_cursors ORDER BY network'),
    q('SELECT status, count(*)::int AS n FROM invoices GROUP BY status'),
    q(
      `SELECT id, ref, kind, network, asset, usd, expected_atomic::text AS expected, received_atomic::text AS received, status, created_at, expires_at, paid_at
       FROM invoices ORDER BY (status IN ('pending', 'confirming', 'partial')) DESC, created_at DESC LIMIT 25`,
    ),
    q('SELECT network, asset, address, txid, vout, amount_atomic::text AS amount, confirmations, seen_at FROM unmatched_txs WHERE handled_at IS NULL ORDER BY seen_at DESC LIMIT 50'),
    q('SELECT count(*)::int AS n FROM unmatched_txs WHERE handled_at IS NULL'),
    q(
      `SELECT count(*) FILTER (WHERE delivered_at IS NULL)::int AS pending,
              count(*) FILTER (WHERE delivered_at IS NULL AND attempts > 0)::int AS failing,
              count(*) FILTER (WHERE delivered_at IS NULL AND next_try_at = 'infinity')::int AS parked
       FROM webhook_outbox`,
    ),
    q(
      `SELECT o.event, o.attempts, o.last_error, (o.next_try_at = 'infinity') AS parked,
              CASE WHEN o.next_try_at = 'infinity' THEN NULL ELSE o.next_try_at END AS next_try_at, i.ref
       FROM webhook_outbox o JOIN invoices i ON i.id = o.invoice_id
       WHERE o.delivered_at IS NULL AND o.attempts > 0 ORDER BY (o.next_try_at = 'infinity') DESC, o.next_try_at LIMIT 10`,
    ),
    q('SELECT at, actor, action, subject FROM audit_log ORDER BY id DESC LIMIT 20'),
    q('SELECT network FROM paused_networks'),
    q(
      `SELECT network, count(*)::int AS n FROM invoices i
       WHERE i.kind = 'order' AND i.status IN ('pending', 'confirming', 'partial')
         AND NOT EXISTS (SELECT 1 FROM webhook_outbox o WHERE o.invoice_id = i.id)
       GROUP BY network`,
    ),
    // Things a person has to look at, last 30 days: a payment that came after its invoice ended, a callback that gave up, an address that is full.
    q(
      `SELECT a.at, a.action, a.subject, a.detail, i.ref, i.network, i.asset
       FROM audit_log a LEFT JOIN invoices i ON i.id = a.subject
       WHERE a.action IN ('payment.late', 'webhook.gave_up', 'unmatched.full') AND a.at > now() - interval '30 days'
       ORDER BY a.id DESC LIMIT 20`,
    ),
    q(
      `SELECT (SELECT next_index FROM address_counters WHERE network = 'btc')::bigint AS next,
              (SELECT max(i.deriv_index) FROM invoices i
               WHERE i.network = 'btc' AND NOT i.match_amount
                 AND (EXISTS (SELECT 1 FROM chain_txs c WHERE c.invoice_id = i.id)
                      OR EXISTS (SELECT 1 FROM unmatched_txs u WHERE u.network = 'btc' AND u.address = i.address)))::bigint AS used`,
    ),
  ]);
  // Only when Bitcoin gives each invoice its own address (extended key); a fixed address has no gap.
  let btcGap = null;
  try {
    if (CHAINS.btc.configured() && !CHAINS.btc.shared()) btcGap = { gap: gapCount(gapRows.rows[0].next, gapRows.rows[0].used), limit: BTC_GAP_LIMIT };
  } catch {}
  return {
    now: new Date().toISOString(),
    networks: networks(new Set(pausedRows.rows.map((r) => r.network)), new Map(openRows.rows.map((r) => [r.network, r.n]))),
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
      parked: outbox.rows[0].parked,
      stuck: failing.rows.map((r) => ({ ref: r.ref, event: r.event, attempts: r.attempts, parked: r.parked === true, last_error: r.last_error ? String(r.last_error).slice(0, 200) : null, next_try_at: r.next_try_at })),
    },
    audit: audit.rows,
    alerts: alertRows.rows.map((r) => {
      const d = r.detail && typeof r.detail === 'object' ? r.detail : {};
      const known = r.network && r.asset && /^[0-9]{1,38}$/.test(String(d.amount ?? ''));
      return {
        at: r.at,
        action: r.action,
        subject: r.subject,
        ref: r.ref || null,
        network: r.network || null,
        asset: r.asset || null,
        amount: known ? coin(r.network, r.asset, d.amount) : null,
        txid: typeof d.txid === 'string' ? d.txid : null,
        event: typeof d.event === 'string' ? d.event : null,
        error: typeof d.error === 'string' ? d.error.slice(0, 200) : null,
      };
    }),
    btcGap,
  };
}
