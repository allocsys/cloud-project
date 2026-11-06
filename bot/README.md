# Vertexhash Telegram bot

Separate Railway service (root `/bot`). Webhook mode, plain `node:http`, one dependency (`pg`).
It has its OWN database and never touches the app database. Rules, fees and VIP numbers are not copied here.

## Variables

| Name | Meaning |
| --- | --- |
| BOT_TOKEN | Bot token (reference the app variable TELEGRAM_BOT_TOKEN) |
| BOT_WEBHOOK_PATH | Secret part of the webhook URL, 16-64 letters, digits, `_` or `-` |
| BOT_WEBHOOK_SECRET | Value of Telegram's secret header, 16-256 of the same characters |
| APP_URL | https address of the app, no path |
| DATABASE_URL | The bot database |
| BOT_DB_NAME, BOT_DB_USER, BOT_DB_PASSWORD | One-time setup: with an admin DATABASE_URL the bot creates its own database and a limited login. Afterwards point DATABASE_URL at the limited login and remove these three. |
| RAILWAY_PUBLIC_DOMAIN or BOT_PUBLIC_HOST | Public host; at boot the bot sets the Telegram webhook to `https://HOST/tg/BOT_WEBHOOK_PATH` |
| SUPPORT_EMAIL | Optional, default support@vertexhash.com |
| CHAT_LIMIT_PER_MIN | Optional, default 20 messages per chat per minute |

## Endpoints

- `GET /health` database check.
- `POST /tg/<BOT_WEBHOOK_PATH>` Telegram updates. Needs the `X-Telegram-Bot-Api-Secret-Token` header. Anything else is a 404.

## Commands

/start, /help, /faq, /support. /lang appears once Persian texts are added (src/texts.js).

## Tests

`DATABASE_URL=postgres://... npm test` (needs an empty Postgres database).
