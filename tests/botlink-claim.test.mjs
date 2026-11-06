// Linking an email account to Telegram with the code (/link CODE): good code, wrong or expired code, one Telegram id for one account,
// the try limit, and that the bot calls then answer for the linked email account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { botLinkStart, botLinkClaim, botUnlink } = await import('@/lib/server/botlink');
const { linkFor, referralsFor, unlinkFor } = await import('@/lib/server/botapi');

const run = `bc${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const account = async (name) => {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
};
// Random Telegram ids (never 123456, which tests/botlink.test.mjs uses): the index on botTg is unique.
const tgId = () => 9_000_000_000 + Math.floor(Math.random() * 900_000_000);

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('a good code links the account once, then the code is gone', async () => {
  const id = await account('a');
  const tg = tgId();
  const { code } = await botLinkStart(id);
  const r = await botLinkClaim(tg, code);
  assert.equal(r.ok, true);
  const u = await getUser(id);
  assert.equal(u.botTg, tg);
  assert.equal(u.botLink, undefined);
  assert.equal((await botLinkClaim(tgId(), code)).status, 404, 'a used code is not valid');
  assert.equal((await botLinkStart(id)).status, 409, 'a linked account asks for no new code');
});

test('wrong and expired codes get the same answer', async () => {
  const id = await account('b');
  const tg = tgId();
  const { code } = await botLinkStart(id);
  const wrong = await botLinkClaim(tg, 'ZZZZZZZZ');
  assert.equal(wrong.status, 404);
  await withUser(id, (u) => {
    u.botLink.exp = Date.now() - 1000;
  });
  const old = await botLinkClaim(tg, code);
  assert.equal(old.status, 404);
  assert.equal(old.error, wrong.error);
  assert.equal((await getUser(id)).botTg, undefined, 'nothing was linked');
});

test('one Telegram id links to one account only', async () => {
  const a = await account('c1');
  const b = await account('c2');
  const tg = tgId();
  assert.equal((await botLinkClaim(tg, (await botLinkStart(a)).code)).ok, true);
  const second = await botLinkClaim(tg, (await botLinkStart(b)).code);
  assert.equal(second.status, 409);
  assert.equal((await getUser(b)).botTg, undefined);
});

test('after 5 wrong tries the Telegram id is stopped, even with a good code', async () => {
  const id = await account('d');
  const tg = tgId();
  const { code } = await botLinkStart(id);
  for (let i = 0; i < 5; i++) assert.equal((await botLinkClaim(tg, `BAD${i}BAD${i}`)).status, 404);
  assert.equal((await botLinkClaim(tg, code)).status, 429);
  assert.equal((await getUser(id)).botTg, undefined);
});

test('linkFor checks its input, and the bot calls then answer for the linked email account', async () => {
  const id = await account('e');
  const tg = tgId();
  assert.equal((await linkFor({ tg_id: 'x', code: 'ABCDEFGH' })).status, 400);
  assert.equal((await linkFor({ tg_id: tg, code: 'AB' })).status, 400);
  assert.equal((await linkFor({ tg_id: tg, code: 123 })).status, 400);
  assert.equal((await referralsFor({ tg_id: tg })).status, 404, 'no account before the link');
  const { code } = await botLinkStart(id);
  const r = await linkFor({ tg_id: tg, code: ` ${code.toLowerCase()} ` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const ref = await referralsFor({ tg_id: tg });
  assert.equal(ref.status, 200, 'the linked email account answers');
  assert.equal(ref.json.ok, true);
});

test('unlink removes the link, the bot calls stop answering, and the Telegram id can link again', async () => {
  const id = await account('f');
  const tg = tgId();
  assert.equal((await unlinkFor({ tg_id: 'x' })).status, 400);
  assert.equal((await unlinkFor({ tg_id: -1 })).status, 400);
  assert.equal((await unlinkFor({ tg_id: tg })).status, 404, 'nothing linked yet');
  assert.equal((await botLinkClaim(tg, (await botLinkStart(id)).code)).ok, true);
  assert.equal((await referralsFor({ tg_id: tg })).status, 200);
  const r = await unlinkFor({ tg_id: tg });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal((await getUser(id)).botTg, undefined);
  assert.equal((await referralsFor({ tg_id: tg })).status, 404, 'no account answers any more');
  assert.equal((await botUnlink(tg)).status, 404, 'a second unlink finds nothing');
  const again = await botLinkStart(id);
  assert.equal(again.ok, true, 'the account can ask for a new code');
  assert.equal((await botLinkClaim(tg, again.code)).ok, true, 'the same Telegram id links again');
});
