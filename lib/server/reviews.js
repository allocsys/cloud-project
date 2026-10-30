// Reviews shown on the landing page, kept in the meta entry "reviews" (a list, newest first). Rules: lib/reviews.js.
import { randomBytes } from 'node:crypto';
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { cleanReview, REVIEW_MAX } from '@/lib/reviews';
import { MOCK_REVIEWS } from '@/lib/review-mock';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

export async function reviewList() {
  await warm();
  const v = metaGet('reviews');
  return Array.isArray(v) ? v : [];
}

// Adds a review, or changes the one with input.id (a mock one stays mock). Runs under a lock on the entry, so two admins cannot overwrite each other.
export function saveReview(input) {
  const c = cleanReview(input);
  if (c.error) return fail(422, c.error);
  const id = String(input?.id ?? '');
  return metaUpdate('reviews', (cur) => {
    const list = Array.isArray(cur) ? [...cur] : [];
    if (id) {
      const i = list.findIndex((r) => r.id === id);
      if (i < 0) return { result: fail(404, 'Review not found.') };
      list[i] = { ...c.review, id, ...(list[i].mock ? { mock: true } : {}) };
    } else {
      if (list.length >= REVIEW_MAX) return { result: fail(409, `Up to ${REVIEW_MAX} reviews.`) };
      list.unshift({ ...c.review, id: randomBytes(4).toString('hex') });
    }
    return { value: list, result: done };
  });
}

export function deleteReview(id) {
  const want = String(id ?? '');
  return metaUpdate('reviews', (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    if (!list.some((r) => r.id === want)) return { result: fail(404, 'Review not found.') };
    return { value: list.filter((r) => r.id !== want), result: done };
  });
}

// Staging only: puts the invented reviews of lib/review-mock.js in front, flagged mock. Older mock ones are replaced, real ones stay.
export function addMockReviews() {
  return metaUpdate('reviews', (cur) => {
    const real = (Array.isArray(cur) ? cur : []).filter((r) => !r.mock);
    if (real.length + MOCK_REVIEWS.length > REVIEW_MAX) return { result: fail(409, `Up to ${REVIEW_MAX} reviews. Delete some first.`) };
    return { value: [...MOCK_REVIEWS.map((r) => ({ ...r, mock: true })), ...real], result: { ...done, added: MOCK_REVIEWS.length } };
  });
}

// Takes out every review flagged mock and leaves the real ones.
export function clearMockReviews() {
  return metaUpdate('reviews', (cur) => {
    const list = Array.isArray(cur) ? cur : [];
    const keep = list.filter((r) => !r.mock);
    if (keep.length === list.length) return { result: fail(409, 'No mock reviews to remove.') };
    return { value: keep, result: { ...done, removed: list.length - keep.length } };
  });
}
