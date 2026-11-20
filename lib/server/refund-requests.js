// Refund requests. A person asks for a refund of a miner they bought, answering a short questionnaire; an admin approves
// (the miner is refunded the usual way, see refundMinerInTx below) or declines with a note. One open request per miner.
// The row lives in refund_requests so the admin can list them all; the answers are kept in its data.
import { q, getUser, withUser, withUsers, notify, ledger } from '@/lib/server/db';
import { REASONS, AGAIN, NOTE_MAX, DECISION_NOTE_MAX, REFUND_MS, refundDeadline, refundWindowText } from '@/lib/refund-rules';
import { getPrices } from '@/lib/server/prices';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// The miner was paid for (balance or crypto), not granted: the same test refundMiner uses.
const paidFor = (u, m) => u.history.some((h) => h.kind === 'purchase' && !h.refunded && (h.net === 'Balance' || h.net === 'Crypto') && (h.serial ? h.serial === m.serial : Math.abs((h.at || 0) - m.startedAt) <= 10000));

const pub = (r) => ({
  id: r.id,
  userId: r.user_id,
  serial: r.serial,
  status: r.status,
  at: Number(r.at),
  reason: r.data.reason || '',
  again: r.data.again || '',
  note: r.data.note || '',
  answer: r.data.answer || '',
});

// What the miner page needs: this person's requests, and for each miner they may still ask about, the last moment to do it.
export async function myRefunds(userId, now = Date.now()) {
  const requests = (await q('SELECT id, user_id, serial, status, at, data FROM refund_requests WHERE user_id = $1 ORDER BY at DESC LIMIT 20', [userId])).rows.map(pub);
  const u = await getUser(userId);
  const asked = new Set(requests.filter((r) => r.status === 'pending').map((r) => r.serial));
  const open = {};
  for (const m of u?.contracts || []) {
    const d = refundDeadline(m);
    if (d && now <= d && !asked.has(m.serial) && paidFor(u, m)) open[m.serial] = d;
  }
  return { requests, open };
}

// input: { reason, again?, note? }. `now` is only for tests.
export async function createRequest(userId, serial, input, now = Date.now()) {
  const reason = String(input?.reason ?? '');
  if (!REASONS.includes(reason)) return fail(422, 'Pick a reason.');
  const again = String(input?.again ?? '');
  if (again && !AGAIN.includes(again)) return fail(422, 'Pick one of the answers.');
  const note = text(input?.note, NOTE_MAX);
  if (reason === 'other' && note.length < 3) return fail(422, 'Tell us in a few words.');
  if (userId === 'demo') return fail(409, 'The demo account cannot ask for a refund.');

  return withUser(userId, async (u, c) => {
    if (!u) return fail(404, 'User not found.');
    const m = u.contracts.find((x) => x.serial === String(serial));
    if (!m) return fail(404, 'Miner not found.');
    const d = refundDeadline(m);
    if (!d || !paidFor(u, m)) return fail(409, 'This miner cannot be refunded.');
    if (now > d) return fail(409, refundWindowText());
    const id = `rr${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const data = { reason, ...(again ? { again } : {}), ...(note ? { note } : {}) };
    const r = await c.query("INSERT INTO refund_requests (id, user_id, serial, status, at, data) VALUES ($1, $2, $3, 'pending', $4, $5::jsonb) ON CONFLICT DO NOTHING", [id, userId, m.serial, now, JSON.stringify(data)]);
    if (!r.rowCount) return fail(409, 'A refund request for this miner is already open.');
    return { ...done, id };
  });
}

// Refund requests a page at a time, for the admin screen. open: only pending requests. Open ones come first, then the newest.
// all and open are exact counts of the whole table; shown is the size of the list asked for.
export async function adminRefundPage({ open = false, offset = 0, limit = 20 } = {}) {
  const [r, c] = await Promise.all([
    q(`SELECT id, user_id, serial, status, at, data FROM refund_requests ${open ? "WHERE status = 'pending'" : ''} ORDER BY (status = 'pending') DESC, at DESC, id DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    q("SELECT count(*)::int AS n_all, count(*) FILTER (WHERE status = 'pending')::int AS n_open FROM refund_requests"),
  ]);
  const { n_all: all, n_open: nOpen } = c.rows[0];
  return { rows: r.rows.map(pub), shown: open ? nOpen : all, open: nOpen, all };
}

const DAY_MS = 86400000;

// A full refund, the one the Terms promise: within 24 hours of the miner starting and before its first payout day has
// finished (payout days run 00:00 to 24:00 UTC, see earnings.js). Only miners that were paid for (balance or crypto)
// qualify, never admin grants, welcome gifts or the demo account. The miner is removed, so whatever it had accrued goes
// with it, and its price is credited back as a signed balance entry in BTC at the live rate; the ledger row keeps the USD
// and the rate. If that was the buyer's last paid miner, their welcome gift goes too, so a refund cannot keep the gift.
// Runs on an account the caller already locked (withUser), on that transaction's client — it must not open its own
// transaction, or the locks would be taken in the opposite order from the reject path and the two could deadlock.
export async function refundMinerInTx(u, c, serial, rate, now) {
  if (!u) return fail(404, 'User not found.');
  const i = u.contracts.findIndex((x) => x.serial === serial);
  if (i < 0) return fail(404, 'Miner not found.');
  const m = u.contracts[i];
  if (m.bonus) return fail(409, 'A free gift miner has nothing to refund.');
  if (!Number.isFinite(m.startedAt) || !(m.price > 0)) return fail(409, 'This miner has no purchase record, so it cannot be refunded here.');
  if (now - m.startedAt > REFUND_MS) return { ...fail(409, 'More than 24 hours have passed since this miner started.'), window: true };
  if (Math.floor(now / DAY_MS) !== Math.floor(m.startedAt / DAY_MS)) return { ...fail(409, 'This miner has already passed its first payout day, so it is past the refund window.'), window: true };
  const paidRow = u.history.find((h) => h.kind === 'purchase' && !h.refunded && (h.net === 'Balance' || h.net === 'Crypto') && (h.serial ? h.serial === m.serial : Math.abs((h.at || 0) - m.startedAt) <= 10000));
  if (!paidRow) return fail(409, 'This miner was not paid for (it was granted), so there is nothing to refund.');

  const usd = Math.round(m.price * 100) / 100;
  const btc = Math.round((usd / rate) * 1e8) / 1e8;
  u.contracts.splice(i, 1);
  // The row stays in the activity (the first-buy bonus is not given twice) but no longer counts as a plan: the 14-day
  // deposit hold and the fee clock (lib/deposit-hold.js, serviceSince) ignore it, so a refund cannot lift the hold.
  paidRow.refunded = true;
  // The miner behind this friend's first purchase: the inviter's first-purchase reward and the friend's place in VIP go with it (referrals.js).
  if (u.refFirstSerial && u.refFirstSerial === m.serial) u.refFirstVoid = true;
  let gifts = 0;
  if (!u.contracts.some((x) => !x.bonus)) {
    gifts = u.contracts.filter((x) => x.bonus).length;
    if (gifts) u.contracts = u.contracts.filter((x) => !x.bonus);
  }
  u.adjust = Math.round(((u.adjust || 0) + btc) * 1e8) / 1e8;
  u.history.unshift({ kind: 'adjustment', label: `Refund · ${m.name}`, date: 'Just now', at: Date.now(), amount: `+${btc.toFixed(8)}`, coin: 'BTC', net: 'BTC' });
  notify(u, { kind: 'purchase', title: 'Refund', body: `${m.serial} was refunded: ${btc.toFixed(8)} BTC ($${usd.toFixed(2)}) is back in your balance.${gifts ? ' The welcome gift miner was removed with it.' : ''}`, code: 'refund', vars: { serial: m.serial, btc: btc.toFixed(8), usd: usd.toFixed(2), gift: !!gifts } });
  await ledger(c, u.id, 'adjust', { btc, usd, ref: `Refund ${m.serial} · $${usd.toFixed(2)} at $${rate}/BTC` });
  return { ...done, serial: m.serial, btc, usd, rate, gifts };
}

// decision: 'approve' or 'reject'. Approving refunds the miner the usual way (refundMinerInTx above); if that refuses
// (the window has closed, the miner is gone) the request stays open and the reason is returned, so the admin can
// decline it with a note. Declining tells the person, with the admin's note.
export async function decideRefund(userId, id, decision, note) {
  if (decision !== 'approve' && decision !== 'reject') return fail(400, 'Unknown decision.');
  const row = (await q('SELECT status, serial FROM refund_requests WHERE id = $1 AND user_id = $2', [String(id), userId])).rows[0];
  if (!row) return fail(404, 'Request not found.');
  const to = decision === 'approve' ? 'approved' : 'rejected';
  if (row.status === to) return done; // the same decision twice: nothing more to do
  if (row.status !== 'pending') return fail(409, `This request is already ${row.status}.`);
  const answer = text(note, DECISION_NOTE_MAX);

  if (decision === 'approve') {
    // Both decisions take the locks in the same order — the account row first, the request row second — in one
    // transaction, so they serialize instead of deadlocking. The approve used to lock the request row and then
    // refund through a second transaction for the account row, while the reject locks the account row first:
    // the two orders deadlocked, and Postgres could not see it, because one leg waited in this server (the
    // approve sat idle holding the request lock while its refund waited for the account row the reject held).
    // The request row stays locked from the re-check until the refund and the status update commit, so a
    // concurrent reject (or a second approve) waits instead of slipping in between them: without the lock the
    // refund could stand while the request ended up rejected, or the approval could report ok after updating
    // nothing. The price is read before the transaction, never inside it.
    const rate = (await getPrices()).prices.btc;
    if (!(rate > 0)) return fail(503, 'No BTC price is available right now. Try again in a moment.');
    return withUser(userId, async (u, c) => {
      if (!u) return fail(404, 'User not found.');
      const cur = (await c.query('SELECT status FROM refund_requests WHERE id = $1 AND user_id = $2 FOR UPDATE', [String(id), userId])).rows[0];
      if (!cur) return fail(404, 'Request not found.');
      if (cur.status === 'approved') return done; // the same decision twice: nothing more to do
      if (cur.status !== 'pending') return fail(409, `This request is already ${cur.status}.`);
      const r = await refundMinerInTx(u, c, row.serial, rate, Date.now());
      if (!r.ok) return r.window ? { ...r, error: 'The refund window closed before this was approved. Decline it with a note, so the person is told.' } : r;
      const upd = await c.query("UPDATE refund_requests SET status = 'approved', data = data || $2::jsonb WHERE id = $1 AND status = 'pending'", [String(id), JSON.stringify({ decidedAt: Date.now() })]);
      if (!upd.rowCount) return fail(409, 'This request is no longer pending.');
      return { ...done, btc: r.btc, usd: r.usd };
    });
  }

  return withUsers([userId], async (map, c) => {
    const u = map.get(userId);
    const cur = (await c.query('SELECT status FROM refund_requests WHERE id = $1 AND user_id = $2 FOR UPDATE', [String(id), userId])).rows[0];
    if (!u || !cur) return fail(404, 'Request not found.');
    if (cur.status !== 'pending') return cur.status === 'rejected' ? done : fail(409, `This request is already ${cur.status}.`);
    await c.query("UPDATE refund_requests SET status = 'rejected', data = data || $2::jsonb WHERE id = $1", [String(id), JSON.stringify({ decidedAt: Date.now(), ...(answer ? { answer } : {}) })]);
    notify(u, { kind: 'purchase', title: 'Refund declined', body: `Your refund request for ${row.serial} was declined.${answer ? ` ${answer}` : ''}`, code: 'refundNo', vars: { serial: row.serial, note: answer ? ` ${answer}` : '' } });
    return done;
  });
}
