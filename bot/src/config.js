// Settings come only from environment variables. Errors name the variable, never its value.
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export function config(env = process.env) {
  return {
    token: env.BOT_TOKEN || '',
    path: env.BOT_WEBHOOK_PATH || '',
    secret: env.BOT_WEBHOOK_SECRET || '',
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    publicHost: env.BOT_PUBLIC_HOST || env.RAILWAY_PUBLIC_DOMAIN || '',
    supportEmail: env.SUPPORT_EMAIL || 'support@vertexhash.com',
    chatLimitPerMin: num(env.CHAT_LIMIT_PER_MIN, 20),
    // Shared with the app. Empty = POST /notify is switched off (404).
    notifySecret: env.APP_BOT_SECRET || '',
    // Telegram allows about 30 messages a second to different chats; stay under it.
    notifyPerSec: Math.min(Math.max(num(env.NOTIFY_PER_SEC, 25), 1), 28),
  };
}

export function checkConfig(c) {
  const bad = [];
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(c.token)) bad.push('BOT_TOKEN');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(c.path)) bad.push('BOT_WEBHOOK_PATH (16-64 letters, digits, _ or -)');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(c.secret)) bad.push('BOT_WEBHOOK_SECRET (16-256 letters, digits, _ or -)');
  if (c.path && c.path === c.secret) bad.push('BOT_WEBHOOK_PATH and BOT_WEBHOOK_SECRET must differ');
  if (!/^https:\/\/[^\s/]+$/.test(c.appUrl)) bad.push('APP_URL (https, no path)');
  if (c.notifySecret && c.notifySecret.length < 16) bad.push('APP_BOT_SECRET (at least 16 characters)');
  if (c.notifySecret && (c.notifySecret === c.secret || c.notifySecret === c.path)) bad.push('APP_BOT_SECRET must differ from the webhook values');
  if (bad.length) throw new Error(`Bad or missing settings: ${bad.join(', ')}`);
}
