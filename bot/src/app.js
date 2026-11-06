// Webhook handler and command logic. No network of its own: Telegram calls go through `tg`, app calls through `appApi`, so tests can fake both.
import { q } from './db.js';
import { json, readJson, readRaw, ApiError } from './http.js';
import { t, helpText, hasLang } from './texts.js';
import { safeEqual } from './util.js';
import { verifySig, parseNotify, MAX_PENDING } from './notify.js';
import { enqueue, pendingCount } from './queue.js';
import { makeAppApi } from './appapi.js';

const CMD = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const NOT_FOUND = { ok: false, error: 'Not found.' };
const btcText = (n) => Number(n).toFixed(8);
const CODE = /^[A-Za-z0-9-]{3,32}$/;

export function makeBot({ config, tg, queue = null, appApi = makeAppApi({ config }) }) {
  const hits = new Map();
  const pending = new Set();

  // Per-chat limit: more than chatLimitPerMin messages in a minute are ignored.
  function limited(id, now = Date.now()) {
    let h = hits.get(id);
    if (!h || now >= h.reset) {
      h = { n: 0, reset: now + 60_000 };
      hits.set(id, h);
    }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
    return h.n > config.chatLimitPerMin;
  }

  async function reply(chatId, text, extra) {
    const r = await tg.sendMessage(chatId, text, extra);
    // 403 = the user blocked the bot: stop sending to this chat until it writes again.
    if (!r.ok && r.status === 403) await q('UPDATE chats SET active = false WHERE tg_id = $1', [chatId]);
    return r;
  }

  const openButton = (lang) => ({ reply_markup: { inline_keyboard: [[{ text: t(lang, 'open'), web_app: { url: config.appUrl } }]] } });

  // Asks the app for one set of numbers for the Telegram account (tg:<id>); the bot keeps no copy of any number.
  // Sends the 'no account' or 'try again' message itself and returns null; returns the answer only when it is good (valid(answer)).
  async function ask(chatId, lang, userId, name, valid) {
    const r = await appApi(name, { tg_id: userId });
    if (r.status === 404) {
      await reply(chatId, t(lang, 'noAcc'), openButton(lang));
      return null;
    }
    if (!r.ok || !r.json || !valid(r.json)) {
      await reply(chatId, t(lang, 'busy'));
      return null;
    }
    return r.json;
  }

  async function balance(chatId, lang, userId) {
    const b = await ask(chatId, lang, userId, 'balance', (x) => Number.isFinite(x.btc) && Number.isFinite(x.locked));
    if (!b) return;
    const lines = [t(lang, 'bal', { btc: btcText(b.btc) })];
    if (Number.isFinite(b.usd)) lines.push(t(lang, 'balUsd', { usd: b.usd.toFixed(2) }));
    if (b.locked > 0) lines.push(t(lang, 'balHold', { locked: btcText(b.locked) }));
    return reply(chatId, lines.join('\n'));
  }

  async function earnings(chatId, lang, userId) {
    const b = await ask(chatId, lang, userId, 'earnings', (x) => typeof x.miners === 'boolean' && Number.isFinite(x.today) && Number.isFinite(x.total));
    if (!b) return;
    if (!b.miners) return reply(chatId, t(lang, 'noMiners'), openButton(lang));
    const lines = [t(lang, 'earnToday', { btc: btcText(b.today) }), t(lang, 'earnTotal', { btc: btcText(b.total) })];
    if (Number.isFinite(b.avgUsd)) lines.push(t(lang, 'earnAvg', { usd: b.avgUsd.toFixed(2) }));
    return reply(chatId, lines.join('\n'));
  }

  async function referrals(chatId, lang, userId) {
    const b = await ask(chatId, lang, userId, 'referrals', (x) => Number.isInteger(x.friends) && Number.isInteger(x.active) && Number.isFinite(x.earned) && Number.isInteger(x.vip));
    if (!b) return;
    const lines = [];
    if (typeof b.code === 'string' && CODE.test(b.code)) {
      lines.push(t(lang, 'refCode', { code: b.code }));
      lines.push(t(lang, 'refLink', { link: `${config.appUrl}/login?ref=${encodeURIComponent(b.code)}` }));
    }
    lines.push(t(lang, 'refFriends', { n: b.friends, active: b.active }));
    lines.push(t(lang, 'refEarned', { btc: btcText(b.earned) }));
    if (b.vip > 0) lines.push(t(lang, 'refVip', { n: b.vip }));
    return reply(chatId, lines.join('\n'), openButton(lang));
  }

  // Links the Telegram id to the email account that made the code. The code is never logged or stored here.
  async function link(chatId, lang, userId, code) {
    if (!CODE.test(code)) return reply(chatId, t(lang, 'linkUsage'));
    const r = await appApi('link', { tg_id: userId, code });
    if (r.ok) return reply(chatId, t(lang, 'linkOk'));
    const key = { 404: 'linkBad', 409: 'linkTaken', 429: 'linkMany' }[r.status];
    return reply(chatId, t(lang, key || 'busy'));
  }

  async function handleUpdate(update) {
    const mc = update.my_chat_member;
    if (mc && mc.chat && mc.chat.type === 'private') {
      const left = mc.new_chat_member && ['kicked', 'left'].includes(mc.new_chat_member.status);
      await q('UPDATE chats SET active = $2 WHERE tg_id = $1', [mc.chat.id, !left]);
      return;
    }
    const m = update.message;
    if (!m || !m.chat || m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
    if (typeof m.text !== 'string') return;
    const id = m.chat.id;
    if (limited(id)) return;
    const guess = String(m.from.language_code || '').toLowerCase().startsWith('fa') ? 'fa' : 'en';
    const row = (
      await q(
        `INSERT INTO chats (tg_id, lang) VALUES ($1, $2)
         ON CONFLICT (tg_id) DO UPDATE SET active = true, last_seen_at = now() RETURNING lang`,
        [id, guess],
      )
    ).rows[0];
    const lang = row.lang;
    const c = CMD.exec(m.text.slice(0, 500).trim());
    const cmd = c ? c[1].toLowerCase() : '';
    const arg = c && c[2] ? c[2].trim().toLowerCase() : '';

    if (cmd === 'start') {
      return reply(id, t(lang, 'start'), openButton(lang));
    }
    if (cmd === 'balance') return balance(id, lang, m.from.id);
    if (cmd === 'earnings') return earnings(id, lang, m.from.id);
    if (cmd === 'referrals') return referrals(id, lang, m.from.id);
    if (cmd === 'link') return link(id, lang, m.from.id, arg);
    if (cmd === 'faq') {
      const path = lang === 'fa' && hasLang('fa') ? '/fa/faq' : '/faq';
      return reply(id, t(lang, 'faq'), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'faqBtn'), url: `${config.appUrl}${path}` }]] } });
    }
    if (cmd === 'support') return reply(id, t(lang, 'support', { email: config.supportEmail }));
    if (cmd === 'lang' && hasLang('fa')) {
      if (arg === 'en' || arg === 'fa') {
        await q('UPDATE chats SET lang = $2 WHERE tg_id = $1', [id, arg]);
        return reply(id, t(arg, 'langSet'));
      }
      return reply(id, t(lang, 'langUsage'));
    }
    return reply(id, helpText(lang));
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        try {
          await q('SELECT 1');
        } catch {
          return json(res, 503, { ok: false, service: 'vtx-bot', db: 'down' });
        }
        return json(res, 200, { ok: true, service: 'vtx-bot', db: 'ok' });
      }
      // The app asks for a message to be sent. Signed (HMAC), so only the app can call it. Off (404) until APP_BOT_SECRET is set.
      if (req.method === 'POST' && url.pathname === '/notify') {
        if (!config.notifySecret) return json(res, 404, NOT_FOUND);
        const raw = await readRaw(req, 16 * 1024);
        const body = verifySig(raw, req.headers['x-app-sig'], config.notifySecret);
        if (!body) return json(res, 401, { ok: false, error: 'Bad signature.' });
        const p = parseNotify(body);
        if (!p.ok) return json(res, 400, { ok: false, error: p.error });
        if ((await pendingCount()) >= MAX_PENDING) return json(res, 503, { ok: false, error: 'Queue is full.' });
        const added = await enqueue(p.value);
        if (added && queue) queue.wake();
        return json(res, 200, { ok: true, queued: added });
      }
      const m = /^\/tg\/([^/]{1,200})$/.exec(url.pathname);
      if (req.method === 'POST' && m && config.path && safeEqual(m[1], config.path)) {
        const given = req.headers['x-telegram-bot-api-secret-token'];
        if (!config.secret || typeof given !== 'string' || !safeEqual(given, config.secret)) return json(res, 404, NOT_FOUND);
        const update = await readJson(req, 64 * 1024);
        if (!Number.isSafeInteger(update.update_id)) throw new ApiError(400, 'Bad update.');
        // Telegram resends an update until it gets a 200: the same update_id is handled once.
        const fresh = await q('INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING', [update.update_id]);
        json(res, 200, { ok: true });
        if (fresh.rowCount === 0) return;
        const job = handleUpdate(update).catch((e) => console.error('[bot] update failed:', e.message));
        pending.add(job);
        job.finally(() => pending.delete(job));
        return;
      }
      return json(res, 404, NOT_FOUND);
    } catch (e) {
      if (e instanceof ApiError) return json(res, e.status, { ok: false, error: e.message });
      throw e;
    }
  }

  return { handler, handleUpdate, idle: () => Promise.all([...pending]) };
}
