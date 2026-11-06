// All bot texts. English is the base; a language with no entry for a key falls back to English.
// Persian (fa) stays empty until the owner approves the wording.
export const texts = {
  en: {
    start: 'Welcome to VERTEXHASH.\nTap the button to open the app.',
    open: 'Open app',
    faq: 'Answers to common questions are on our site.',
    faqBtn: 'Read FAQ',
    support: 'Need help? Write to {email}.',
    langSet: 'Language: English',
    langUsage: 'Use /lang en or /lang fa.',
    d_start: 'Open the app',
    d_faq: 'Read the FAQ',
    d_support: 'Get help',
    d_lang: 'Change language',
  },
  fa: {},
};

export const hasLang = (l) => l === 'en' || Object.keys(texts[l] || {}).length > 0;

export function t(lang, key, vars = {}) {
  const s = (texts[lang] && texts[lang][key]) ?? texts.en[key] ?? '';
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

export function commandList(lang) {
  const names = ['start', 'faq', 'support'];
  if (hasLang('fa')) names.push('lang');
  return names.map((command) => ({ command, description: t(lang, `d_${command}`) }));
}

export const helpText = (lang) => commandList(lang).map((c) => `/${c.command} - ${c.description}`).join('\n');
