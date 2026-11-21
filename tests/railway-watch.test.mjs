// Railway redeploys a service only when a file in its watch patterns changes (railway.web.json, railway.api.json).
// A file that no pattern lists would never redeploy, so this test walks the real tree and checks each file:
//   api only  = app/api/, lib/server/                      -> api patterns match, web patterns do not
//   web only  = the rest of app/, components/, public/     -> web patterns match, api patterns do not
//   both      = shared lib/, middleware.js, build files    -> both match
// No database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => p.split(sep).join('/');

// Railway patterns are gitignore-style from the repo root: ** crosses folders, * stays inside one.
export function toRegExp(pattern) {
  const p = pattern.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    if (p.startsWith('**', i)) {
      re += '.*';
      i++;
    } else if (p[i] === '*') re += '[^/]*';
    else re += p[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const load = (name) => {
  const patterns = JSON.parse(readFileSync(join(ROOT, name), 'utf8')).build?.watchPatterns;
  assert.ok(Array.isArray(patterns) && patterns.length, `${name} has no build.watchPatterns`);
  return patterns.map(toRegExp);
};
const web = load('railway.web.json');
const api = load('railway.api.json');
const hit = (res, f) => res.some((r) => r.test(f));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(posix(relative(ROOT, full)));
  }
  return out;
}

const ROOT_FILES = ['middleware.js', 'instrumentation.js', 'next.config.mjs', 'jsconfig.json', 'package.json', 'package-lock.json', 'Dockerfile'];
const files = [
  ...['app', 'components', 'lib', 'public', 'scripts'].flatMap((d) => walk(join(ROOT, d))),
  ...ROOT_FILES.filter((f) => existsSync(join(ROOT, f))),
];

const kind = (f) => {
  if (f.startsWith('app/api/') || f.startsWith('lib/server/')) return 'api';
  if (f.startsWith('app/') || f.startsWith('components/') || f.startsWith('public/')) return 'web';
  return 'both';
};
const of = (k) => files.filter((f) => kind(f) === k);

// .railway/railway.ts keeps its own copy of the two lists (a TypeScript file cannot be imported here), so compare the text.
const rawPatterns = (name) => JSON.parse(readFileSync(join(ROOT, name), 'utf8')).build.watchPatterns;
const tsList = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} not found in .railway/railway.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test('.railway/railway.ts lists the same watch patterns as the two json files', () => {
  const src = readFileSync(join(ROOT, '.railway/railway.ts'), 'utf8');
  assert.deepEqual(tsList(src, 'WEB_WATCH'), rawPatterns('railway.web.json'));
  assert.deepEqual(tsList(src, 'API_WATCH'), rawPatterns('railway.api.json'));
});

test('the pattern matcher follows gitignore-style rules', () => {
  const m = (pat, f) => toRegExp(pat).test(f);
  assert.ok(m('/lib/*.js', 'lib/data.js'));
  assert.ok(!m('/lib/*.js', 'lib/server/db.js'));
  assert.ok(m('/lib/i18n/**', 'lib/i18n/en/a.json'));
  assert.ok(m('/app/(app)/**', 'app/(app)/wallet/page.js'));
  assert.ok(!m('/app/(app)/**', 'app/api/x/route.js'));
  assert.ok(m('/Dockerfile', 'Dockerfile'));
  assert.ok(!m('/Dockerfile', 'Dockerfile.bak'));
});

test('the scan sees every group of files', () => {
  for (const k of ['api', 'web', 'both']) assert.ok(of(k).length, `no ${k} files found`);
});

test('every API file is watched by the api service and not by web', () => {
  assert.deepEqual(of('api').filter((f) => !hit(api, f)), [], 'api files the api patterns miss');
  assert.deepEqual(of('api').filter((f) => hit(web, f)), [], 'api files that would redeploy web');
});

test('every web file is watched by the web service and not by api', () => {
  assert.deepEqual(of('web').filter((f) => !hit(web, f)), [], 'web files the web patterns miss');
  assert.deepEqual(of('web').filter((f) => hit(api, f)), [], 'web files that would redeploy api');
});

test('shared and build files are watched by both services', () => {
  assert.deepEqual(of('both').filter((f) => !hit(web, f)), [], 'shared files the web patterns miss');
  assert.deepEqual(of('both').filter((f) => !hit(api, f)), [], 'shared files the api patterns miss');
});
