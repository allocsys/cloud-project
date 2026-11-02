import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';

test('names the missing variables, never their values', () => {
  assert.throws(() => readConfig({ BACKUP_KEY: 'x' }), /CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN/);
});

test('reads settings, default keep is 14, BACKUP_DATABASE_URL wins', () => {
  const c = readConfig({ BACKUP_KEY: 'k', CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't', DATABASE_URL: 'db1', BACKUP_DATABASE_URL: 'db2' });
  assert.equal(c.keep, 14);
  assert.equal(c.dbUrl, 'db2');
  assert.equal(readConfig({ BACKUP_KEY: 'k', CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't', BACKUP_KEEP: '7' }).keep, 7);
});
