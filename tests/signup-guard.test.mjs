// Anti account farming: one network may have only a set number of accounts in total, by email or Telegram; the admin can change or switch it off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const guard = await import('@/lib/server/signup-guard');

const PW = 'correct horse 1';
const TOKEN = 'test-bot-token';
const run = Date.now().toString(36);
const ipOf = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.7`;

const initData = (tgId) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, first_name: 'Farm' }) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
};

before(async () => {
  await migrate();
  await guard.saveSignupGuard({ enabled: true, max: 3 });
});

after(async () => {
  await guard.saveSignupGuard({ enabled: true, max: 3 });
  await pool().end();
});

test('the settings are checked and saved', async () => {
  assert.deepEqual(await guard.signupGuard(), { on: true, max: 3 });
  assert.equal((await guard.saveSignupGuard({ max: 0 })).status, 422);
  assert.equal((await guard.saveSignupGuard({ max: 51 })).status, 422);
  assert.equal((await guard.saveSignupGuard({ max: 'x' })).status, 422);
  assert.equal((await guard.saveSignupGuard({ enabled: 'yes' })).status, 400);
  const r = await guard.saveSignupGuard({ max: '5' });
  assert.equal(r.max, 5);
  assert.equal(r.on, true);
  assert.equal((await guard.saveSignupGuard({ max: 3 })).max, 3);
});

test('the fourth account from one network is refused, another network is not', async () => {
  const ip = ipOf();
  for (let i = 1; i <= 3; i += 1) assert.ok((await auth.signup({ email: `farm${i}.${run}@mail.com`, password: PW }, ip)).ok);
  const r = await auth.signup({ email: `farm4.${run}@mail.com`, password: PW }, ip);
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
  assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [`farm4.${run}@mail.com`])).rowCount, 0, 'nothing was created');
  // the same /24 counts as one network
  assert.equal((await auth.signup({ email: `farm5.${run}@mail.com`, password: PW }, ip.replace(/\.7$/, '.99'))).status, 429);
  // an existing account still signs in
  assert.ok((await auth.login({ email: `farm1.${run}@mail.com`, password: PW })).ok);
  // another network is fine, and so is an unknown address
  assert.ok((await auth.signup({ email: `other.${run}@mail.com`, password: PW }, ipOf())).ok);
  assert.ok((await auth.signup({ email: `noip.${run}@mail.com`, password: PW })).ok);
});

test('the limit has no time window: accounts older than a day still count', async () => {
  const ip = ipOf();
  for (let i = 1; i <= 3; i += 1) assert.ok((await auth.signup({ email: `old${i}.${run}@mail.com`, password: PW }, ip)).ok);
  await q("UPDATE users SET data = jsonb_set(data, '{createdAt}', to_jsonb($1::numeric)) WHERE id LIKE $2", [Date.now() - 5 * 86400000, `old%.${run}@mail.com`]);
  assert.equal((await auth.signup({ email: `old4.${run}@mail.com`, password: PW }, ip)).status, 429);
});

test('Telegram sign-ups count too, and a known Telegram account is never limited', async () => {
  const was = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  try {
    const ip = ipOf();
    const base = 9000000 + (Date.now() % 1000000);
    for (let i = 0; i < 3; i += 1) assert.equal((await auth.telegramLogin(initData(base + i), '', ip)).status, 200);
    const r = await auth.telegramLogin(initData(base + 3), '', ip);
    assert.equal(r.status, 429);
    assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [`tg:${base + 3}`])).rowCount, 0, 'nothing was created');
    assert.equal((await auth.telegramLogin(initData(base), '', ip)).status, 200); // already has an account
  } finally {
    if (was === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = was;
  }
});

test('a raised number lets more in, and switching it off lets everyone in', async () => {
  const ip = ipOf();
  for (let i = 1; i <= 3; i += 1) assert.ok((await auth.signup({ email: `raise${i}.${run}@mail.com`, password: PW }, ip)).ok);
  assert.equal((await auth.signup({ email: `raise4.${run}@mail.com`, password: PW }, ip)).status, 429);
  await guard.saveSignupGuard({ max: 4 });
  assert.ok((await auth.signup({ email: `raise4.${run}@mail.com`, password: PW }, ip)).ok);
  assert.equal((await auth.signup({ email: `raise5.${run}@mail.com`, password: PW }, ip)).status, 429);
  await guard.saveSignupGuard({ enabled: false });
  assert.ok((await auth.signup({ email: `raise5.${run}@mail.com`, password: PW }, ip)).ok);
  await guard.saveSignupGuard({ enabled: true, max: 3 });
});

test('several sign-ups at the same moment cannot get past the limit', async () => {
  const ip = ipOf();
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => auth.signup({ email: `race${i}.${run}@mail.com`, password: PW }, ip)));
  assert.equal(rs.filter((r) => r.ok).length, 3);
  assert.equal(rs.filter((r) => r.status === 429).length, 5);
});
