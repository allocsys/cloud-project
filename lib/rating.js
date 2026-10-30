// "Rate us": after a user's first withdrawal has been sent, the Earnings screen asks once how the app is doing.
// The rating is private (u.rating, seen only by the admin). Everyone who is asked gets the same link to the public review page,
// whatever they rated, so the link is not held back from unhappy users. No imports: storage is lib/server/rating.js.
export const COMMENT_MAX = 280;
export const ASK_AGAIN_MS = 60 * 86400000; // after "Not now", ask again after this long

// Checks what the user sent. Returns { rating } or { error }.
export function cleanRating(input) {
  const stars = Math.round(Number(input?.stars));
  const comment = String(input?.comment ?? '').trim().replace(/\s+/g, ' ');
  if (!(stars >= 1 && stars <= 5)) return { error: 'Choose 1 to 5 stars.' };
  if (comment.length > COMMENT_MAX) return { error: `Keep it under ${COMMENT_MAX} characters.` };
  return { rating: { stars, comment } };
}

// Should this account be asked now? It has a withdrawal that was sent, has not rated, and did not say "Not now" recently.
export function rateDue(u, now = Date.now()) {
  if (!u || u.rating) return false;
  if (u.rateSkip && now - u.rateSkip < ASK_AGAIN_MS) return false;
  return (u.history || []).some((h) => h.kind === 'withdrawal' && h.status === 'sent');
}
