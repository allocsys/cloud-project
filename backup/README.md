# Nightly backup

Railway cron service. Root Directory `backup`, schedule `0 3 * * *`, Watch Paths `backup/**`.
Runs once and exits: dump, encrypt, upload to Cloudflare KV, check it reads back, keep the last 14.

## Variables (Railway, on this service)

- `DATABASE_URL` the Postgres PRIVATE address (`BACKUP_DATABASE_URL` wins if set)
- `BACKUP_KEY` secret, 24+ characters. Keep a copy somewhere safe: without it a backup cannot be opened
- `CF_ACCOUNT_ID` Cloudflare account id
- `CF_KV_NAMESPACE_ID` KV namespace id (from the maintenance Worker deploy)
- `CF_API_TOKEN` token limited to Workers KV Storage: Edit
- `BACKUP_KEEP` optional, default 14

## Restore

    cd backup && npm install
    node src/restore.js list
    node src/restore.js latest backup.gz        # or a date from the list

Then open Admin, Database, Restore and upload `backup.gz`.

The file holds emails, balances and wallet addresses. Delete it after use.
