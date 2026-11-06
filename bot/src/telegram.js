// Thin Telegram Bot API client. The token never appears in errors or logs.
const BASE = 'https://api.telegram.org';

export function telegram(token, fetchFn = fetch) {
  async function call(method, body = {}) {
    try {
      const r = await fetchFn(`${BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: !!j.ok, status: r.status, result: j.result, description: j.description, retryAfter: j.parameters?.retry_after };
    } catch (e) {
      return { ok: false, status: 0, description: e && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
  }
  return {
    call,
    sendMessage: (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text, ...extra }),
  };
}
