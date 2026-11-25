import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaOk } from '../src/apply.js';

const OLD = ['001_init', '002_boost_win_idx', '003_ticket_net_idx', '004_refund_requests', '005_bot_link_idx'];
const OLD2 = ['001_init', '002_auto_boost_idx', '003_backfill_codes', '004_codes_columns', '005_codes_only'];

test('the same migrations always fit', () => {
  assert.equal(schemaOk(['001_init'], ['001_init']), true);
  assert.equal(schemaOk(['001_deposits', '002_address_reuse'], ['001_deposits', '002_address_reuse']), true);
});

test('an app backup made before either fold still fits the one baseline', () => {
  assert.equal(schemaOk(['001_init'], OLD), true);
  assert.equal(schemaOk(['001_init'], OLD2), true);
});

test('steps after the baseline do not stop a folded backup', () => {
  assert.equal(schemaOk(['001_init', '006_next'], OLD), true);
  assert.equal(schemaOk(['001_init', '006_next'], OLD2), true);
  assert.equal(schemaOk(['001_init', '006_next'], ['001_init']), true);
  assert.equal(schemaOk(['001_init', '006_next'], [...OLD, '006_other']), false);
});

test('anything else is refused', () => {
  assert.equal(schemaOk(['001_init'], [...OLD, '006_other']), false);
  assert.equal(schemaOk(['001_init'], []), false);
  assert.equal(schemaOk(OLD, ['001_init']), false);
  assert.equal(schemaOk(OLD2, ['001_init']), false);
  assert.equal(schemaOk(['001_deposits', '002_address_reuse'], OLD), false);
});
