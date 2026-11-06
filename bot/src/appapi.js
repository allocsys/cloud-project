// Calls from the bot to the app: POST <APP_URL>/api/bot/<name>. Signed like the app's own notifications:
// same signBody, header x-app-sig, secret APP_BOT_SECRET, sent_at inside the signed body. Never throws.
import { signBody } from './notify.js';

export function makeAppApi({ config, fetchFn = (...a) => fetch(...a), timeoutMs = 8000 }) {
  // Returns { ok, status, json }. status 0 = off or no answer.
  return async function call(name, payload = {}) {
    if (!config.notifySecret || !/^[a-z]{1,32}$/.test(name)) return { ok: false, status: 0, json: null };
    const body = { ...payload, sent_at: new Date().toISOString() };
    try {
      const r = await fetchFn(`${config.appUrl}/api/bot/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-sig': signBody(body, config.notifySecret) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let json = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { ok: r.ok && !!json && json.ok === true, status: r.status, json };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  };
}
