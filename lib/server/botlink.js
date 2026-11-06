// Link code for the Telegram bot. An email account has no Telegram id, so the bot cannot find it. The person asks for a code in
// Settings (valid 10 minutes, works once) and sends it to the bot (/link CODE). Only a hash of the code is kept.
// The code uses letters and digits that cannot be mixed up (no 0, O, 1, I, L).
import { createHash, randomInt } from 'node:crypto';
import { q, withUser, hit, release } from '@/lib/server/db';

export const LINK_MS = 10 * 60_000;
export const LINK_WAIT_MS = 60_000;
export const LINK_LEN = 8;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const linkHash = (code) => createHash('sha256').update(String(code ?? '').trim().toUpperCase()).digest('hex');
export const newLinkCode = () => Array.from({ length: LINK_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const fail = (status, error) => ({ ok: false, status, error });
const BAD_CODE = 'Code not valid.';
const HAS_ACCOUNT = 'This Telegram already has an account.';
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
export async function botLinkClaim(tgId, code) {
  if (!Number.isSafeInteger(tgId) || tgId <= 0) return fail(400, 'Bad tg_id.');
  const key = `bl:${tgId}`;
  if (await hit(key, CLAIM_TRIES)) return fail(429, 'Too many tries.');
  const h = linkHash(code);
  const r = await q("SELECT id FROM users WHERE data->'botLink' IS NOT NULL AND data->'botLink'->>'h' = $1 LIMIT 1", [h]);
  const id = r.rows[0]?.id;
  if (!id || !id.includes('@')) return fail(404, BAD_CODE);
  // One Telegram id, one account. Already linked: 409. Has its own Telegram account (tg:<id>): 403, because linking a second account would split money and miners; the person adds an email to that account instead.
  if ((await q("SELECT 1 FROM users WHERE data->>'botTg' = $1 LIMIT 1", [String(tgId)])).rowCount) return fail(409, 'This Telegram is already linked to another account.');
  if ((await q('SELECT 1 FROM users WHERE id = $1', [`tg:${tgId}`])).rowCount) return fail(403, HAS_ACCOUNT);
  let res;
  try {
    res = await withUser(id, (u) => {
      if (!u || u.botTg || u.botLink?.h !== h || !(u.botLink.exp > Date.now())) return fail(404, BAD_CODE);
      u.botTg = tgId;
      delete u.botLink;
      return { ok: true, status: 200, email: maskEmail(id) };
    });
  } catch (e) {
    if (e?.code === '23505') return fail(409, 'This Telegram is already linked to another account.');
    throw e;
  }
  if (res.ok) await release(key);
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
