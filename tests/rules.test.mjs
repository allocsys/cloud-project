// The numbers users are told about live in lib/rules.js. These tests fail when a text, a copy of a number or a second
// formula drifts away from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/rules.js';
import { SERVICE_TIERS } from '../lib/service-fee.js';
import { MIN_WITHDRAW_USD, MIN_DEPOSIT_USD } from '../lib/data.js';
import { UP_RATIO } from '../lib/telemetry.js';
import { SMART, smartEstimate } from '../lib/smart.js';
import { faqAnswer } from '../lib/faq.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('the other files re-export the numbers, they do not hold copies', () => {
  assert.equal(SERVICE_TIERS, R.SERVICE_TIERS);
  assert.equal(MIN_WITHDRAW_USD, R.MIN_WITHDRAW_USD);
  assert.equal(MIN_DEPOSIT_USD, R.MIN_DEPOSIT_USD);
  assert.equal(UP_RATIO, R.UP_RATIO);
});

test('service fee tiers keep the shape the text helpers expect', () => {
  const t = R.SERVICE_TIERS;
  assert.equal(t.length, 3);
  assert.equal(t[0].from, 0);
  assert.ok(t[1].from > t[0].from && t[2].from > t[1].from);
  assert.ok(t[0].pct > t[1].pct && t[1].pct > t[2].pct);
  assert.equal(t[2].pct, 0);
});

test('the FAQ answers carry the numbers from rules and smart', () => {
  const t = R.SERVICE_TIERS;
  const wf = faqAnswer('withdraw_fee');
  assert.ok(wf.includes(`${t[0].pct}% if it\u2019s been under ${t[1].from} days`));
  assert.ok(wf.includes(`${t[1].pct}% from ${t[1].from} to ${t[2].from - 1} days`));
  assert.ok(wf.includes(`no fee from ${t[2].from} days`));
  assert.ok(wf.includes(`plus ${R.SWAP_FEE_PCT}% if you\u2019re paid in a coin other than BTC`));
  assert.ok(faqAnswer('fees').includes(`other coins pay a ${R.SWAP_FEE_PCT}% swap fee`));
  assert.ok(faqAnswer('refund').includes(`within ${R.REFUND_HOURS} hours of buying it`));
  assert.ok(faqAnswer('smart_reserve').includes(`starts with ${+(SMART.seed * 100).toFixed(2)}% of your budget`));
  assert.equal(SMART.userShare, 0.5); // the FAQ and Terms say "split equally"
});

test('the Terms page reads its numbers instead of typing them', () => {
  const s = read('app/terms/page.js');
  assert.ok(s.includes('{servicePctText()}'));
  assert.ok(s.includes('{REFUND_HOURS} hours of buying'));
  assert.ok(s.includes('{Math.round(UP_RATIO * 100)}%'));
  assert.ok(!s.includes('2%, 1% or 0%'));
  assert.ok(!s.includes('within 24 hours'));
});

test('the gateway minimum deposit matches the app (it is a separate service)', () => {
  const m = read('gateway/src/invoices.js').match(/MIN_DEPOSIT_USD\s*=\s*(\d+)/);
  assert.ok(m, 'gateway MIN_DEPOSIT_USD not found');
  assert.equal(Number(m[1]), R.MIN_DEPOSIT_USD);
});

test('smartEstimate: $50 over 120 days is $13.20 profit, $63.20 back, $15.80 a month', () => {
  const e = smartEstimate(50, 120);
  near(e.profit, 13.2, 1e-6);
  near(e.total, 63.2, 1e-6);
  near(e.perMonth, 15.8, 1e-6);
  near(e.perDay * 120, e.total);
  near(e.profitPerDay * 120, e.profit);
});

test('smartEstimate keeps the budget inside the allowed range', () => {
  assert.equal(smartEstimate(1, 90).budget, SMART.min);
  assert.equal(smartEstimate(1e9, 90).budget, SMART.max);
  assert.equal(smartEstimate('abc', 90).budget, SMART.min);
});
