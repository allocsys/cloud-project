// Creates (or refreshes) a limited Postgres login that owns the bot database and nothing else, so the running
// bot does not need the server's admin login. Meant to run once with the admin DATABASE_URL (BOT_DB_USER and
// BOT_DB_PASSWORD set); afterwards DATABASE_URL is switched to the limited login and the admin URL is removed.
import pg from 'pg';

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

// Returns the URL the bot should use from now on: same server, the limited login, the bot database.
// Safe to repeat: the password is reset every time. Errors never contain the URL or password.
export async function provisionRole(adminUrl, { db, role, password }) {
  if (typeof db !== 'string' || !NAME.test(db)) throw new Error('BOT_DB_NAME is not a valid database name.');
  if (typeof role !== 'string' || !NAME.test(role)) {
    throw new Error('BOT_DB_USER must be lowercase letters, digits and underscores, starting with a letter (max 63).');
  }
  if (typeof password !== 'string' || password.length < 16) throw new Error('BOT_DB_PASSWORD must be at least 16 characters.');
  if (['postgres', 'railway'].includes(role) || role.startsWith('pg_')) throw new Error('BOT_DB_USER must not be a built-in or admin login.');
  let u;
  try {
    u = new URL(adminUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (decodeURIComponent(u.username) === role) throw new Error('BOT_DB_USER is the login in DATABASE_URL already. Provision from the admin URL.');

  const ssl = process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const q = (v) => pg.escapeIdentifier(v);
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  await admin.connect();
  try {
    const have = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    const verb = have.rowCount > 0 ? 'ALTER' : 'CREATE';
    await admin.query(`${verb} ROLE ${q(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(password)}`);
    await admin.query(`ALTER DATABASE ${q(db)} OWNER TO ${q(role)}`);
    await admin.query(`REVOKE CONNECT ON DATABASE ${q(db)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${q(db)} TO ${q(role)}`);
  } finally {
    await admin.end();
  }

  // Objects created earlier by the admin login move to the new owner, so migrations keep working.
  const du = new URL(adminUrl);
  du.pathname = `/${db}`;
  const inDb = new pg.Client({ connectionString: du.toString(), ssl });
  await inDb.connect();
  try {
    const tables = await inDb.query("SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'");
    for (const t of tables.rows) await inDb.query(`ALTER TABLE public.${q(t.n)} OWNER TO ${q(role)}`);
  } finally {
    await inDb.end();
  }

  u.username = role;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}
