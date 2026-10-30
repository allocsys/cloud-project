// Reviews on the landing page: only what the admin types, checked here. Nothing is generated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReview, flagOf, summary, AVG_MIN, TEXT_MAX } from '../lib/reviews.js';

const ok = { name: 'A. K.', country: 'de', stars: '5', text: 'Simple to follow and clear.', source: 'Trustpilot', url: 'https://example.com/r/1' };

test('a good review is accepted and tidied', () => {
  const r = cleanReview(ok);
  assert.deepEqual(r.review, { name: 'A. K.', country: 'DE', stars: 5, text: 'Simple to follow and clear.', source: 'Trustpilot', url: 'https://example.com/r/1' });
});

test('the link is optional but must be https', () => {
  assert.equal(cleanReview({ ...ok, url: '' }).review.url, '');
  assert.ok(cleanReview({ ...ok, url: 'http://example.com' }).error);
  assert.ok(cleanReview({ ...ok, url: 'javascript:alert(1)' }).error);
  assert.ok(cleanReview({ ...ok, url: 'https://' }).error);
});

test('missing or wrong parts are refused', () => {
  assert.ok(cleanReview({ ...ok, name: ' ' }).error);
  assert.ok(cleanReview({ ...ok, country: 'GER' }).error);
  assert.ok(cleanReview({ ...ok, country: '1A' }).error);
  assert.ok(cleanReview({ ...ok, stars: '0' }).error);
  assert.ok(cleanReview({ ...ok, stars: '6' }).error);
  assert.ok(cleanReview({ ...ok, stars: 'x' }).error);
  assert.ok(cleanReview({ ...ok, source: '' }).error);
  assert.ok(cleanReview({ ...ok, text: 'Too short' }).error);
});

test('a long review is refused, never cut', () => {
  assert.ok(cleanReview({ ...ok, text: 'a'.repeat(TEXT_MAX + 1) }).error);
  assert.equal(cleanReview({ ...ok, text: 'a'.repeat(TEXT_MAX) }).review.text.length, TEXT_MAX);
});

test('flag from two letters', () => {
  assert.equal(flagOf('DE'), '\u{1F1E9}\u{1F1EA}');
  assert.equal(flagOf('us'), '\u{1F1FA}\u{1F1F8}');
});

test('the average shows only from AVG_MIN reviews', () => {
  const list = (n, stars) => Array.from({ length: n }, () => ({ stars }));
  assert.equal(summary([]).n, 0);
  assert.equal(summary(list(AVG_MIN - 1, 5)).showAvg, false);
  assert.equal(summary(list(AVG_MIN, 5)).showAvg, true);
  assert.equal(summary([{ stars: 5 }, { stars: 4 }, { stars: 4 }, { stars: 5 }, { stars: 4 }]).avg, 4.4);
});
