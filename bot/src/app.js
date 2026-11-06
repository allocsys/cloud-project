// Webhook handler and command logic. No network of its own: Telegram calls go through `tg`, so tests can fake it.
import { q } from './db.js';
import { json, readJson, ApiError } from './http.js';
import { t, helpText, hasLang } from './texts.js';
import { safeEqual } from './util.js';

const CMD = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const NOT_FOUND = { ok: false, error: 'Not found.' };

export function makeBot({ config, tg }) {
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
      return reply(id, t(lang, 'start'), { reply_markup: { inline_keyboard: [[{ text: t(lang, 'open'), web_app: { url: config.appUrl } }]] } });
    }
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
