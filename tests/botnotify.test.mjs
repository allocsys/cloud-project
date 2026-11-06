// App -> bot notifications: only tg:<id> accounts and three events, signed like the bot expects, sent after COMMIT only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifySig } from '../bot/src/notify.js';

const { pool, tx, withUser, createUser, notify } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const bn = await import('@/lib/server/botnotify');

const SECRET = 'k'.repeat(32);
const realFetch = globalThis.fetch;
const calls = [];
const was = { url: process.env.BOT_URL, secret: process.env.APP_BOT_SECRET };
const rnd = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const until = async (f) => {
  for (let i = 0; i < 100 && !f(); i += 1) await new Promise((r) => setTimeout(r, 20));
};
const quiet = () => new Promise((r) => setTimeout(r, 150));
const dep = (usd = '50.00') => ({ kind: 'deposit', title: 'Deposit received', body: `$${usd} was added to your balance.`, code: 'depPaid', vars: { usd } });

before(async () => {
  await migrate();
  process.env.BOT_URL = 'https://bot.test/';
  process.env.APP_BOT_SECRET = SECRET;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [['BOT_URL', was.url], ['APP_BOT_SECRET', was.secret]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool().end();
});

test('jobFor: Telegram accounts and the three events only, with every value the text needs', () => {
  const tg = { id: 'tg:123456' };
  assert.deepEqual(bn.jobFor(tg, { id: 'n1abc', ...dep() }), { tg_id: 123456, kind: 'depPaid', key: 'n1abc', vars: { usd: '50.00' } });
  assert.deepEqual(bn.jobFor(tg, { id: 'n2abc', code: 'wdSent', vars: { amt: '0.5 BTC' } }), { tg_id: 123456, kind: 'wdSent', key: 'n2abc', vars: { amt: '0.5 BTC' } });
  assert.deepEqual(bn.jobFor(tg, { id: 'n3abc', code: 'vipDrop', vars: { n: 2, date: '30 Nov' } }).vars, { n: 2, date: '30 Nov' });
  assert.equal(bn.jobFor({ id: 'a@b.com' }, { id: 'n1abc', ...dep() }), null, 'email account that is not linked');
  assert.deepEqual(bn.jobFor({ id: 'a@b.com', botTg: 777 }, { id: 'n1abc', ...dep() }), { tg_id: 777, kind: 'depPaid', key: 'n1abc', vars: { usd: '50.00' } }, 'email account linked to Telegram');
  assert.equal(bn.jobFor({ id: 'a@b.com', botTg: 'x' }, { id: 'n1abc', ...dep() }), null, 'odd link value');
  assert.equal(bn.jobFor({ id: 'a@b.com', botTg: -5 }, { id: 'n1abc', ...dep() }), null);
  assert.equal(bn.jobFor({ id: 'demo', botTg: 777 }, { id: 'n1abc', ...dep() }), null, 'only email accounts use the link');
  assert.equal(bn.jobFor({ id: 'demo' }, { id: 'n1abc', ...dep() }), null);
  assert.equal(bn.jobFor(tg, { id: 'n1abc', code: 'welcome' }), null, 'not one of the events');
  assert.equal(bn.jobFor(tg, { id: 'n1abc', code: 'toString' }), null);
  assert.equal(bn.jobFor(tg, { id: 'n1abc', code: 'depPaid', vars: {} }), null, 'a message with a hole is not sent');
  assert.equal(bn.jobFor(tg, { code: 'depPaid', vars: { usd: '1.00' } }), null, 'no id, no dedupe key');
});

test('botConfig is off without a URL or with a short secret, and drops the trailing slash', () => {
  assert.equal(bn.botConfig({}), null);
  assert.equal(bn.botConfig({ BOT_URL: 'https://b.x', APP_BOT_SECRET: 'short' }), null);
  assert.equal(bn.botConfig({ BOT_URL: 'ftp://b.x', APP_BOT_SECRET: SECRET }), null);
  assert.deepEqual(bn.botConfig({ BOT_URL: 'https://b.x/', APP_BOT_SECRET: SECRET }), { url: 'https://b.x', secret: SECRET });
});

test('the signature is the one the bot checks, and an old copy is refused', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200 };
  };
  const ok = await bn.post({ tg_id: 42, kind: 'depPaid', key: 'n9abcdefgh', vars: { usd: '5.00' } }, { url: 'https://b.x', secret: SECRET }, { fetchFn });
  assert.equal(ok, true);
  assert.equal(seen[0].url, 'https://b.x/notify');
  const body = verifySig(seen[0].init.body, seen[0].init.headers['x-app-sig'], SECRET);
  assert.ok(body, 'the bot accepts it');
  assert.equal(body.tg_id, 42);
  assert.equal(verifySig(seen[0].init.body, seen[0].init.headers['x-app-sig'], SECRET, Date.now() + 11 * 60_000), null, 'replay after 10 min');
  assert.equal(verifySig(seen[0].init.body, seen[0].init.headers['x-app-sig'], 'z'.repeat(32)), null, 'wrong secret');
});

test('post retries a network error or 5xx, never a 4xx', async () => {
  const cfg = { url: 'https://b.x', secret: SECRET };
  const job = { tg_id: 42, kind: 'depPaid', key: 'n9abcdefgh', vars: { usd: '5.00' } };
  const sleep = async () => {};
  let n = 0;
  const flaky = async () => {
    n += 1;
    if (n === 1) throw new Error('down');
    return n === 2 ? { ok: false, status: 502 } : { ok: true, status: 200 };
  };
  assert.equal(await bn.post(job, cfg, { fetchFn: flaky, sleep }), true);
  assert.equal(n, 3);
  n = 0;
  assert.equal(await bn.post(job, cfg, { fetchFn: async () => (n++, { ok: false, status: 400 }), sleep }), false);
  assert.equal(n, 1, 'a 4xx is not repeated');
  n = 0;
  assert.equal(await bn.post(job, cfg, { fetchFn: async () => (n++, { ok: false, status: 500 }), sleep }), false);
  assert.equal(n, 3, 'gives up after 3 tries');
});

test('a committed change for a Telegram account tells the bot once, after COMMIT', async () => {
  const id = `tg:${9000000 + (Date.now() % 1000000)}`;
  await tx((c) => createUser(c, id));
  calls.length = 0;
  let during = -1;
  await withUser(id, (u) => {
    notify(u, dep('50.00'));
    during = calls.length; // nothing goes out while the transaction is still open
  });
  assert.equal(during, 0);
  await until(() => calls.length >= 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://bot.test/notify');
  const body = verifySig(calls[0].init.body, calls[0].init.headers['x-app-sig'], SECRET);
  assert.ok(body, 'signed');
  assert.equal(body.tg_id, Number(id.slice(3)));
  assert.equal(body.kind, 'depPaid');
  assert.deepEqual(body.vars, { usd: '50.00' });
  assert.match(body.key, /^[A-Za-z0-9:_.-]{8,128}$/);
});

test('nothing is sent for a rolled-back change, an email account, another notification or when switched off', async () => {
  const id = `tg:${9000000 + ((Date.now() + 7) % 1000000)}`;
  const mail = `mail${rnd()}@x.test`;
  await tx((c) => createUser(c, id));
  await tx((c) => createUser(c, mail));
  calls.length = 0;

  await assert.rejects(() =>
    withUser(id, (u) => {
      notify(u, dep());
      throw new Error('boom');
    }),
  );
  await withUser(mail, (u) => notify(u, dep()));
  await withUser(id, (u) => notify(u, { kind: 'news', title: 'Welcome', body: 'Hi', code: 'welcome' }));
  delete process.env.BOT_URL;
  await withUser(id, (u) => notify(u, dep()));
  process.env.BOT_URL = 'https://bot.test/';
  await quiet();
  assert.equal(calls.length, 0);
});

test('the notification is still saved when the bot is down', async () => {
  const id = `tg:${9000000 + ((Date.now() + 13) % 1000000)}`;
  await tx((c) => createUser(c, id));
  const fetchWas = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('bot down');
  };
  try {
    await withUser(id, (u) => notify(u, dep('7.00')));
  } finally {
    globalThis.fetch = fetchWas;
  }
  let saved;
  await withUser(id, (u) => {
    saved = u.notifications.map((x) => x.code);
  });
  assert.deepEqual(saved, ['depPaid']);
});
