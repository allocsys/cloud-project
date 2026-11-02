// Settings from Railway variables. Values are never printed, only the names of missing ones.
const DB_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export function readConfig(env = process.env, need = ['BACKUP_KEY', 'CF_ACCOUNT_ID', 'CF_KV_NAMESPACE_ID', 'CF_API_TOKEN']) {
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing variables: ${missing.join(', ')}`);
  const gatewayDb = env.GATEWAY_DB_NAME || '';
  if (gatewayDb && !DB_NAME.test(gatewayDb)) throw new Error('GATEWAY_DB_NAME is not a valid database name.');
  return {
    secret: env.BACKUP_KEY,
    account: env.CF_ACCOUNT_ID,
    namespace: env.CF_KV_NAMESPACE_ID,
    token: env.CF_API_TOKEN,
    keep: Number(env.BACKUP_KEEP) > 0 ? Number(env.BACKUP_KEEP) : 14,
    dbUrl: env.BACKUP_DATABASE_URL || env.DATABASE_URL || '',
    gatewayDb,
  };
}

// The same server and login, another database.
export function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
