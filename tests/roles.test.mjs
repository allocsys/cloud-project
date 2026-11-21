// The build removes what a role does not use (scripts/roles.mjs). Runs on a temporary folder, never on the real code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneRole, ROLES } from '../scripts/roles.mjs';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'roles-'));
  for (const f of ['app/api/x/route.js', 'app/page.js', 'app/layout.js', 'app/(site)/a/page.js', 'app/globals.css', 'lib/server/db.js', 'lib/server/start.js', 'lib/i18n.js']) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '// real');
  }
  return root;
}
const ls = (root, d) => readdirSync(join(root, d)).sort();

test('all keeps everything', () => {
  const root = tree();
  assert.deepEqual(pruneRole(root, 'all'), []);
  assert.deepEqual(ls(root, 'app'), ['(site)', 'api', 'globals.css', 'layout.js', 'page.js']);
  assert.equal(readFileSync(join(root, 'lib/server/start.js'), 'utf8'), '// real');
  rmSync(root, { recursive: true });
});

test('web drops the API code and starts nothing', () => {
  const root = tree();
  pruneRole(root, 'web');
  assert.deepEqual(ls(root, 'app'), ['(site)', 'globals.css', 'layout.js', 'page.js']);
  assert.deepEqual(ls(root, 'lib/server'), ['start.js']);
  assert.match(readFileSync(join(root, 'lib/server/start.js'), 'utf8'), /async function startApi\(\) \{\}/);
  assert.deepEqual(ls(root, 'lib'), ['i18n.js', 'server']);
  rmSync(root, { recursive: true });
});

test('api keeps only app/api and warms no pages', () => {
  const root = tree();
  pruneRole(root, 'api');
  assert.deepEqual(ls(root, 'app'), ['api', 'warm.js']);
  assert.match(readFileSync(join(root, 'app/warm.js'), 'utf8'), /async function warmPages\(\) \{\}/);
  assert.deepEqual(ls(root, 'lib/server'), ['db.js', 'start.js']);
  rmSync(root, { recursive: true });
});

test('an unknown role is refused', () => {
  assert.deepEqual(ROLES, ['all', 'web', 'api']);
  assert.throws(() => pruneRole(tree(), 'both'), /APP_ROLE must be one of/);
});
