// Settlement core: turns what the chain shows for one order invoice into a status and, when the outcome is final,
// ONE callback row in the outbox. Pure database logic: the caller (the watcher) fetches the chain data, so this is
// fully testable without a network.
//
// Rules
//  - Only payments with enough confirmations count. Smaller ones show the invoice as 'confirming'.
//  - Confirmed total >= expected  ->  'paid' (overpaying is fine and recorded), event 'finished'.
//  - After the invoice expires: some confirmed money -> 'partial' (event 'partially_paid'); none -> 'expired' (event 'expired').
//    If a payment is still unconfirmed at expiry we wait for it, but at most 24 hours.
//  - Once an event is queued the outcome never changes. Money that arrives later is recorded and audited ('payment.late').
//  - Calling observe() again with the same data changes nothing (idempotent). Never call it when the chain lookup failed:
//    an empty list means "nothing on chain", and unconfirmed payments missing from it are dropped.
import { q, tx } from './db.js';
import { CHAINS } from './chains/index.js';
import { fmtAtomic } from './invoices.js';

const GRACE_MS = 24 * 3_600_000;
const OPEN = ['pending', 'confirming', 'partial'];
const TXID = /^[0-9a-f]{64}$/;
const AMOUNT = /^[1-9][0-9]{0,37}$/;

function clean(t) {
  const ok =
    t &&
    TXID.test(String(t.txid)) &&
    Number.isInteger(t.vout) &&
    t.vout >= 0 &&
    AMOUNT.test(String(t.amount)) &&
    Number.isInteger(t.confirmations) &&
    t.confirmations >= 0 &&
    (t.height === null || t.height === undefined || Number.isInteger(t.height));
  if (!ok) throw new Error('Invalid chain payment data.');
  return { txid: t.txid, vout: t.vout, amount: String(t.amount), confirmations: t.confirmations, height: t.height ?? null };
}

function payload(inv, status, confirmed) {
  const dec = CHAINS[inv.network].decimals;
  return {
    order_id: inv.ref,
    payment_id: inv.id,
    payment_status: status,
    price_amount: Number(inv.usd),
    price_currency: 'usd',
    pay_currency: inv.asset,
    network: inv.network,
    pay_amount: fmtAtomic(inv.expected_atomic, dec),
    actually_paid: fmtAtomic(confirmed, dec),
  };
}

// Order invoices that still need watching: not paid or finalised yet (an expired one stays here until its outcome is queued).
export async function openInvoices() {
  const r = await q(
    `SELECT id, network, address FROM invoices i
     WHERE kind = 'order' AND status = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM webhook_outbox o WHERE o.invoice_id = i.id)
     ORDER BY created_at`,
    [OPEN],
  );
  return r.rows;
}

// seen: [{ txid, vout, amount (atomic units, string), confirmations, height }] paying this invoice's address.
export async function observe(invoiceId, seen, now = new Date()) {
  const list = seen.map(clean);
  return tx(async (c) => {
    const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId])).rows[0];
    if (!inv) throw new Error(`Unknown invoice ${invoiceId}.`);
    if (inv.kind !== 'order' || inv.expected_atomic === null) throw new Error('Only order invoices are settled here.');
    const minConf = CHAINS[inv.network].confirmations();
    const hasEvent = (await c.query('SELECT 1 FROM webhook_outbox WHERE invoice_id = $1 LIMIT 1', [inv.id])).rowCount > 0;
    const open = OPEN.includes(inv.status) && !hasEvent;

    const keys = new Set();
    for (const t of list) {
      keys.add(`${t.txid}:${t.vout}`);
      const r = await c.query(
        `INSERT INTO chain_txs (invoice_id, network, txid, vout, amount_atomic, confirmations, block_height)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (network, txid, vout) DO UPDATE SET confirmations = EXCLUDED.confirmations, block_height = EXCLUDED.block_height
         WHERE chain_txs.invoice_id = EXCLUDED.invoice_id
         RETURNING (xmax = 0) AS inserted`,
        [inv.id, inv.network, t.txid, t.vout, t.amount, t.confirmations, t.height],
      );
      if (!open && r.rows[0]?.inserted) {
        await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('watcher', 'payment.late', $1, $2::jsonb)", [
          inv.id,
          JSON.stringify({ txid: t.txid, vout: t.vout, amount: t.amount, status: inv.status }),
        ]);
      }
    }

    if (open) {
      const have = (await c.query('SELECT id, txid, vout, confirmations FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows;
      for (const r of have) {
        if (keys.has(`${r.txid}:${r.vout}`)) continue;
        if (r.confirmations < minConf) await c.query('DELETE FROM chain_txs WHERE id = $1', [r.id]);
        else await c.query('UPDATE chain_txs SET confirmations = 0 WHERE id = $1', [r.id]);
      }
    }

    const rows = (await c.query('SELECT amount_atomic, confirmations FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows;
    let confirmed = 0n;
    let unconfirmed = 0;
    for (const r of rows) {
      if (r.confirmations >= minConf) confirmed += BigInt(r.amount_atomic);
      else unconfirmed++;
    }

    let status = inv.status;
    let event = null;
    if (open) {
      const expectedAtomic = BigInt(inv.expected_atomic);
      const expiredFor = now.getTime() - inv.expires_at.getTime();
      if (confirmed >= expectedAtomic) {
        status = 'paid';
        event = 'finished';
      } else if (expiredFor >= 0 && (unconfirmed === 0 || expiredFor >= GRACE_MS)) {
        if (confirmed > 0n) {
          status = 'partial';
          event = 'partially_paid';
        } else {
          status = 'expired';
          event = 'expired';
        }
      } else {
        status = confirmed > 0n ? 'partial' : rows.length > 0 ? 'confirming' : 'pending';
      }
    }

    if (status !== inv.status || String(confirmed) !== String(inv.received_atomic)) {
      await c.query(
        `UPDATE invoices SET status = $2, received_atomic = $3,
           paid_at = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN $4::timestamptz ELSE paid_at END
         WHERE id = $1`,
        [inv.id, status, confirmed.toString(), now],
      );
    }
    if (status !== inv.status) {
      await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('watcher', 'invoice.status', $1, $2::jsonb)", [
        inv.id,
        JSON.stringify({ from: inv.status, to: status, received: confirmed.toString() }),
      ]);
    }
    let queued = null;
    if (event) {
      const r = await c.query(
        'INSERT INTO webhook_outbox (invoice_id, event, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (invoice_id, event) DO NOTHING',
        [inv.id, event, JSON.stringify(payload(inv, event, confirmed))],
      );
      if (r.rowCount === 1) queued = event;
    }
    return { status, received_atomic: confirmed.toString(), queued };
  });
}
