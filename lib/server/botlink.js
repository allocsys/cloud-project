// Link code for the Telegram bot. An email account has no Telegram id, so the bot cannot find it. The person asks for a code in
// Settings (valid 10 minutes, works once) and sends it to the bot (/link CODE, next step). Only a hash of the code is kept.
// The code uses letters and digits that cannot be mixed up (no 0, O, 1, I, L).
import { createHash, randomInt } from 'node:crypto';
import { withUser } from '@/lib/server/db';

export const LINK_MS = 10 * 60_000;
export const LINK_WAIT_MS = 60_000;
export const LINK_LEN = 8;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const linkHash = (code) => createHash('sha256').update(String(code ?? '').trim().toUpperCase()).digest('hex');
export const newLinkCode = () => Array.from({ length: LINK_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const fail = (status, error) => ({ ok: false, status, error });

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
