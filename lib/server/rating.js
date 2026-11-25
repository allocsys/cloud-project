// Rate us: who is asked, and where the answer is kept (u.rating, or u.rateSkip for "Not now"). Rules: lib/rating.js.
// With boost tickets on, a rating from an account that was asked (it has a sent withdrawal) gives one free $1 ticket, held in
// u.freeTickets like an invite gift. The ticket is for sending a rating, whatever the stars: it is never tied to a good score,
// and never to a public review (those cannot be checked, and review sites ban rewarding them).
import { warm, metaGet, getUser, withUser, notify } from '@/lib/server/db';
import { reviewUrl } from '@/lib/server/flags';
import { normalizeBoost, boostOn } from '@/lib/boost';
import { cleanRating, rateDue } from '@/lib/rating';

const fail = (status, error) => ({ ok: false, status, error });

const rewardOn = async (fresh = false) => {
  await warm(fresh);
  return boostOn(normalizeBoost(metaGet('boost')));
};

// The demo account is never asked.
export async function rateState(userId) {
  const url = await reviewUrl();
  if (userId === 'demo') return { ask: false, url, reward: false };
  const u = await getUser(userId);
  const ask = rateDue(u);
  return { ask, url, reward: ask ? await rewardOn() : false };
}

// Admin: delete a rating so the Rate us box comes back. The account keeps its one free ticket (u.rateTicketGiven),
// so a new rating gives no second ticket. "Not now" is cleared too, or the box would stay hidden.
export async function clearRating(userId) {
  return withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (!u.rating) return fail(409, 'No rating to delete.');
    if (u.rating.ticket) u.rateTicketGiven = true;
    delete u.rating;
    delete u.rateSkip;
    return { ok: true, status: 200 };
  });
}

// input: { stars, comment? } or { skip: true }.
export async function rate(userId, input) {
  if (userId === 'demo') return fail(409, 'The demo account cannot rate.');
  const skip = input?.skip === true;
  const c = skip ? null : cleanRating(input);
  if (c?.error) return fail(422, c.error);
  const reward = skip ? false : await rewardOn(true);
  const r = await withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (u.rating) return fail(409, 'You already rated.');
    if (skip) {
      u.rateSkip = Date.now();
      return { ok: true, status: 200, ticket: false };
    }
    const asked = rateDue(u);
    u.rating = { ...c.rating, at: Date.now() };
    if (reward && asked && !u.rateTicketGiven) {
      u.rating.ticket = true;
      u.rateTicketGiven = true; // one free ticket per account, even after an admin deletes the rating
      u.freeTickets = (u.freeTickets || 0) + 1; // used from the Boost page (lib/server/boost.js buyBoost with free: true)
      notify(u, { kind: 'news', title: 'Free ticket', body: 'Thank you for rating. You got 1 free boost ticket.' });
    }
    return { ok: true, status: 200, ticket: !!u.rating.ticket };
  });
  if (!r.ok) return r;
  return { ...r, ...(await rateState(userId)) };
}
