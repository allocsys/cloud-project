// The decoy password.txt: the repo file equals what the site serves, the helpers match only the decoy, and nothing in it looks like a real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECOY, DECOY_TEXT, isDecoyPass, isDecoyUser } from '@/lib/trap';

test('password.txt in the repo root is the same as the decoy the site serves', () => {
  assert.equal(readFileSync(new URL('../password.txt', import.meta.url), 'utf8'), DECOY_TEXT);
});

test('only the decoy password and the decoy names are matched', () => {
  assert.equal(isDecoyPass(DECOY.pass), true);
  assert.equal(isDecoyPass(`${DECOY.pass} `), false);
  assert.equal(isDecoyPass(''), false);
  assert.equal(isDecoyPass(undefined), false);
  assert.equal(isDecoyUser(' SysAdmin '), true);
  assert.equal(isDecoyUser(DECOY.email.toUpperCase()), true);
  assert.equal(isDecoyUser('admin'), false);
  assert.equal(isDecoyUser(null), false);
});

test('the decoy has no pattern a secret scanner would treat as a real key', () => {
  assert.doesNotMatch(DECOY_TEXT, /(AKIA|ghp_|gho_|github_pat_|sk-|xox[bpas]-|-----BEGIN|eyJ[A-Za-z0-9_-]{10,})/);
});
