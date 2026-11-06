// Refund requests. A person asks for a refund of a miner they bought, answering a short questionnaire; an admin approves
// (the miner is refunded the usual way, see refundMiner in admin.js) or declines with a note. One open request per miner.
// The row lives in refund_requests so the admin can list them all; the answers are kept in its data.
import { q, getUser, withUser, withUsers, notify } from '@/lib/server/db';
import { REASONS, AGAIN, NOTE_MAX, DECISION_NOTE_MAX, refundDeadline, refundWindowText } from '@/lib/refund-rules';

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

// Newest first; the open ones are the ones that need a person.
export async function adminRefunds(limit = 60) {
  const r = await q('SELECT id, user_id, serial, status, at, data FROM refund_requests ORDER BY (status = \'pending\') DESC, at DESC LIMIT $1', [limit]);
  return r.rows.map(pub);
}

// decision: 'approve' or 'reject'. Approving refunds the miner through refundFn (refundMiner, handed in because admin.js imports this
// file); if that refuses (the window has closed, the miner is gone) the request stays open and the reason is returned, so the
// admin can decline it with a note. Declining tells the person, with the admin's note.
export async function decideRefund(userId, id, decision, note, refundFn) {
  if (decision !== 'approve' && decision !== 'reject') return fail(400, 'Unknown decision.');
  const row = (await q('SELECT status, serial FROM refund_requests WHERE id = $1 AND user_id = $2', [String(id), userId])).rows[0];
  if (!row) return fail(404, 'Request not found.');
  const to = decision === 'approve' ? 'approved' : 'rejected';
  if (row.status === to) return done; // the same decision twice: nothing more to do
  if (row.status !== 'pending') return fail(409, `This request is already ${row.status}.`);
  const answer = text(note, DECISION_NOTE_MAX);

  if (decision === 'approve') {
    const r = await refundFn(userId, row.serial);
    if (!r.ok) return r.window ? { ...r, error: 'The refund window closed before this was approved. Decline it with a note, so the person is told.' } : r;
    await q("UPDATE refund_requests SET status = 'approved', data = data || $2::jsonb WHERE id = $1 AND status = 'pending'", [String(id), JSON.stringify({ decidedAt: Date.now() })]);
    return { ...done, btc: r.btc, usd: r.usd };
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
