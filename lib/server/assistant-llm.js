// Ask Vertexhash: the one place that talks to the LLM provider. Server-side only, the key never reaches the browser.
// Set LLM_API_KEY (and optionally LLM_MODEL) as Railway variables. Without a key every question falls back to the FAQ
// or to "contact support", so the feature keeps working.
// makeLlm(userId, snapshot) returns the function lib/assistant.js expects: (question) -> string, or null when the
// answer is not available (no key, daily limit reached, provider error, slow reply, empty reply).
import { buildPrompt } from '@/lib/assistant-context';
import { takeAnswer, giveBack } from '@/lib/assistant-limits';
import { LANGS, DEFAULT_LANG } from '@/lib/i18n/langs';

const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const MAX_TOKENS = 220; // the prompt asks for at most 80 words
const TIMEOUT_MS = 14000;

export const llmEnabled = () => !!process.env.LLM_API_KEY;
const model = () => process.env.LLM_MODEL || 'claude-haiku-5-5';

export function makeLlm(userId, snapshot, { fetchImpl = fetch, lang = DEFAULT_LANG } = {}) {
  return async (question) => {
    if (!llmEnabled()) return null;
    if (!takeAnswer(userId).ok) return null;
    try {
      const { system: base, user } = buildPrompt(question, snapshot);
      // Another language: ask for the reply in it. Digits stay 0-9 and BTC, USD, TH/s and coin names stay as written.
      const system = lang !== DEFAULT_LANG && LANGS[lang]
        ? `${base}\nWrite the answer in ${LANGS[lang].name} (language code ${lang}). Use Latin digits 0-9. Keep BTC, USD, TH/s and coin names as written.`
        : base;
      const res = await fetchImpl(URL, {
        method: 'POST',
        headers: { 'x-api-key': process.env.LLM_API_KEY, 'anthropic-version': VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: model(), max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error('[assistant] provider answered', res.status);
        giveBack(userId);
        return null;
      }
      const json = await res.json();
      const text = (json?.content || []).find((b) => b?.type === 'text')?.text;
      if (!text || !String(text).trim()) {
        giveBack(userId);
        return null;
      }
      return String(text).trim();
    } catch (e) {
      console.error('[assistant] provider call failed:', e?.name || 'error');
      giveBack(userId);
      return null;
    }
  };
}
