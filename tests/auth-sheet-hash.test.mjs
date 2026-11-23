// Telegram hands a Mini App its launch data in the URL hash (#tgWebAppData=...), and its script reads it after the page loads.
// The sign-in sheet cleans the address bar after reading an invite link; if that drops the hash, the 'Continue with Telegram'
// button never shows. This test fails if the clean-up stops keeping the hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/AuthSheet.js'), 'utf8');

test('AuthSheet address clean-up keeps location.hash', () => {
  const calls = src.match(/history\.replaceState\([^)]*\)[^;\n]*/g) || [];
  const clean = calls.filter((c) => /'', *[`'"]\//.test(c));
  assert.ok(clean.length >= 1, 'expected the address clean-up call in AuthSheet.js');
  for (const c of clean) assert.match(c, /location\.hash/, `replaceState must keep the hash: ${c}`);
});
