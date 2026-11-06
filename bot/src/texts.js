// All bot texts. English is the base; a language with no entry for a key falls back to English.
// Persian (fa) wording approved by the owner on 6 Nov 2026.
export const texts = {
  en: {
    start: 'Welcome to VERTEXHASH.\nTap the button to open the app.',
    open: 'Open app',
    faq: 'Answers to common questions are on our site.',
    faqBtn: 'Read FAQ',
    support: 'Need help? Write to {email}.',
    langSet: 'Language: English',
    langUsage: 'Use /lang en or /lang fa.',
    bal: 'Balance: {btc} BTC',
    balUsd: '≈ ${usd}',
    balHold: 'On hold: {locked} BTC',
    earnToday: 'Today: {btc} BTC',
    earnTotal: 'Total: {btc} BTC',
    earnAvg: 'Per day: ≈ ${usd}',
    noMiners: 'No miners yet. Open the app to start.',
    refCode: 'Your code: {code}',
    refLink: 'Link: {link}',
    refFriends: 'Friends: {n} ({active} active)',
    refEarned: 'Earned: {btc} BTC',
    refVip: 'VIP: {n}',
    noAcc: 'No account found. Open the app first.',
    busy: 'Try again in a minute.',
    linkUsage: 'Send /link CODE. Get the code in Settings.',
    linkOk: 'Account linked.',
    linkBad: 'Code not valid.',
    linkTaken: 'Already linked to another account.',
    linkMany: 'Too many tries. Wait a few minutes.',
    d_start: 'Open the app',
    d_balance: 'Show balance',
    d_earnings: 'Show earnings',
    d_referrals: 'Invite friends',
    d_faq: 'Read the FAQ',
    d_support: 'Get help',
    d_lang: 'Change language',
    d_link: 'Link your account',
    n_depPaid: 'Deposit received: ${usd}.',
    n_wdSent: 'Withdrawal sent: {amt}.',
    n_vipDrop: 'VIP {n} drops on {date}.',
  },
  fa: {
    start: 'به VERTEXHASH خوش آمدید.\nبرای باز کردن برنامه دکمه را بزنید.',
    open: 'باز کردن برنامه',
    faq: 'پاسخ سؤال‌های رایج در سایت ما است.',
    faqBtn: 'خواندن سؤال‌ها',
    support: 'به کمک نیاز دارید؟ به {email} بنویسید.',
    langSet: 'زبان: فارسی',
    langUsage: 'از /lang en یا /lang fa استفاده کنید.',
    bal: 'موجودی: {btc} BTC',
    balUsd: '≈ ${usd}',
    balHold: 'مسدود: {locked} BTC',
    earnToday: 'امروز: {btc} BTC',
    earnTotal: 'مجموع: {btc} BTC',
    earnAvg: 'روزانه: ≈ ${usd}',
    noMiners: 'هنوز ماینری ندارید. برای شروع برنامه را باز کنید.',
    refCode: 'کد شما: {code}',
    refLink: 'لینک: {link}',
    refFriends: 'دوستان: {n} ({active} فعال)',
    refEarned: 'درآمد: {btc} BTC',
    refVip: 'VIP: {n}',
    noAcc: 'حسابی پیدا نشد. اول برنامه را باز کنید.',
    busy: 'کمی بعد دوباره امتحان کنید.',
    linkUsage: 'کد را بعد از /link بفرستید. کد در تنظیمات است.',
    linkOk: 'حساب متصل شد.',
    linkBad: 'کد معتبر نیست.',
    linkTaken: 'قبلاً به حساب دیگری متصل شده است.',
    linkMany: 'تلاش زیاد. چند دقیقه صبر کنید.',
    d_start: 'باز کردن برنامه',
    d_balance: 'نمایش موجودی',
    d_earnings: 'نمایش درآمد',
    d_referrals: 'دعوت دوستان',
    d_faq: 'سؤال‌های رایج',
    d_support: 'دریافت کمک',
    d_lang: 'تغییر زبان',
    d_link: 'اتصال حساب',
    n_depPaid: 'واریز شد: ${usd}.',
    n_wdSent: 'برداشت ارسال شد: {amt}.',
    n_vipDrop: 'سطح VIP {n} در {date} کاهش می‌یابد.',
  },
};

export const hasLang = (l) => l === 'en' || Object.keys(texts[l] || {}).length > 0;

export function t(lang, key, vars = {}) {
  const s = (texts[lang] && texts[lang][key]) ?? texts.en[key] ?? '';
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

export function commandList(lang) {
  const names = ['start', 'balance', 'earnings', 'referrals', 'link', 'faq', 'support'];
  if (hasLang('fa')) names.push('lang');
  return names.map((command) => ({ command, description: t(lang, `d_${command}`) }));
}

export const helpText = (lang) => commandList(lang).map((c) => `/${c.command} - ${c.description}`).join('\n');
