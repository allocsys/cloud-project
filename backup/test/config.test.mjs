import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, withDatabase } from '../src/config.js';

const base = { BACKUP_KEY: 'k', CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };

test('names the missing variables, never their values', () => {
  assert.throws(() => readConfig({ BACKUP_KEY: 'x' }), /CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN/);
});

test('reads settings, default keep is 14, BACKUP_DATABASE_URL wins', () => {
  const c = readConfig({ ...base, DATABASE_URL: 'db1', BACKUP_DATABASE_URL: 'db2' });
  assert.equal(c.keep, 14);
  assert.equal(c.dbUrl, 'db2');
  assert.equal(readConfig({ ...base, BACKUP_KEEP: '7' }).keep, 7);
});

test('gateway database name is optional and checked', () => {
  assert.equal(readConfig(base).gatewayDb, '');
  assert.equal(readConfig({ ...base, GATEWAY_DB_NAME: 'vtx_gateway' }).gatewayDb, 'vtx_gateway');
  assert.throws(() => readConfig({ ...base, GATEWAY_DB_NAME: 'x; DROP' }), /not a valid database name/);
});

test('withDatabase swaps only the database name', () => {
  assert.equal(withDatabase('postgresql://u:p@postgres.railway.internal:5432/railway', 'gw'), 'postgresql://u:p@postgres.railway.internal:5432/gw');
});
