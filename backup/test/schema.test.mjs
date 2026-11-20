import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaOk } from '../src/apply.js';

const OLD = ['001_init', '002_boost_win_idx', '003_ticket_net_idx', '004_refund_requests', '005_bot_link_idx'];

test('the same migrations always fit', () => {
  assert.equal(schemaOk(['001_init'], ['001_init']), true);
  assert.equal(schemaOk(['001_deposits', '002_address_reuse'], ['001_deposits', '002_address_reuse']), true);
});

test('an app backup made before the fold still fits the one baseline', () => {
  assert.equal(schemaOk(['001_init'], OLD), true);
});

test('anything else is refused', () => {
  assert.equal(schemaOk(['001_init'], [...OLD, '006_other']), false);
  assert.equal(schemaOk(['001_init'], []), false);
  assert.equal(schemaOk(OLD, ['001_init']), false);
  assert.equal(schemaOk(['001_deposits', '002_address_reuse'], OLD), false);
});
