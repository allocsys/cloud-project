import test from 'node:test';
import assert from 'node:assert/strict';
import { securityLevel } from '@/lib/security-level';

test('security level counts a verified email and two-factor', () => {
  assert.equal(securityLevel(undefined), 'low');
  assert.equal(securityLevel({ telegram: true }), 'low');
  assert.equal(securityLevel({ email: 'a@b.co', verified: false }), 'low');
  assert.equal(securityLevel({ email: 'a@b.co', verified: true }), 'medium');
  assert.equal(securityLevel({ email: 'a@b.co', verified: false, twofa: true }), 'medium');
  assert.equal(securityLevel({ email: 'a@b.co', verified: true, twofa: true }), 'high');
});
