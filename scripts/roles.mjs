// One codebase, three ways to run it, chosen by APP_ROLE when the app is built (and again when it starts):
//   all  (default) pages and API in one server, as before
//   web  pages only: the API code is removed, so the build holds no database code and needs no secrets
//   api  API only: the pages are removed, so the build needs no fonts and loads no page code
// The build removes what the role does not use. Only run it on a fresh checkout (Docker, CI): it deletes files.
import { rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROLES = ['all', 'web', 'api'];

// instrumentation.js imports these two files by role; the role that does not use one gets an empty stand-in, so the import still builds.
const API_START = 'lib/server/start.js';
const WEB_WARM = 'app/warm.js';
const apiStub = `// Built as the web service: no API code here, so nothing starts.\nexport async function startApi() {}\n`;
const webStub = `// Built as the API service: no pages here, so nothing to warm.\nexport async function warmPages() {}\n`;

// App entries the API service keeps; everything else under app/ is a page or a page file.
const API_KEEP = ['api'];

export function pruneRole(root, role) {
  if (!ROLES.includes(role)) throw new Error(`APP_ROLE must be one of ${ROLES.join(', ')} (got "${role}")`);
  if (role === 'all') return [];
  const removed = [];
  const drop = (rel) => {
    rmSync(join(root, rel), { recursive: true, force: true });
    removed.push(rel);
  };
  if (role === 'web') {
    drop('app/api');
    for (const name of existsSync(join(root, 'lib/server')) ? readdirSync(join(root, 'lib/server')) : []) drop(`lib/server/${name}`);
    mkdirSync(join(root, 'lib/server'), { recursive: true });
    writeFileSync(join(root, API_START), apiStub);
  } else {
    for (const name of readdirSync(join(root, 'app'))) if (!API_KEEP.includes(name)) drop(`app/${name}`);
    writeFileSync(join(root, WEB_WARM), webStub);
  }
  return removed;
}
