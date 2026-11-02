# Nightly backup

Railway cron service. Root Directory `backup`, schedule `0 3 * * *`, Watch Paths `/backup/**`.
Runs once and exits. For the app database and the gateway database (a separate database on the same Postgres server):
dump, encrypt, upload to Cloudflare KV, read back and check, keep the last 14 of each.

## Variables (Railway, on this service)

- `DATABASE_URL` the Postgres PRIVATE address, with a login that can read both databases (`BACKUP_DATABASE_URL` wins if set)
- `GATEWAY_DB_NAME` the gateway database name, the same value the gateway uses. Without it the gateway is NOT backed up
- `BACKUP_KEY` secret, 24+ characters. Keep a copy somewhere safe: without it a backup cannot be opened
- `CF_ACCOUNT_ID` Cloudflare account id
- `CF_KV_NAMESPACE_ID` KV namespace id
- `CF_API_TOKEN` token limited to Workers KV Storage: Edit
- `BACKUP_KEEP` optional, default 14

## Restore

    cd backup && npm install
    node src/restore.js list                     # app backups   (gateway: node src/restore.js gateway list)
    node src/restore.js latest app.gz            # or a date from the list
    node src/restore.js gateway latest gw.gz

App: open Admin, Database, Restore and upload `app.gz`.
Gateway, or the app into any database: `node src/apply.js gw.gz <postgres-url> RESTORE`.
The target needs the same tables first (run the service's migrations on an empty database).

The files hold emails, balances and wallet addresses. Delete them after use.
