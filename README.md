# Opus Cloud Mining

Cloud mining app. Black and gold, responsive (bottom tabs on mobile, sidebar on desktop). Next.js 15 App Router, React 19, plain JavaScript, Postgres. Installable as a PWA.

## Run

```bash
npm install
DATABASE_URL=postgres://user:password@host:5432/dbname npm run dev
```

`DATABASE_URL` is required. Tables are created on boot by numbered migrations. See `DEPLOY.md` for Docker, hosting, environment variables and running several servers.

## Test

```bash
npm test
```

Runs `node --test` against a real Postgres (set `DATABASE_URL`, `PRICE_FEED=static`, `SESSION_SECRET`). CI runs the same on Postgres 16 for every push and pull request (`.github/workflows/db-test.yml`). Tests cover concurrent signups, logins, buys, withdrawals, payment settlement, serial numbers, idempotency keys, sign-in throttling, and admin actions.

## Screens

| Route | What it does |
| --- | --- |
| `/login` | Sign in, sign up (with referral code), password reset, Telegram Mini App login |
| `/dashboard` | Balance and total mined, earnings chart, miners, recent activity |
| `/plans` | Plans and custom power. Buy from balance or by crypto invoice |
| `/wallet` | Withdraw, deposit, history |
| `/referrals` | Invite codes with rebates, rewards, rules |
| `/settings` | Email, password, theme (Dark, Light, Auto), sign out |
| `/admin` | Overview, users, orders, plans, referrals, send. Needs `ADMIN_TOKEN` |

Logged-in pages live in the `app/(app)/` route group.

## Backend

Code is in `lib/server/`:

- `db.js`: connection pool, row-locked transactions with retry, idempotency keys, sign-in throttle, serial numbers
- `migrations.js`, `migrate.js`: schema, applied under an advisory lock
- `auth.js`, `account.js`, `kyc.js`: accounts, sessions, passwords, reset
- `wallet.js`, `miners.js`, `referrals.js`: balances, purchases, miners, rewards
- `admin.js`: admin actions and audit log
- `pay-provider.js`: NOWPayments invoices and signed webhook (`/api/payments/webhook`)

Health check: `GET /api/health`.

## Not built yet

Real deposit addresses, KYC photo storage, email verification, native app (the site can be wrapped as a TWA).
