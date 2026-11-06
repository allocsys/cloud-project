// Webhook handler and command logic. No network of its own: Telegram calls go through `tg`, app calls through `appApi`, so tests can fake both.
import { q } from './db.js';
import { json, readJson, readRaw, ApiError } from './http.js';
import { t, helpText, hasLang } from './texts.js';
import { safeEqual } from './util.js';
import { verifySig, parseNotify, parseBroadcast, MAX_PENDING } from './notify.js';
import { enqueue, enqueueBroadcast, pendingCount } from './queue.js';
import { makeAppApi } from './appapi.js';

const CMD = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const NOT_FOUND = { ok: false, error: 'Not found.' };
const btcText = (n) => Number(n).toFixed(8);
const CODE = /^[A-Za-z0-9-]{3,32}$/;
// Button colors (Bot API 'style'): blue = main action, green = good news / share, red = stop. No style = the app's default grey.
const BLUE = 'primary';
const GREEN = 'success';
const RED = 'danger';
// Start payload from Settings > Connect Telegram: lnk_<link code>. Referral codes have no underscore, so the two cannot be mixed up.
const LINK_START = /^lnk_([A-Za-z0-9]{3,32})$/;
// Button taps: m:<action>:<version>. The version is the menu's counter: a tap is used once, then the counter moves on.
const MENU_DATA = /^m:([a-z_]{1,8}):(\d{1,9})$/;
const MENU_ACTIONS = new Set(['menu', 'more', 'bal', 'ear', 'ref', 'faq', 'help', 'lang', 'l_en', 'l_fa', 'stop']);

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

  const openRow = (lang, url = config.appUrl) => [{ text: t(lang, 'open'), web_app: { url }, style: BLUE }];
  const keyboard = (rows) => (rows.length ? { reply_markup: { inline_keyboard: rows } } : undefined);
  const botName = config.botUsername || 'vertexhashbot';
  const faqPath = (lang) => (lang === 'fa' && hasLang('fa') ? '/fa/faq' : '/faq');

  // A view is { text, rows }: the message text and the inline button rows under it.
  // Commands send a view as it is; the menu adds its own buttons.
  const send = (chatId, v) => reply(chatId, v.text, keyboard(v.rows));

  // Asks the app for one set of numbers for the Telegram account (tg:<id>); the bot keeps no copy of any number.
  // Returns { data } when the answer is good (valid(answer)), else { view } with the 'no account' or 'try again' message.
  async function fetchApp(lang, userId, name, valid) {
    const r = await appApi(name, { tg_id: userId });
    if (r.status === 404) return { view: { text: t(lang, 'noAcc'), rows: [openRow(lang)] } };
    if (!r.ok || !r.json || !valid(r.json)) return { view: { text: t(lang, 'busy'), rows: [] } };
    return { data: r.json };
  }

  async function balanceView(lang, userId) {
    const a = await fetchApp(lang, userId, 'balance', (x) => Number.isFinite(x.btc) && Number.isFinite(x.locked));
    if (!a.data) return a.view;
    const b = a.data;
    const lines = [t(lang, 'bal', { btc: btcText(b.btc) })];
    if (Number.isFinite(b.usd)) lines.push(t(lang, 'balUsd', { usd: b.usd.toFixed(2) }));
    if (b.locked > 0) lines.push(t(lang, 'balHold', { locked: btcText(b.locked) }));
    return { text: lines.join('\n'), rows: [] };
  }

  async function earningsView(lang, userId) {
    const a = await fetchApp(lang, userId, 'earnings', (x) => typeof x.miners === 'boolean' && Number.isFinite(x.today) && Number.isFinite(x.total));
    if (!a.data) return a.view;
    const b = a.data;
    if (!b.miners) return { text: t(lang, 'noMiners'), rows: [openRow(lang)] };
    const lines = [t(lang, 'earnToday', { btc: btcText(b.today) }), t(lang, 'earnTotal', { btc: btcText(b.total) })];
    if (Number.isFinite(b.avgUsd)) lines.push(t(lang, 'earnAvg', { usd: b.avgUsd.toFixed(2) }));
    return { text: lines.join('\n'), rows: [] };
  }

  async function referralsView(lang, userId) {
    const a = await fetchApp(lang, userId, 'referrals', (x) => Number.isInteger(x.friends) && Number.isInteger(x.active) && Number.isFinite(x.earned) && Number.isInteger(x.vip));
    if (!a.data) return a.view;
    const b = a.data;
    const lines = [];
    const rows = [];
    if (typeof b.code === 'string' && CODE.test(b.code)) {
      const c = encodeURIComponent(b.code);
      lines.push(t(lang, 'refCode', { code: b.code }));
      // No links in the text (no big preview card): the code and links are buttons that copy or share.
      // One button per row: full width, easy to tap.
      rows.push([{ text: t(lang, 'b_copyCode'), copy_text: { text: b.code }, style: BLUE }]);
      rows.push([{ text: t(lang, 'b_copyLink'), copy_text: { text: `${config.appUrl}/login?ref=${c}` }, style: BLUE }]);
      rows.push([{ text: t(lang, 'b_share'), url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${botName}?start=${c}`)}`, style: GREEN }]);
    }
    lines.push(t(lang, 'refFriends', { n: b.friends, active: b.active }));
    lines.push(t(lang, 'refEarned', { btc: btcText(b.earned) }));
    if (b.vip > 0) lines.push(t(lang, 'refVip', { n: b.vip }));
    rows.push(openRow(lang));
    return { text: lines.join('\n'), rows };
  }

  const faqView = (lang) => ({ text: t(lang, 'faq'), rows: [[{ text: t(lang, 'faqBtn'), url: `${config.appUrl}${faqPath(lang)}`, style: BLUE }]] });
  const supportView = (lang) => ({ text: t(lang, 'support', { email: config.supportEmail }), rows: [] });

  // Links the Telegram id to the email account that made the code (Settings > Connect Telegram). The code is never logged or stored here.
  // Returns the text to show.
  async function linkText(lang, userId, code) {
    const r = await appApi('link', { tg_id: userId, code });
    if (r.ok) return t(lang, 'linkOk');
    const key = { 404: 'linkBad', 409: 'linkTaken', 429: 'linkMany' }[r.status];
    return t(lang, key || 'busy');
  }

  // ---- Button menu ----
  // One live menu per chat: chats.menu_msg_id is its message, chats.menu_ver its counter. Every tap moves the counter on in one
  // UPDATE, so a second tap on the same buttons (double tap) or a button of an older menu finds the counter changed and is ignored.
  const mbtn = (lang, key, action, ver, style) => ({ text: t(lang, key), callback_data: `m:${action}:${ver}`, ...(style ? { style } : {}) });
  const menuRow = (lang, ver) => [mbtn(lang, 'b_menu', 'menu', ver)];
  const mainRows = (lang, ver, url) => [
    openRow(lang, url),
    [mbtn(lang, 'b_balance', 'bal', ver, GREEN)],
    [mbtn(lang, 'b_earnings', 'ear', ver, GREEN)],
    [mbtn(lang, 'b_friends', 'ref', ver, BLUE)],
    [mbtn(lang, 'b_more', 'more', ver)],
  ];
  const moreRows = (lang, ver) => [
    [mbtn(lang, 'b_faq', 'faq', ver, BLUE)],
    [mbtn(lang, 'b_help', 'help', ver, BLUE)],
    ...(hasLang('fa') ? [[mbtn(lang, 'b_lang', 'lang', ver, BLUE)]] : []),
    [mbtn(lang, 'b_stop', 'stop', ver, RED)],
    [mbtn(lang, 'b_back', 'menu', ver)],
  ];
  const langRows = (lang, ver) => [
    [
      { text: 'English', callback_data: `m:l_en:${ver}`, style: BLUE }],
    [
      { text: '\u0641\u0627\u0631\u0633\u06cc', callback_data: `m:l_fa:${ver}`, style: BLUE },
    ],
    [mbtn(lang, 'b_back', 'menu', ver)],
  ];

  // Sends the main menu as a new message and makes it the only live one: the buttons of the previous menu are taken away.
  async function sendMenu(chatId, lang, text, url) {
    const row = (
      await q(
        `WITH old AS (SELECT menu_msg_id FROM chats WHERE tg_id = $1)
         UPDATE chats SET menu_ver = menu_ver + 1, menu_msg_id = NULL FROM old WHERE tg_id = $1
         RETURNING chats.menu_ver AS ver, old.menu_msg_id AS old_id`,
        [chatId],
      )
    ).rows[0];
    const r = await reply(chatId, text, { reply_markup: { inline_keyboard: mainRows(lang, row.ver, url) } });
    const mid = r.result && r.result.message_id;
    if (r.ok && Number.isSafeInteger(mid)) {
      await q('UPDATE chats SET menu_msg_id = $2 WHERE tg_id = $1 AND menu_ver = $3', [chatId, mid, row.ver]);
      if (row.old_id) await tg.editMessageReplyMarkup(chatId, Number(row.old_id), { inline_keyboard: [] });
    }
    return r;
  }

  async function handleCallback(cb) {
    const msg = cb.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private' || !cb.from || cb.from.is_bot || typeof cb.data !== 'string') return;
    const id = msg.chat.id;
    const mid = msg.message_id;
    await tg.answerCallbackQuery(cb.id); // stops the spinner on the button at once
    if (limited(id)) return;
    const d = MENU_DATA.exec(cb.data);
    if (!d || !MENU_ACTIONS.has(d[1]) || !Number.isSafeInteger(mid)) return;
    const act = d[1];

    // Take the tap: only the live menu with the matching counter gets through, and only once.
    const row = (
      await q(
        `UPDATE chats SET menu_ver = menu_ver + 1, active = true, last_seen_at = now()
         WHERE tg_id = $1 AND menu_msg_id = $2 AND menu_ver = $3 RETURNING menu_ver, lang`,
        [id, mid, Number(d[2])],
      )
    ).rows[0];
    if (!row) {
      // A double tap on the live menu is just ignored. A button of an older menu loses its buttons.
      const cur = (await q('SELECT menu_msg_id FROM chats WHERE tg_id = $1', [id])).rows[0];
      if (cur && String(cur.menu_msg_id) !== String(mid)) await tg.editMessageReplyMarkup(id, mid, { inline_keyboard: [] });
      return;
    }
    const ver = row.menu_ver;
    let lang = row.lang;
    let view;
    if (act === 'menu') view = { text: t(lang, 'start'), rows: mainRows(lang, ver) };
    else if (act === 'more') view = { text: '', rows: [] }; // only the buttons change, below
    else if (act === 'bal') view = await balanceView(lang, cb.from.id);
    else if (act === 'ear') view = await earningsView(lang, cb.from.id);
    else if (act === 'ref') view = await referralsView(lang, cb.from.id);
    else if (act === 'faq') view = faqView(lang);
    else if (act === 'help') view = supportView(lang);
    else if (act === 'stop') {
      await q('UPDATE chats SET news = false WHERE tg_id = $1', [id]);
      view = { text: t(lang, 'stopOk'), rows: [] };
    } else if (act === 'lang') {
      if (!hasLang('fa')) view = { text: t(lang, 'langSet'), rows: [] };
      else view = { text: t(lang, 'langSet'), rows: langRows(lang, ver) };
    } else if (act === 'l_en' || act === 'l_fa') {
      lang = act === 'l_fa' && hasLang('fa') ? 'fa' : 'en';
      await q('UPDATE chats SET lang = $2 WHERE tg_id = $1', [id, lang]);
      view = { text: t(lang, 'start'), rows: mainRows(lang, ver) };
    }
    // Answers end with one Menu button; the menu pages carry their own buttons.
    const own = act === 'menu' || act === 'l_en' || act === 'l_fa' || (act === 'lang' && hasLang('fa'));
    const rows = own ? view.rows : [...(view.rows || []), menuRow(lang, ver)];
    const done =
      act === 'more'
        ? await tg.editMessageReplyMarkup(id, mid, { inline_keyboard: moreRows(lang, ver) })
        : await tg.editMessageText(id, mid, view.text, { reply_markup: { inline_keyboard: rows } });
    if (!done.ok && !/not modified/i.test(done.description || '')) {
      // The buttons on screen still carry the old counter: give it back so they keep working.
      if (done.status === 403) await q('UPDATE chats SET active = false WHERE tg_id = $1', [id]);
      await q('UPDATE chats SET menu_ver = menu_ver - 1 WHERE tg_id = $1 AND menu_msg_id = $2 AND menu_ver = $3', [id, mid, ver]);
    }
  }

  async function handleUpdate(update) {
    if (update.callback_query) return handleCallback(update.callback_query);
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
         ON CONFLICT (tg_id) DO UPDATE SET active = true, last_seen_at = now() RETURNING lang, news`,
        [id, guess],
      )
    ).rows[0];
    const lang = row.lang;
    // The permanent Menu button under the chat sends its own label as text: open the menu.
    const said = m.text.trim();
    if (said === t('en', 'b_menu') || said === t('fa', 'b_menu')) return sendMenu(id, lang, t(lang, 'start'));
    const c = CMD.exec(m.text.slice(0, 500).trim());
    const cmd = c ? c[1].toLowerCase() : '';
    const rawArg = c && c[2] ? c[2].trim() : '';
    const arg = rawArg.toLowerCase();

    if (cmd === 'start') {
      // A start payload is a referral code: the app opens on the sign-up page with it. The code keeps its case.
      // A payload lnk_<code> is a link code from Settings > Connect Telegram: it links the account and says so.
      const code = rawArg.split(/\s+/)[0];
      const lk = LINK_START.exec(code);
      const url = CODE.test(code) ? `${config.appUrl}/login?ref=${encodeURIComponent(code)}` : config.appUrl;
      // Writing /start turns news back on; say so only when it was off.
      let text = lk ? await linkText(lang, m.from.id, lk[1]) : t(lang, 'start');
      if (row.news === false) {
        await q('UPDATE chats SET news = true WHERE tg_id = $1', [id]);
        text += '\n' + t(lang, 'newsOn');
      }
      const sentMenu = await sendMenu(id, lang, text, url);
      // Puts the permanent Menu button under the chat (it stays until removed).
      await reply(id, t(lang, 'kbOn'), { reply_markup: { keyboard: [[{ text: t(lang, 'b_menu') }]], resize_keyboard: true, is_persistent: true } });
      return sentMenu;
    }
    if (cmd === 'stop') {
      await q('UPDATE chats SET news = false WHERE tg_id = $1', [id]);
      return reply(id, t(lang, 'stopOk'));
    }
    if (cmd === 'balance') return send(id, await balanceView(lang, m.from.id));
    if (cmd === 'earnings') return send(id, await earningsView(lang, m.from.id));
    if (cmd === 'referrals') return send(id, await referralsView(lang, m.from.id));
    if (cmd === 'faq') return send(id, faqView(lang));
    if (cmd === 'support') return send(id, supportView(lang));
    if (cmd === 'lang' && hasLang('fa')) {
      if (arg === 'en' || arg === 'fa') {
        await q('UPDATE chats SET lang = $2 WHERE tg_id = $1', [id, arg]);
        return reply(id, t(arg, 'langSet'));
      }
      return reply(id, t(lang, 'langUsage'));
    }
    return sendMenu(id, lang, helpText(lang));
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
      // The app asks for a news message to all chats that have news on, or one test message. Signed like /notify. Off (404) until APP_BOT_SECRET is set.
      if (req.method === 'POST' && url.pathname === '/broadcast') {
        if (!config.notifySecret) return json(res, 404, NOT_FOUND);
        const raw = await readRaw(req, 16 * 1024);
        const body = verifySig(raw, req.headers['x-app-sig'], config.notifySecret);
        if (!body) return json(res, 401, { ok: false, error: 'Bad signature.' });
        const p = parseBroadcast(body);
        if (!p.ok) return json(res, 400, { ok: false, error: p.error });
        if ((await pendingCount()) >= MAX_PENDING) return json(res, 503, { ok: false, error: 'Queue is full.' });
        const added = await enqueueBroadcast(p.value);
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
