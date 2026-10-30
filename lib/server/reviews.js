// Reviews shown on the landing page, kept in the meta entry "reviews" (a list, newest first). Rules: lib/reviews.js.
import { randomBytes } from 'node:crypto';
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { cleanReview, REVIEW_MAX } from '@/lib/reviews';

const fail = (status, error) => ({ ok: false, status, error });

export async function reviewList() {
  await warm();
  const v = metaGet('reviews');
  return Array.isArray(v) ? v : [];
}

// Adds a review, or changes the one with input.id. Runs under a lock on the entry, so two admins cannot overwrite each other.
export function saveReview(input) {
  const c = cleanReview(input);
  if (c.error) return fail(422, c.error);
  const id = String(input?.id ?? '');
  return metaUpdate('reviews', (cur) => {
    const list = Array.isArray(cur) ? [...cur] : [];
    if (id) {
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return { result: fail(404, 'Review not found.') };
      list[i] = { ...c.review, id };
    } else {
      if (list.length >= REVIEW_MAX) return { result: fail(409, `Up to ${REVIEW_MAX} reviews.`) };
      list.unshift({ ...c.review, id: randomBytes(4).toString('hex') });
    }
    return { value: list, result: { ok: true, status: 200 } };
  });
}

export function deleteReview(id) {
  const want = String(id ?? '');
  return metaUpdate('reviews', (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    if (!list.some((r) => r.id === want)) return { result: fail(404, 'Review not found.') };
    return { value: list.filter((r) => r.id !== want), result: { ok: true, status: 200 } };
  });
}
