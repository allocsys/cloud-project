// Language registry. To add a language: create lib/i18n/locales/<code>.js (copy en.js), import it here, add one entry to LANGS.
// Pure and shared by the server and the browser, so keep it free of any framework import.
import en from '@/lib/i18n/locales/en';
import fa from '@/lib/i18n/locales/fa';

export const DEFAULT_LANG = 'en';
export { LANG_COOKIE } from '@/lib/i18n/codes';

// name: shown in the switcher, in the language's own script. dir: 'ltr' or 'rtl'.
export const LANGS = {
  en: { name: 'English', dir: 'ltr', messages: en },
  fa: { name: 'فارسی', dir: 'rtl', messages: fa },
};

export function pickLang(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGS, v) ? v : DEFAULT_LANG;
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
