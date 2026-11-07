// The Telegram bot the app links to (same default as the bot's own config).
export const BOT_NAME = /^[A-Za-z0-9_]{3,32}$/.test(process.env.BOT_USERNAME || '') ? process.env.BOT_USERNAME : 'vertexhashbot';
