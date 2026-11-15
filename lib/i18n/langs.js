// Language registry (server). To add a language: create lib/i18n/locales/<code>.js (copy en.js), import it here,
// add one entry to LANGS and to lib/i18n/meta.js (name and direction for the browser).
// The browser must not import this file: it carries all six locales. The browser gets its
// messages from the server through I18nProvider (see lib/i18n/client.js).
import en from '@/lib/i18n/locales/en';
import fa from '@/lib/i18n/locales/fa';
import ar from '@/lib/i18n/locales/ar';
import fi from '@/lib/i18n/locales/fi';
import sv from '@/lib/i18n/locales/sv';
import ru from '@/lib/i18n/locales/ru';
import { LANG_META } from '@/lib/i18n/meta';

export const DEFAULT_LANG = 'en';
export { LANG_COOKIE } from '@/lib/i18n/codes';

// name: shown in the switcher, in the language's own script. dir: 'ltr' or 'rtl'.
export const LANGS = {
  en: { ...LANG_META.en, messages: en },
  fa: { ...LANG_META.fa, messages: fa },
  ar: { ...LANG_META.ar, messages: ar },
  fi: { ...LANG_META.fi, messages: fi },
  sv: { ...LANG_META.sv, messages: sv },
  ru: { ...LANG_META.ru, messages: ru },
};

export function pickLang(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGS, v) ? v : DEFAULT_LANG;
}

// Messages for one language, with English filled in for any missing key, so the browser only
// needs one object. Used by the server to hand the active language to I18nProvider.
export function getMessages(lang) {
  const own = LANGS[lang]?.messages;
  return own && lang !== DEFAULT_LANG ? { ...LANGS[DEFAULT_LANG].messages, ...own } : LANGS[DEFAULT_LANG].messages;
}

// Looks the key up in the language, then in English, then falls back to the key itself.
// {name} placeholders are filled from vars.
export function translate(lang, key, vars) {
  const own = LANGS[lang]?.messages;
  let s = own && Object.prototype.hasOwnProperty.call(own, key) ? own[key] : LANGS[DEFAULT_LANG].messages[key];
  if (typeof s !== 'string') s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  return s;
}
