// Creates (or refreshes) a limited Postgres login that owns the gateway database and nothing else, so the running
// gateway does not need the server's admin login. Meant to run once with the admin DATABASE_URL (GATEWAY_DB_USER and
// GATEWAY_DB_PASSWORD set); afterwards DATABASE_URL is switched to the returned URL and the admin URL is removed.
// The login cannot create databases or roles, and it has no rights on other databases' tables.
import pg from 'pg';

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

// Returns the URL the gateway should use from now on: same server, the limited login, the gateway database.
// Safe to repeat: the password is reset every time, so rotating GATEWAY_DB_PASSWORD works. Errors never contain the URL or password.
export async function provisionRole(adminUrl, { db, role, password }) {
  if (typeof db !== 'string' || !NAME.test(db)) throw new Error('GATEWAY_DB_NAME is not a valid database name.');
  if (typeof role !== 'string' || !NAME.test(role)) {
    throw new Error('GATEWAY_DB_USER must be lowercase letters, digits and underscores, starting with a letter (max 63).');
  }
  if (typeof password !== 'string' || password.length < 16) throw new Error('GATEWAY_DB_PASSWORD must be at least 16 characters.');
  if (['postgres', 'railway'].includes(role) || role.startsWith('pg_')) throw new Error('GATEWAY_DB_USER must not be a built-in or admin login.');
  let u;
  try {
    u = new URL(adminUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (decodeURIComponent(u.username) === role) throw new Error('GATEWAY_DB_USER is the login in DATABASE_URL already. Provision from the admin URL.');

  const ssl = process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const q = (v) => pg.escapeIdentifier(v);
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  await admin.connect();
  try {
    // 1. the login: no superuser, no createdb, no createrole. Password is set on every run.
    const have = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    const verb = have.rowCount > 0 ? 'ALTER' : 'CREATE';
    await admin.query(`${verb} ROLE ${q(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(password)}`);
    // 2. the database belongs to it, and only it (and admins) can connect.
    await admin.query(`ALTER DATABASE ${q(db)} OWNER TO ${q(role)}`);
    await admin.query(`REVOKE CONNECT ON DATABASE ${q(db)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${q(db)} TO ${q(role)}`);
  } finally {
    await admin.end();
  }

  // 3. objects created earlier by the admin login (the first boot) move to the new owner, so migrations keep working.
  const du = new URL(adminUrl);
  du.pathname = `/${db}`;
  const inDb = new pg.Client({ connectionString: du.toString(), ssl });
  await inDb.connect();
  try {
    const tables = await inDb.query("SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'");
    for (const t of tables.rows) await inDb.query(`ALTER TABLE public.${q(t.n)} OWNER TO ${q(role)}`);
    const seqs = await inDb.query(
      "SELECT c.relname AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'S'",
    );
    for (const s of seqs.rows) await inDb.query(`ALTER SEQUENCE public.${q(s.n)} OWNER TO ${q(role)}`);
    const fns = await inDb.query(
      `SELECT p.proname AS n, pg_get_function_identity_arguments(p.oid) AS a FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
       WHERE s.nspname = 'public' AND p.prokind = 'f'`,
    );
    for (const f of fns.rows) await inDb.query(`ALTER FUNCTION public.${q(f.n)}(${f.a}) OWNER TO ${q(role)}`);
  } finally {
    await inDb.end();
  }

  u.username = role;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}
