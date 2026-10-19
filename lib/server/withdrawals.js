// Withdrawal requests after they are made (see withdraw() in wallet.js, which reserves the balance and saves a 'pending' row).
// Statuses: pending -> approved -> sent. A request that is rejected (pending) or failed (approved) gives the reserved
// amount back. Nothing here moves money on-chain: 'sent' is recorded by an admin who paid it, or later by the gateway.
//
// Concurrency: the account is locked first, then the withdrawal row (same order as settleOrder), so two admins or two
// servers cannot refund the same request twice. Repeating a decision that already happened is a harmless no-op.
import { q, withUsers, ledger, notify } from '@/lib/server/db';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

// decision -> [status it may start from, status it ends in, whether the reserved amount goes back]
const MOVES = {
  approve: [['pending'], 'approved', false],
  sent: [['approved'], 'sent', false],
  reject: [['pending'], 'rejected', true],
  fail: [['approved'], 'failed', true],
};

const TEXT = {
  approved: ['Withdrawal approved', 'is approved and will be paid soon'],
  sent: ['Withdrawal sent', 'was sent to your wallet'],
  rejected: ['Withdrawal rejected', 'was not approved. The amount is back in your balance'],
  failed: ['Withdrawal failed', 'could not be paid. The amount is back in your balance'],
};

const pub = (r) => ({
  id: r.id,
  userId: r.user_id,
  status: r.status,
  at: Number(r.at),
  asset: r.data.asset,
  net: r.data.net,
  address: r.data.address,
  amount: r.data.amount,
  receive: r.data.receive,
  btc: r.data.btc,
  txid: r.data.txid || null,
});

// Newest first. Pending and approved ones are the ones that need a person.
export async function adminWithdrawals(limit = 60) {
  const r = await q('SELECT id, user_id, status, at, data FROM withdrawals ORDER BY at DESC LIMIT $1', [limit]);
  return r.rows.map(pub);
}

export async function reviewWithdrawal(userId, id, decision, txid) {
  const move = Object.hasOwn(MOVES, decision) ? MOVES[decision] : null;
  if (!move) return fail(400, 'Unknown decision.');
  const [from, to, refund] = move;
  const tx = String(txid ?? '').trim();
  if (decision === 'sent' && (tx.length < 6 || tx.length > 120)) return fail(422, 'Add the transaction id of the payout.');

  return withUsers([userId], async (map, c) => {
    const u = map.get(userId);
    const w = (await c.query('SELECT status, data FROM withdrawals WHERE id = $1 AND user_id = $2 FOR UPDATE', [String(id), userId])).rows[0];
    if (!u || !w) return fail(404, 'Withdrawal not found.');
    if (w.status === to) return done; // same decision twice: nothing more to do
    if (!from.includes(w.status)) return fail(409, `This withdrawal is ${w.status}, so it cannot be ${to}.`);

    const d = { ...w.data, [`${to}At`]: Date.now() };
    if (decision === 'sent') d.txid = tx;
    await c.query('UPDATE withdrawals SET status = $2, data = $3::jsonb WHERE id = $1', [String(id), to, JSON.stringify(d)]);

    const entry = u.history.find((h) => h.wid === String(id));
    if (entry) entry.status = to;
    if (refund) {
      u.withdrawn = Math.max(0, (u.withdrawn || 0) - d.btc);
      await ledger(c, userId, 'withdrawal_refund', { btc: d.btc, ref: `${id} ${to}` });
    }
    const [title, body] = TEXT[to];
    notify(u, { kind: 'withdrawal', title, body: `${d.amount} ${String(d.asset).toUpperCase()} ${body}` });
    return done;
  });
}
