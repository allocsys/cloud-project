// Outbox queue for notifications. Rows are written by POST /notify and sent here, paced.
//
// - At most `perSec` sends a second (one send, then a short wait). Run ONE replica: the pace is per process.
// - 429 from Telegram: stop the round, wait retry_after (+1 s), nothing is lost and no try is counted.
// - 403 (bot blocked) or chat not found: the chat is marked inactive and the row is skipped. Writing to the bot again turns it on.
// - Other failures: retry with backoff 30 s, 1 min, 2 min ... up to 1 hour; after MAX_ATTEMPTS the row is marked failed.
// - A row older than 24 h is expired, not sent (a late money message would only confuse).
// - Several rounds may run on several replicas: rows are claimed with FOR UPDATE SKIP LOCKED and a 60 s lease.
import { q } from './db.js';
import { t } from './texts.js';

export const MAX_ATTEMPTS = 8;
export const backoffSeconds = (n) => Math.min(30 * 2 ** Math.max(0, n - 1), 3600);
const LEASE_SECONDS = 60;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Adds a row. false = a row with this key already exists (a repeat from the app), nothing changed.
export async function enqueue({ tg_id, kind, key, lang = null, vars = {} }) {
  const r = await q(
    'INSERT INTO notify_outbox (dedupe_key, tg_id, kind, lang, vars) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (dedupe_key) DO NOTHING',
    [key, tg_id, kind, lang, JSON.stringify(vars)],
  );
  return r.rowCount === 1;
}

export const pendingCount = async () => (await q("SELECT count(*)::int AS n FROM notify_outbox WHERE status = 'pending'")).rows[0].n;

// Queues a broadcast. test = one row for that chat only (sent even if it did /stop). Otherwise one row per active chat that has news on.
// Returns the number of rows added; the same id again adds nothing.
export async function enqueueBroadcast({ id, en, fa = null, test = null }) {
  const vars = JSON.stringify(fa ? { en, fa } : { en });
  if (test) {
    const v = JSON.stringify(fa ? { en, fa, test: true } : { en, test: true });
    const r = await q("INSERT INTO notify_outbox (dedupe_key, tg_id, kind, vars) VALUES ($1, $2, 'broadcast', $3::jsonb) ON CONFLICT (dedupe_key) DO NOTHING", [`bct:${id}:${test}`, test, v]);
    return r.rowCount;
  }
  const r = await q(
    `INSERT INTO notify_outbox (dedupe_key, tg_id, kind, lang, vars)
     SELECT 'bc:' || $1::text || ':' || tg_id, tg_id, 'broadcast', lang, $2::jsonb FROM chats WHERE active AND news
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [id, vars],
  );
  return r.rowCount;
}

const finish = (id, status, error = null) =>
  q('UPDATE notify_outbox SET status = $2, last_error = $3, attempts = attempts + 1, done_at = now() WHERE id = $1', [id, status, error]);

export function makeQueue({ tg, config, sleep = defaultSleep, now = Date.now, log = console, batch = 50 }) {
  const gap = Math.ceil(1000 / (config.notifyPerSec || 25));
  const bgap = Math.ceil(1000 / (config.broadcastPerSec || 10));
  const markup = config.appUrl ? { reply_markup: { inline_keyboard: [[{ text: '', web_app: { url: config.appUrl } }]] } } : {};
  let pausedUntil = 0;
  let running = null;
  let stopped = true;
  let timer = null;

  async function deliverDue() {
    const out = { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, paused: false };
    if (now() < pausedUntil) {
      out.paused = true;
      return out;
    }
    await q("UPDATE notify_outbox SET status = 'expired', last_error = 'too old', done_at = now() WHERE status = 'pending' AND created_at < now() - interval '24 hours'");
    const rows = (
      await q(
        `UPDATE notify_outbox SET next_try_at = now() + make_interval(secs => $2)
         WHERE id IN (SELECT id FROM notify_outbox WHERE status = 'pending' AND next_try_at <= now() ORDER BY (kind = 'broadcast'), id LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING id, tg_id, kind, lang, vars, attempts`,
        [batch, LEASE_SECONDS],
      )
    ).rows.sort((a, b) => (a.kind === 'broadcast') - (b.kind === 'broadcast') || Number(a.id) - Number(b.id));
    out.claimed = rows.length;
    let sentAny = false;
    for (const [i, row] of rows.entries()) {
      const chat = (await q('SELECT lang, active, news FROM chats WHERE tg_id = $1', [row.tg_id])).rows[0];
      const bc = row.kind === 'broadcast';
      if (chat && !chat.active) {
        await finish(row.id, 'skipped', 'blocked');
        out.skipped++;
        continue;
      }
      if (bc && chat && chat.news === false && !(row.vars && row.vars.test)) {
        await finish(row.id, 'skipped', 'news off');
        out.skipped++;
        continue;
      }
      const lang = (chat && chat.lang) || row.lang || 'en';
      const text = bc ? String((row.vars && (row.vars[lang] || row.vars.en)) || '') : t(lang, 'n_' + row.kind, row.vars);
      if (!text) {
        await finish(row.id, 'failed', 'no text');
        out.failed++;
        continue;
      }
      if (sentAny) await sleep(bc ? bgap : gap);
      sentAny = true;
      const extra = markup.reply_markup ? { reply_markup: { inline_keyboard: [[{ text: t(lang, 'open'), web_app: { url: config.appUrl } }]] } } : {};
      const r = await tg.sendMessage(row.tg_id, text, extra);
      if (r.ok) {
        await finish(row.id, 'sent');
        out.sent++;
        continue;
      }
      if (r.status === 429) {
        const wait = Math.max(1, Math.ceil(Number(r.retryAfter) || 5)) + 1;
        pausedUntil = now() + wait * 1000;
        const rest = rows.slice(i).map((x) => x.id);
        await q("UPDATE notify_outbox SET next_try_at = now() + make_interval(secs => $2) WHERE id = ANY($1::bigint[]) AND status = 'pending'", [rest, wait]);
        out.paused = true;
        break;
      }
      const gone = r.status === 403 || (r.status === 400 && /chat not found|user is deactivated/i.test(String(r.description || '')));
      if (gone) {
        await q('UPDATE chats SET active = false WHERE tg_id = $1', [row.tg_id]);
        await finish(row.id, 'skipped', 'blocked');
        out.skipped++;
        continue;
      }
      const attempts = row.attempts + 1;
      const error = String(r.description || 'send failed').slice(0, 200);
      if (attempts >= MAX_ATTEMPTS) {
        await q("UPDATE notify_outbox SET status = 'failed', attempts = $2, last_error = $3, done_at = now() WHERE id = $1", [row.id, attempts, error]);
        out.failed++;
        log.error(JSON.stringify({ level: 'error', msg: 'notify.gave_up', id: Number(row.id), kind: row.kind, attempts, error }));
      } else {
        await q('UPDATE notify_outbox SET attempts = $2, last_error = $3, next_try_at = now() + make_interval(secs => $4) WHERE id = $1', [row.id, attempts, error, backoffSeconds(attempts)]);
        out.retry++;
      }
    }
    return out;
  }

  async function tick(intervalMs) {
    if (running || stopped) return;
    let more = false;
    running = deliverDue()
      .then((o) => {
        more = o.claimed >= batch && !o.paused;
      })
      .catch((e) => log.error(JSON.stringify({ level: 'error', msg: 'notify.tick_failed', error: e.message })));
    await running;
    running = null;
    if (!stopped) {
      timer = setTimeout(() => tick(intervalMs), more ? 0 : intervalMs);
      timer.unref?.();
    }
  }

  let every = 1000;
  return {
    deliverDue,
    start(intervalMs = 1000) {
      every = intervalMs;
      stopped = false;
      timer = setTimeout(() => tick(every), 0);
      timer.unref?.();
    },
    // Send soon: called after a new row was added.
    wake() {
      if (stopped || running) return;
      clearTimeout(timer);
      timer = setTimeout(() => tick(every), 0);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
