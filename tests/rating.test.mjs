// Rate us: who is asked, what is accepted. And the staging mock reviews stay flaggable and valid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRating, rateDue, ASK_AGAIN_MS, COMMENT_MAX } from '../lib/rating.js';
import { cleanReview } from '../lib/reviews.js';
import { MOCK_REVIEWS } from '../lib/review-mock.js';

const sent = { kind: 'withdrawal', status: 'sent' };

test('a rating needs 1 to 5 stars; the comment is optional and never cut', () => {
  assert.deepEqual(cleanRating({ stars: 4 }).rating, { stars: 4, comment: '' });
  assert.deepEqual(cleanRating({ stars: '5', comment: '  Nice   app ' }).rating, { stars: 5, comment: 'Nice app' });
  assert.ok(cleanRating({ stars: 0 }).error);
  assert.ok(cleanRating({ stars: 6 }).error);
  assert.ok(cleanRating({}).error);
  assert.ok(cleanRating({ stars: 5, comment: 'a'.repeat(COMMENT_MAX + 1) }).error);
});

test('asked only after a withdrawal was sent', () => {
  assert.equal(rateDue({ history: [] }), false);
  assert.equal(rateDue({ history: [{ kind: 'withdrawal', status: 'pending' }] }), false);
  assert.equal(rateDue({ history: [{ kind: 'payout' }] }), false);
  assert.equal(rateDue({ history: [sent] }), true);
  assert.equal(rateDue(null), false);
});

test('not asked again once rated, and not soon after "Not now"', () => {
  const now = Date.now();
  assert.equal(rateDue({ history: [sent], rating: { stars: 5 } }, now), false);
  assert.equal(rateDue({ history: [sent], rateSkip: now - 1000 }, now), false);
  assert.equal(rateDue({ history: [sent], rateSkip: now - ASK_AGAIN_MS - 1000 }, now), true);
});

test('every mock review is valid, has a unique id, and none carries a link', () => {
  const ids = new Set();
  for (const m of MOCK_REVIEWS) {
    assert.ok(cleanReview(m).review, `${m.id}: ${cleanReview(m).error}`);
    assert.ok(!ids.has(m.id));
    ids.add(m.id);
    assert.equal(m.url, '');
  }
});
