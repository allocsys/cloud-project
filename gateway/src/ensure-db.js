// Gives the gateway its own database on a Postgres server it shares with another service.
// Used only when GATEWAY_DB_NAME is set: DATABASE_URL then points at the server (any existing database),
// and the gateway creates and uses a separate database with that name, so its tables never mix with the app's.
// Tests and a dedicated Postgres leave GATEWAY_DB_NAME unset and nothing here runs.
import pg from 'pg';

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns the URL of database `name` on the same server as baseUrl. Creates the database if it is missing.
// Safe to call from several processes at once. Never puts the URL or password into an error message.
export async function ensureDatabase(baseUrl, name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error('GATEWAY_DB_NAME must be lowercase letters, digits and underscores, starting with a letter (max 63).');
  }
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  const current = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (current === name) {
    throw new Error('GATEWAY_DB_NAME is the database DATABASE_URL already points at. Pick another name so the gateway has its own database.');
  }

  const client = new pg.Client({
    connectionString: baseUrl,
    ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (found.rowCount > 0) break;
      try {
        // CREATE DATABASE takes no parameters; the name was validated above, so quoting it is safe.
        await client.query(`CREATE DATABASE "${name}"`);
        console.log(`[gateway] created database ${name}`);
        break;
      } catch (e) {
        // 42P04 / 23505: another process created it first. 55006: the template is busy with another CREATE DATABASE, try again.
        if (e.code === '42P04' || e.code === '23505') break;
        if (e.code === '55006' && attempt < 6) {
          await sleep(200 * attempt);
          continue;
        }
        throw e;
      }
    }
  } finally {
    await client.end();
  }

  u.pathname = `/${name}`;
  return u.toString();
}
