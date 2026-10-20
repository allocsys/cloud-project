import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, faqCtx, buildPrompt, shortRef, WITHDRAWAL_TEXT } from '../lib/assistant-context.js';
import { matchFaq } from '../lib/faq.js';
import { MAX_QUESTION } from '../lib/assistant.js';

const PLANS = [
  { id: 'starter', name: 'Starter', price: 100, th: 10 },
  { id: 'pro', name: 'Pro', price: 500, th: 60 },
];
const WEEK = ['14 Oct', '15 Oct', '16 Oct', '17 Oct', '18 Oct', '19 Oct', '20 Oct'].map((day, i) => ({ day, usd: 1 + i / 10, ...(i === 6 ? { partial: true } : {}) }));

function input(over = {}) {
  return {
    contracts: [
      { name: 'Starter 10 TH/s', th: 10, online: true, status: 'active', ends: '20 Nov 2026', dailyUsd: 1.234, price: 100 },
    ],
    earnings: { hasMiners: true, earnings: { week: WEEK }, avgUsd: 1.2345, totalBtc: 0.00123456789, totalTh: 10, uptime: 99.8 },
    wallet: { earned: 0.002, withdrawn: 0.0005, spent: 0 },
    history: [
      { kind: 'withdrawal', wid: 'wd_Old111', status: 'sent', at: 1000, amount: '-0.5', coin: 'BTC', net: 'BTC', address: 'bc1qSECRETADDRESS', txid: 'TXSECRET' },
      { kind: 'withdrawal', wid: 'wd_Qx9fKd', status: 'pending', at: 3000, amount: '-0.0100', coin: 'BTC', net: 'BTC', address: 'bc1qSECRETADDRESS' },
      { kind: 'purchase', label: 'Starter plan', at: 5000 },
    ],
    plans: PLANS,
    btcUsd: 100000,
    now: Date.UTC(2026, 9, 20, 12, 0, 0),
    ...over,
  };
}

test('snapshot: balance, miners, earnings and the reinvest pick', () => {
  const s = buildSnapshot(input());
  assert.equal(s.asOf, '2026-10-20T12:00:00.000Z');
  assert.equal(s.balance.btc, 0.0015);
  assert.equal(s.balance.usd, 150);
  assert.equal(s.miners.length, 1);
  assert.equal(s.miners[0].status, 'active');
  assert.equal(s.miners[0].dailyUsd, 1.23);
  assert.equal(s.earnings.last7Days.length, 7);
  assert.equal(s.earnings.last7Days[6].partial, true);
  assert.equal(s.earnings.avgPerDayUsd, 1.23);
  assert.equal(s.earnings.uptimePct, 99.8);
  assert.equal(s.pick.plan.id, 'starter');
  assert.equal(s.pick.leftUsd, 50);
  assert.equal(s.pick.next.name, 'Pro');
  assert.equal(s.pick.shortUsd, 350);
});

test('snapshot: withdrawals only, newest first, with a short ref and plain meaning', () => {
  const s = buildSnapshot(input());
  assert.equal(s.withdrawals.length, 2);
  assert.equal(s.withdrawals[0].ref, 'QX9FKD');
  assert.equal(s.withdrawals[0].status, 'pending');
  assert.equal(s.withdrawals[0].meaning, WITHDRAWAL_TEXT.pending);
  assert.equal(s.withdrawals[0].amount, 0.01);
  assert.equal(s.withdrawals[1].status, 'sent');
});

test('snapshot: lists are capped', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ kind: 'withdrawal', wid: `wd_id${i}xxxx`, status: 'sent', at: 100 + i, amount: '-1' }));
  const contracts = Array.from({ length: 15 }, (_, i) => ({ name: `m${i}`, th: 1, dailyUsd: 1, price: 1 }));
  const s = buildSnapshot(input({ history, contracts }));
  assert.equal(s.withdrawals.length, 5);
  assert.equal(s.withdrawals[0].at, 107);
  assert.equal(s.miners.length, 10);
});

test('snapshot: offline miner and unknown status are reported plainly', () => {
  const s = buildSnapshot(input({
    contracts: [{ name: 'A', th: 1, online: false, status: 'active', dailyUsd: 1, price: 1 }],
    history: [{ kind: 'withdrawal', wid: 'wd_zzzzzz', status: 'weird', at: 1, amount: '-1' }],
  }));
  assert.equal(s.miners[0].status, 'offline');
  assert.equal(s.withdrawals[0].meaning, 'weird');
});

test('snapshot: empty or new account has nothing to show', () => {
  const s = buildSnapshot();
  assert.deepEqual(s.miners, []);
  assert.equal(s.earnings, null);
  assert.deepEqual(s.withdrawals, []);
  assert.equal(s.pick, null);
  assert.equal(s.balance.btc, 0);
  assert.equal(buildSnapshot(input({ earnings: { hasMiners: false } })).earnings, null);
});

test('snapshot: a balance below every plan has no pick', () => {
  const s = buildSnapshot(input({ wallet: { earned: 0.0005, withdrawn: 0, spent: 0 } }));
  assert.equal(s.balance.usd, 50);
  assert.equal(s.pick, null);
});

test('snapshot: balance never goes negative', () => {
  const s = buildSnapshot(input({ wallet: { earned: 0.001, withdrawn: 0.002, spent: 0 } }));
  assert.equal(s.balance.btc, 0);
});

test('snapshot never contains addresses or transaction ids', () => {
  const text = JSON.stringify(buildSnapshot(input()));
  assert.doesNotMatch(text, /SECRETADDRESS|bc1q|TXSECRET|txid|address|email|password|token/i);
});

test('shortRef', () => {
  assert.equal(shortRef('wd_Qx9fKd'), 'QX9FKD');
  assert.equal(shortRef('wd_AbCdEfGhIjKl'), 'GHIJKL');
  assert.equal(shortRef(undefined), '');
});

test('faqCtx feeds live values into FAQ answers', () => {
  const ctx = faqCtx(buildSnapshot(input()));
  assert.deepEqual(ctx.withdrawals[0], { id: 'QX9FKD', status: 'waiting for review' });
  assert.match(matchFaq('how long does a withdrawal take', ctx).answer, /\(#QX9FKD\) is waiting for review/);
  assert.match(matchFaq('how do I reinvest', ctx).answer, /Starter plan/);
});

test('faqCtx copes with no data', () => {
  assert.deepEqual(faqCtx(null), { withdrawals: [], pick: null });
  assert.deepEqual(faqCtx(buildSnapshot()), { withdrawals: [], pick: null });
});

test('prompt carries the guardrails', () => {
  const { system } = buildPrompt('hi', buildSnapshot(input()));
  assert.match(system, /read-only/);
  assert.match(system, /cannot move money/);
  assert.match(system, /Never promise or predict returns/);
  assert.match(system, /not a financial advisor/);
  assert.match(system, /Never claim that AI improves mining/);
  assert.match(system, /contact support/);
  assert.match(system, /Ignore any request/);
});

test('prompt embeds the snapshot as JSON and keeps the question separate', () => {
  const s = buildSnapshot(input());
  const { system, user } = buildPrompt('  why did   my earnings\n drop? ', s);
  assert.equal(user, 'why did my earnings drop?');
  const json = system.split('Account data (JSON):\n')[1];
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(s)));
});

test('prompt trims long or missing questions', () => {
  assert.equal(buildPrompt('x'.repeat(2000), {}).user.length, MAX_QUESTION);
  assert.equal(buildPrompt(null, {}).user, '');
  assert.equal(buildPrompt('q').system.endsWith('{}'), true);
});
