// Link code for the Telegram bot. An email account has no Telegram id, so the bot cannot find it. The person asks for a code in
// Settings (valid 10 minutes, works once) and sends it to the bot (/link CODE). Only a hash of the code is kept.
// The code uses letters and digits that cannot be mixed up (no 0, O, 1, I, L).
import { createHash, randomInt } from 'node:crypto';
import { q, tx, usersIn, warm, withUser, hit, release } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { forgetSessions } from '@/lib/server/auth';
import { mergeTelegram } from '@/lib/server/botmerge';

export const LINK_MS = 10 * 60_000;
export const LINK_WAIT_MS = 60_000;
export const LINK_LEN = 8;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const linkHash = (code) => createHash('sha256').update(String(code ?? '').trim().toUpperCase()).digest('hex');
export const newLinkCode = () => Array.from({ length: LINK_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const fail = (status, error) => ({ ok: false, status, error });
const BAD_CODE = 'Code not valid.';
const NEED_CONFIRM = 'This Telegram already has an account. Confirm to merge it.';
// m***@gmail.com: shown to the person in the bot after a link, never the full address.
export const maskEmail = (e) => {
  const [n, d] = String(e ?? '').split('@');
  return `${String(n || '').slice(0, 1)}***@${d || ''}`;
};
const CLAIM_TRIES = 5;

// A new code for the signed-in email account. One per minute; a new code replaces the old one. Telegram accounts do not need it.
export async function botLinkStart(id) {
  if (!id || id === 'demo') return fail(403, 'Sign in to your own account first.');
  if (!id.includes('@')) return fail(403, 'Only email accounts need a link code.');
  const code = newLinkCode();
  return withUser(id, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (u.botTg) return fail(409, 'This account is already linked to Telegram.');
    if (u.botLink && Date.now() - u.botLink.at < LINK_WAIT_MS) return fail(429, 'A code was just made. Wait a minute before asking again.');
    u.botLink = { h: linkHash(code), exp: Date.now() + LINK_MS, at: Date.now() };
    return { ok: true, status: 200, code, expires: u.botLink.exp };
  });
}

// The bot sends the Telegram id and the code a person typed (/link CODE). 5 tries per Telegram id per 15 minutes; a good code gives its try back.
// A wrong, used or expired code all get the same answer. One Telegram id links to one account only (unique index users_bot_tg_idx: 409).
// A Telegram id that already has its own account (tg:<id>) is merged into the email account (lib/server/botmerge.js), but only after the person
// confirms: without { confirm: true } the answer is 428 with the masked email, nothing changes, the code stays valid and the try is given back.
// With the confirmation the merge and the link happen in one transaction. 423 = the Telegram account has an unfinished payment or withdrawal.
export async function botLinkClaim(tgId, code, { confirm = false } = {}) {
  if (!Number.isSafeInteger(tgId) || tgId <= 0) return fail(400, 'Bad tg_id.');
  const key = `bl:${tgId}`;
  if (await hit(key, CLAIM_TRIES)) return fail(429, 'Too many tries.');
  const h = linkHash(code);
  const r = await q("SELECT id FROM users WHERE data->'botLink' IS NOT NULL AND data->'botLink'->>'h' = $1 LIMIT 1", [h]);
  const id = r.rows[0]?.id;
  if (!id || !id.includes('@')) return fail(404, BAD_CODE);
  // One Telegram id, one account. Already linked: 409. These are a fast pre-check only: both are checked again under the lock below,
  // in case the other side appeared in between.
  const tgAcc = `tg:${tgId}`;
  const ask = { ok: false, status: 428, confirm: true, error: NEED_CONFIRM, email: maskEmail(id) };
  if ((await q("SELECT 1 FROM users WHERE data->>'botTg' = $1 LIMIT 1", [String(tgId)])).rowCount) return fail(409, 'This Telegram is already linked to another account.');
  if (!confirm && (await q('SELECT 1 FROM users WHERE id = $1', [tgAcc])).rowCount) {
    await release(key); // a good code that waits for the person's answer is not a wrong try
    return ask;
  }
  const market = confirm ? await getMarket() : null; // warmed before the locks (the merge works out the rebate of an account that had an inviter)
  await warm();
  let res;
  try {
    res = await tx(async (c) => {
      // Under the Telegram id's advisory lock (the same one telegramLogin takes) the checks above are made again, so a Telegram account created
      // or a link claimed in between cannot leave one Telegram user with two accounts. It is taken before the account rows are locked.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`tg-link:${tgId}`]);
      return usersIn(c, [id, tgAcc], async (map) => {
        const u = map.get(id);
        if (!u || u.botTg || u.botLink?.h !== h || !(u.botLink.exp > Date.now())) return fail(404, BAD_CODE);
        if ((await c.query("SELECT 1 FROM users WHERE data->>'botTg' = $1 LIMIT 1", [String(tgId)])).rowCount) return fail(409, 'This Telegram is already linked to another account.');
        const s = map.get(tgAcc);
        let merged = false;
        if (s) {
          if (!confirm) return ask;
          const m = await mergeTelegram(c, u, s, market);
          if (!m.ok) return m;
          merged = true;
        }
        u.botTg = tgId;
        delete u.botLink;
        return { ok: true, status: 200, email: maskEmail(id), merged };
      });
    });
  } catch (e) {
    if (e?.code === '23505') return fail(409, 'This Telegram is already linked to another account.');
    throw e;
  }
  if (res.ok) {
    await release(key);
    if (res.merged) forgetSessions(tgAcc); // the Telegram account is closed: its open sessions end now
  } else if (res.confirm) await release(key);
  return res;
}

// Settings > Disconnect: removes the Telegram link from the signed-in email account. Bot notices stop and the Telegram id can link again.
export async function botDisconnect(id) {
  if (!id || id === 'demo' || !id.includes('@')) return fail(403, 'Only email accounts have a Telegram link.');
  return withUser(id, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (!u.botTg) return fail(409, 'Telegram is not connected.');
    delete u.botTg;
    return { ok: true, status: 200 };
  });
}
