// Reviews on the landing page. Only real ones: the admin adds each one by hand (Admin > Settings > Reviews) and says where it came from.
// Nothing is made up and nothing is generated. With no reviews the section is not shown.
// This file holds the rules and has no imports. Storage is lib/server/reviews.js (meta entry "reviews").
export const REVIEW_MAX = 24; // reviews kept
export const AVG_MIN = 5; // the average rating is shown from this many reviews
export const TEXT_MAX = 280;

const clip = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// Checks one review typed by the admin. Returns { review } or { error }. A review is never cut short: too long is refused.
export function cleanReview(input) {
  const name = clip(input?.name, 30);
  const country = String(input?.country ?? '').trim().toUpperCase();
  const stars = Math.round(Number(input?.stars));
  const text = String(input?.text ?? '').trim().replace(/\s+/g, ' ');
  const source = clip(input?.source, 30);
  const url = String(input?.url ?? '').trim();
  if (!name) return { error: 'Add a name or initials.' };
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'Country is two letters, like DE.' };
  if (!(stars >= 1 && stars <= 5)) return { error: 'Stars are 1 to 5.' };
  if (text.length < 10) return { error: 'The review needs at least 10 characters.' };
  if (text.length > TEXT_MAX) return { error: `The review is over ${TEXT_MAX} characters. Shorten it, but do not change its meaning.` };
  if (!source) return { error: 'Say where it came from (Trustpilot, Telegram, email).' };
  if (url) {
    let ok = url.length <= 300 && /^https:\/\//i.test(url);
    if (ok) {
      try {
        new URL(url);
      } catch {
        ok = false;
      }
    }
    if (!ok) return { error: 'The link must start with https://' };
  }
  return { review: { name, country, stars, text, source, url } };
}

// Two letters to a flag emoji (DE becomes the German flag).
export const flagOf = (cc) => String.fromCodePoint(...[...String(cc).toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// Count and average (one decimal). The average is only shown from AVG_MIN reviews.
export function summary(list) {
  const n = list.length;
  const avg = n ? Math.round((list.reduce((s, r) => s + r.stars, 0) / n) * 10) / 10 : 0;
  return { n, avg, showAvg: n >= AVG_MIN };
}
