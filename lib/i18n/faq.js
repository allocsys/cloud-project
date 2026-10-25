// The FAQ (lib/faq.js) is written in English. For another language, the answer, the question label and the two fixed
// replies come from that language's book (lib/i18n/faq-<code>.js). Returns null when the book has no such entry,
// so the caller keeps the English text. To add a language, add its book here.
import fa from '@/lib/i18n/faq-fa';

const BOOKS = { fa };

export function faqTr(lang, key, vars) {
  const book = BOOKS[lang];
  if (!book || !Object.prototype.hasOwnProperty.call(book, key)) return null;
  const s = book[key];
  if (typeof s !== 'string') return null;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}
