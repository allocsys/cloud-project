// The web pages and the API can run as two services, so the code must keep one clean line between them (no database needed):
//   web   = components/, app/ except app/api/
//   api   = app/api/, lib/server/
//   shared = the rest of lib/, proxy.js (both sides load these)
// instrumentation.js is left out: it is the startup file that warms the pages and starts the API jobs, and step 3 splits it by role.
// A page reads data through lib/site-api.js (HTTP), never by importing the API code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(m?js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib'))].map((f) => posix(relative(ROOT, f)));
files.push('proxy.js');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// Every module a file imports (import ... from, import(), require()), as a path from the repo root without extension.
function importsOf(file) {
  const src = strip(readFileSync(join(ROOT, file), 'utf8'));
  const found = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  for (let m; (m = re.exec(src)); ) {
    const spec = m[1];
    if (spec.startsWith('@/')) found.push(spec.slice(2));
    else if (spec.startsWith('.')) found.push(posix(relative(ROOT, resolve(ROOT, dirname(file), spec))));
  }
  return found;
}

const side = (f) => {
  if (f.startsWith('app/api/') || f.startsWith('lib/server/')) return 'api';
  if (f.startsWith('app/') || f.startsWith('components/')) return 'web';
  return 'shared';
};
const sideOfImport = (p) => {
  if (p.startsWith('app/api/') || p === 'app/api' || p.startsWith('lib/server/') || p === 'lib/server') return 'api';
  if (p.startsWith('app/') || p === 'app' || p.startsWith('components/')) return 'web';
  return 'shared';
};

const bad = (from, to) =>
  files.flatMap((f) => (side(f) === from ? importsOf(f).filter((p) => sideOfImport(p) === to).map((p) => `${f} imports ${p}`) : []));

test('the scan sees the three sides', () => {
  for (const s of ['api', 'web', 'shared']) assert.ok(files.some((f) => side(f) === s), `no ${s} files found`);
  assert.ok(files.some((f) => importsOf(f).length), 'no imports found');
});

test('web files never import the API code', () => {
  assert.deepEqual(bad('web', 'api'), []);
});

test('the API code never imports web files', () => {
  assert.deepEqual(bad('api', 'web'), []);
});

test('shared files (lib/*, proxy.js) never import the API code or web files', () => {
  assert.deepEqual(bad('shared', 'api'), []);
  assert.deepEqual(bad('shared', 'web'), []);
});
