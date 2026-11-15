// Language metadata (name, direction) without the message files, so the browser bundle does not
// carry every locale. The messages live in lib/i18n/langs.js (server) and reach the browser
// through the I18nProvider's messages prop. To add a language: add it here and in langs.js.
import { DEFAULT_LANG, LANG_COOKIE } from '@/lib/i18n/codes';

export { DEFAULT_LANG, LANG_COOKIE };

export const LANG_META = {
  en: { name: 'English', dir: 'ltr' },
  fa: { name: 'فارسی', dir: 'rtl' },
  ar: { name: 'العربية', dir: 'rtl' },
  fi: { name: 'Suomi', dir: 'ltr' },
  sv: { name: 'Svenska', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
};
