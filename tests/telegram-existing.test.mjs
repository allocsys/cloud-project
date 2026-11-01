// The home screen's automatic Telegram sign-in (existingOnly): it opens an account that already exists and never creates one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');

const TOKEN = 'test-bot-token';

const initData = (tgId) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, first_name: 'Auto' }) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
};

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('existing-only Telegram sign-in: no account stays no account, a known one signs in', async () => {
  const was = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  try {
    const tgId = 8000000 + (Date.now() % 1000000);
    const id = `tg:${tgId}`;
    const none = await auth.telegramLogin(initData(tgId), '', '', true);
    assert.equal(none.ok, false);
    assert.equal(none.status, 404);
    assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount, 0, 'nothing was created');

    assert.equal((await auth.telegramLogin(initData(tgId), '')).status, 200); // the sign-in button creates it

    const again = await auth.telegramLogin(initData(tgId), '', '', true);
    assert.equal(again.status, 200);
    assert.equal(again.id, id);

    assert.equal((await auth.telegramLogin('hash=bad', '', '', true)).status, 401); // a forged one is still refused
  } finally {
    if (was === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = was;
  }
});
