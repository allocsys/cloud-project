// Emails the server sends (reset link, verification link, add-email code) in the language the person uses.
// kind: 'reset' | 'verify' | 'code'. Keys are mail.<kind>.s (subject) and mail.<kind>.b (text); vars: { url } or { code }.
import { translate } from '@/lib/i18n/langs';

export function mailText(lang, kind, vars) {
  return { subject: translate(lang, `mail.${kind}.s`, vars), text: translate(lang, `mail.${kind}.b`, vars) };
}
