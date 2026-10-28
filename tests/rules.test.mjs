// The numbers users are told about live in lib/rules.js. These tests fail when a text, a copy of a number or a second
// formula drifts away from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../lib/rules.js';
import { SERVICE_TIERS } from '../lib/service-fee.js';
import { MIN_WITHDRAW_USD, MIN_DEPOSIT_USD } from '../lib/data.js';
import { UP_RATIO } from '../lib/telemetry.js';
import { SMART, smartEstimate, smartPlan, smartBand } from '../lib/smart.js';
import { faqAnswer, faqVars } from '../lib/faq.js';
import { BOOST } from '../lib/boost.js';
import { translateError } from '../lib/i18n/errors.js';

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
  const en = read('lib/i18n/locales/en.js');
  assert.ok(s.includes('SERVICE_TIERS'));
  assert.ok(s.includes('hours: REFUND_HOURS'));
  assert.ok(s.includes('up: Math.round(UP_RATIO * 100)'));
  assert.ok(en.includes('within {hours} hours of buying'));
  assert.ok(!s.includes('2%, 1% or 0%'));
  assert.ok(!/'terms\.p3b': "[^"]*within 24 hours/.test(en));
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

test('the Plans card and the calculator agree on profit, total and daily figure', () => {
  for (const budget of [50, 75, 100, 350, 500, 1234, 5000, 10000]) {
    for (const days of SMART.terms) {
      const e = smartEstimate(budget, days);
      const plan = smartPlan(budget, days);
      const band = smartBand(plan);
      near(band.mid, e.profit, 0.011); // both round to cents
      assert.ok(band.low < band.mid && band.mid < band.high);
      near(Number(plan.daily.slice(1)), e.perDay, 0.011); // the "~$X/day" on the Plans card
    }
  }
  assert.equal(smartBand({ budget: 100, days: 90 }), null); // a plan without a reserve has no range
});

test('the FAQ carries the deposit hold, the payout hours and the boost hours from the code', () => {
  assert.ok(faqAnswer('deposit').includes(`withdrawn after ${R.DEPOSIT_HOLD_DAYS} days`));
  assert.ok(faqAnswer('withdraw_time').includes(`paid within ${R.PAYOUT_HOURS} hours`));
  assert.ok(faqAnswer('boost').includes(`for ${BOOST.hours} hours`));
  assert.ok(faqAnswer('boost').includes(`When the ${BOOST.hours} hours end`));
  assert.deepEqual(faqVars('deposit'), { days: R.DEPOSIT_HOLD_DAYS });
  assert.equal(faqVars('withdraw_time').h, R.PAYOUT_HOURS);
  assert.deepEqual(faqVars('boost'), { h: BOOST.hours });
});

test('no typed copy of the deposit hold, the payout hours or the boost hours is left in the texts', () => {
  const faq = read('lib/faq.js');
  const wallet = read('lib/server/wallet.js');
  const en = read('lib/i18n/locales/en.js');
  const fa = read('lib/i18n/locales/fa.js');
  const faFaq = read('lib/i18n/faq-fa.js');
  const terms = read('app/terms/page.js');
  assert.ok(!/14 days|24 hours|for 2 hours|the 2 hours/.test(faq));
  assert.ok(!wallet.includes('after 14 days'));
  assert.ok(en.includes('runs for {hours} hours'));
  assert.ok(en.includes("'wal.errHold': 'Without a plan, deposits can be withdrawn after {days} days.'"));
  assert.ok(fa.includes('که {hours} ساعت'));
  assert.ok(fa.includes('پس از {days} روز قابل برداشت'));
  assert.ok(faFaq.includes('پس از {days} روز'));
  assert.ok(faFaq.includes('ظرف {h} ساعت پرداخت'));
  assert.ok(faFaq.includes('مدت {h} ساعت'));
  assert.ok(!/ 24 ساعت|پس از 14 روز|مدت 2 ساعت/.test(faFaq));
  assert.ok(terms.includes('hours: BOOST.hours'));
});

test('the deposit hold error is translated with the number from rules', () => {
  const msg = `Without a plan, deposits can be withdrawn after ${R.DEPOSIT_HOLD_DAYS} days.`;
  const fa = translateError('fa', msg);
  assert.ok(fa.includes(String(R.DEPOSIT_HOLD_DAYS)));
  assert.ok(!fa.includes('{') && !fa.includes('Without a plan'));
  assert.equal(translateError('en', msg), msg);
});
