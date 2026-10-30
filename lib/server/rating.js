// Rate us: who is asked, and where the answer is kept (u.rating, or u.rateSkip for "Not now"). Rules: lib/rating.js.
import { getUser, withUser } from '@/lib/server/db';
import { reviewUrl } from '@/lib/server/flags';
import { cleanRating, rateDue } from '@/lib/rating';

const fail = (status, error) => ({ ok: false, status, error });

// The demo account is never asked.
export async function rateState(userId) {
  const url = await reviewUrl();
  if (userId === 'demo') return { ask: false, url };
  const u = await getUser(userId);
  return { ask: rateDue(u), url };
}

// input: { stars, comment? } or { skip: true }.
export async function rate(userId, input) {
  if (userId === 'demo') return fail(409, 'The demo account cannot rate.');
  const skip = input?.skip === true;
  const c = skip ? null : cleanRating(input);
  if (c?.error) return fail(422, c.error);
  const r = await withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (u.rating) return fail(409, 'You already rated.');
    if (skip) u.rateSkip = Date.now();
    else u.rating = { ...c.rating, at: Date.now() };
    return { ok: true, status: 200 };
  });
  if (!r.ok) return r;
  return { ...r, ...(await rateState(userId)) };
}
