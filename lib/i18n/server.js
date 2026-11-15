import { cookies } from 'next/headers';
import { LANG_COOKIE, pickLang, translate, getMessages as loadMessages } from '@/lib/i18n/langs';

// For server components and routes: the language comes from the cookie, so the first paint is already in the right language.
export async function getLang() {
  const jar = await cookies();
  return pickLang(jar.get(LANG_COOKIE)?.value);
}

export async function getT() {
  const lang = await getLang();
  return (key, vars) => translate(lang, key, vars);
}

// The active language's messages (English filled in for missing keys) for I18nProvider.
export async function getMessages(lang) {
  return loadMessages(lang ?? (await getLang()));
}
