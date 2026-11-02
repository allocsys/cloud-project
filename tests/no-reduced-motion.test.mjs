// Owner's choice: animations run whatever the phone's reduce-motion setting says. Browsers only reduce motion where our own
// code asks them to, so this test fails if a prefers-reduced-motion rule or query shows up anywhere in the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.git', 'tests', 'promo']);
const EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.html']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* files(full);
    else if (EXT.has(extname(name))) yield full;
  }
}

test('no prefers-reduced-motion rule anywhere in the source', () => {
  const hits = [];
  for (const f of files(ROOT)) {
    if (/prefers-reduced-motion/i.test(readFileSync(f, 'utf8'))) hits.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(hits, [], `reduce-motion rules are not allowed (owner's choice): ${hits.join(', ')}`);
});
