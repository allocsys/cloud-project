// Client-side translation over the messages the server hands to I18nProvider.
// The browser bundle must not import lib/i18n/langs.js (it carries all six locales), so the
// provider registers the active language's messages here for code that runs outside React
// (error translation in lib/api.js). Nothing on the server reads this.
import { DEFAULT_LANG } from '@/lib/i18n/codes';
import EN from '@/lib/i18n/locales/en';

let messagesLang = DEFAULT_LANG;
let messages = null;

// Called by I18nProvider on the client, on every render, so the messages are in place before
// any error can be translated. Idempotent: same language, same object.
export function setClientMessages(lang, next) {
  messagesLang = lang;
  messages = next;
}

// Looks the key up in the registered messages; anything else falls back to the key itself,
// which translateError turns back into the English server text.
export function translateClient(lang, key, vars) {
  // Until the page's messages are in place (first paint, a refresh), or for a key the language leaves out, the English text is
  // shown instead of the raw key.
  const table = lang === messagesLang && messages ? messages : EN;
  let s = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  if (typeof s !== 'string' && table !== EN && Object.prototype.hasOwnProperty.call(EN, key)) s = EN[key];
  if (typeof s !== 'string') s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return s;
}
