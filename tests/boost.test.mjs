// Boost tickets, the pure part: ticket numbers, the margin, settings clean-up, the draw threshold and what finished boosts add to a balance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOST, TICKETS, ticketOf, normalizeBoost, shownOf, marginOf, activeCount, drawWins, boostResultUsd, boostBtcOf, boostPay, WINNERS, maskId, mockWinners, pickWinners } from '@/lib/boost';

test('the tickets pay th x 0.021 USD per TH/s per day for two hours', () => {
  assert.deepEqual(TICKETS.map((t) => [t.id, t.price, t.th, t.pay, t.prize, t.max]), [
    ['t1', 1, 120, 0.21, 10, 10],
    ['t10', 10, 1200, 2.1, 100, 10],
    ['t100', 100, 12000, 21, 1000, 5],
  ]);
  assert.equal(boostPay(120), 0.21);
  assert.equal(BOOST.hours, 2);
  assert.equal(ticketOf('t10').price, 10);
  assert.equal(ticketOf('nope'), null);
});

test('the margin follows the chance: 29% at the default 5%, negative when the chance is too high', () => {
  for (const t of TICKETS) assert.ok(Math.abs(marginOf(t, 5) - 0.29) < 1e-9, `${t.id} margin at 5%`);
  assert.ok(Math.abs(marginOf(TICKETS[0], 0) - 0.79) < 1e-9, 'no chance: only the boost pay is paid');
  assert.ok(marginOf(TICKETS[0], 8) < 0);
  assert.ok(marginOf(TICKETS[0], 7.8) > 0);
});

test('settings fall back to the defaults and keep valid values', () => {
  const none = { t1: null, t10: null, t100: null };
  assert.deepEqual(normalizeBoost(undefined), { enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, shown: none });
  assert.deepEqual(normalizeBoost({ enabled: true, chance: { t1: 3.456, t10: '7', t100: -1 } }), { enabled: true, chance: { t1: 3.46, t10: 7, t100: 5 }, shown: none });
  assert.deepEqual(normalizeBoost({ enabled: 'yes', chance: { t1: 101, t10: '', t100: 'x' } }), { enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, shown: none });
});

test('the shown chance is its own number; empty or invalid means the real one is shown', () => {
  const cfg = normalizeBoost({ chance: { t1: 8, t10: 6, t100: 4 }, shown: { t1: 5, t10: '', t100: 120 } });
  assert.deepEqual(cfg.shown, { t1: 5, t10: null, t100: null });
  assert.equal(shownOf(cfg, 't1'), 5);
  assert.equal(shownOf(cfg, 't10'), 6);
  assert.equal(shownOf(cfg, 't100'), 4);
});

test('the draw: a chance of p percent wins on p x 10,000 out of 1,000,000 rolls', () => {
  assert.equal(drawWins(5, 0), true);
  assert.equal(drawWins(5, 49999), true);
  assert.equal(drawWins(5, 50000), false);
  assert.equal(drawWins(0, 0), false);
  assert.equal(drawWins(100, 999999), true);
  assert.equal(drawWins(0.01, 99), true);
  assert.equal(drawWins(0.01, 100), false);
});

test('running boosts are counted per ticket', () => {
  const u = { boosts: [{ t: 't1', endsAt: 2000 }, { t: 't1', endsAt: 500 }, { t: 't10', endsAt: 2000 }] };
  assert.equal(activeCount(u, 't1', 1000), 1);
  assert.equal(activeCount(u, 't10', 1000), 1);
  assert.equal(activeCount(u, 't100', 1000), 0);
  assert.equal(activeCount({}, 't1', 1000), 0);
});

test('a finished boost adds its pay, and the prize when won, at the rate it was bought at; a running one adds nothing', () => {
  const lost = { pay: 0.21, prize: 10, win: false, rate: 100000, endsAt: 1000 };
  const won = { pay: 0.21, prize: 10, win: true, rate: 50000, endsAt: 1000 };
  assert.equal(boostResultUsd(lost), 0.21);
  assert.equal(boostResultUsd(won), 10.21);
  assert.equal(boostBtcOf({ boosts: [lost, won] }, 999), 0, 'nothing before the end');
  assert.ok(Math.abs(boostBtcOf({ boosts: [lost, won] }, 1000) - (0.21 / 100000 + 10.21 / 50000)) < 1e-12);
  assert.equal(boostBtcOf({}, 1000), 0);
});

test('winner names show half of the part before the @, never the domain or the whole name', () => {
  assert.equal(maskId('johnsmith@x.com'), 'john\u2022\u2022\u2022\u2022');
  assert.equal(maskId('ab@x.com'), 'a\u2022\u2022\u2022\u2022');
  assert.equal(maskId('a@x.com'), 'a\u2022\u2022\u2022\u2022');
  assert.equal(maskId('averyveryverylongname@x.com'), 'averyv\u2022\u2022\u2022\u2022', 'at most 6 characters');
  assert.equal(maskId('tg:123456789', 'Alexander Great'), 'Alex\u2022\u2022\u2022\u2022', 'a Telegram account shows half of its first name');
  assert.equal(maskId('tg:123456789', 'Ali'), 'A\u2022\u2022\u2022\u2022');
  assert.equal(maskId('tg:123456789'), 'tg\u2022\u2022\u2022\u2022', 'no name: just tg');
  assert.equal(maskId('tg:123456789', '   '), 'tg\u2022\u2022\u2022\u2022');
  assert.ok(!/\d|:/.test(maskId('tg:123456789', 'Alexander')) && !/\d|:/.test(maskId('tg:123456789')), 'the Telegram number is never shown');
  for (const id of ['johnsmith@x.com', 'ab@x.com']) {
    const m = maskId(id);
    assert.ok(!m.includes('@') && !m.includes('.com') && m !== id);
  }
  assert.equal(maskId(undefined), '\u2022\u2022\u2022\u2022');
});

test('sample winners are masked, recent and mostly small; the count is filled', () => {
  const now = 1_000_000_000_000;
  const list = mockWinners(now);
  assert.equal(list.length, WINNERS.count);
  assert.equal(new Set(list.map((w) => w.name)).size, list.length, 'no repeated name');
  for (const w of list) {
    assert.ok(w.name.endsWith('\u2022\u2022\u2022\u2022') && !w.name.includes('@') && !/\d|:/.test(w.name), 'no email, no number');
    assert.ok([10, 100, 1000].includes(w.prize));
    assert.ok(w.at <= now - 60_000 && w.at >= now - 60_000 - WINNERS.maxAgoMin * 60_000);
  }
});

test('real winners take their places and sample ones fill only what is missing, in a random order', () => {
  const mock = mockWinners(1_000_000_000_000);
  const real = (n) => Array.from({ length: n }, (_, i) => ({ name: `real${i}\u2022\u2022\u2022\u2022`, prize: 100, at: 5000 - i }));
  const isReal = (w) => w.name.startsWith('real');
  assert.equal(pickWinners({ real: [], mock }).length, WINNERS.count);
  assert.equal(pickWinners({ real: [], mock }).filter(isReal).length, 0, 'no real wins yet: all sample');
  const some = pickWinners({ real: real(3), mock });
  assert.equal(some.length, WINNERS.count);
  assert.equal(some.filter(isReal).length, 3, 'every real win is in');
  assert.equal(some.length - some.filter(isReal).length, WINNERS.count - 3, 'sample ones only fill the rest');
  const many = pickWinners({ real: real(20), mock });
  assert.equal(many.length, WINNERS.count);
  assert.ok(many.every(isReal), 'enough real wins: no sample at all');
  assert.deepEqual(many.map((w) => w.name).sort(), real(20).slice(0, WINNERS.count).map((w) => w.name).sort(), 'the newest real ones are kept');
  const dup = pickWinners({ real: [{ name: mock[0].name, prize: 10, at: 1 }], mock });
  assert.equal(dup.filter((w) => w.name === mock[0].name).length, 1, 'a sample never repeats a real name');
  const order = (r) => pickWinners({ real: real(12), mock: [], rand: r }).map((w) => w.name).join();
  assert.notEqual(order(() => 0), order(() => 0.99), 'the order follows the random numbers');
});
