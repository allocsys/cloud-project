import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { faqAnswer, faqList, faqVars } from '@/lib/faq';
import { faqTr } from '@/lib/i18n/faq';
import { minDeposit } from '@/lib/server/flags';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const h3 = { fontSize: '14.5px', margin: '14px 0 4px' };

// Only general questions that are the same for everyone. The answers are the ones the owner approved in lib/faq.js
// (read from there, never copied), so a change to an answer shows here too. Smart Mining, boost, bonus and paused-day
// answers are left off on purpose. In another language an answer shows only when that language's book has it.
const GROUPS = [
  { h: 'faq.g1', ids: ['plans', 'plan_duration', 'hardware', 'electricity', 'returns', 'btc_price', 'multi_plan', 'units'] },
  { h: 'faq.g2', ids: ['deposit', 'deposit_min', 'networks', 'pay_method', 'withdraw_how', 'withdraw_min', 'withdraw_time', 'fees', 'withdraw_fee', 'refund', 'wrong_address'] },
  { h: 'faq.g3', ids: ['register', 'demo', 'telegram', 'security', 'twofa', 'password', 'verify_email', 'support'] },
];

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('faq.title'), description: t('faq.desc'), alternates: langAlternates('/faq', lang) };
}

export default async function Faq() {
  const t = await getT();
  const lang = await getLang();
  const en = new Map(faqList().map((e) => [e.id, e.q]));
  // The live minimum deposit; if it cannot be read the answer falls back to the built-in one.
  const ctx = await minDeposit().then((n) => ({ minDeposit: n }), () => ({}));

  const groups = GROUPS.map((g) => ({
    h: t(g.h),
    items: g.ids.flatMap((id) => {
      const vars = faqVars(id, ctx);
      if (lang === 'en') {
        const a = faqAnswer(id, ctx);
        return a && en.has(id) ? [{ id, q: en.get(id), a }] : [];
      }
      const q = faqTr(lang, `${id}.q`);
      const a = faqTr(lang, `${id}.a`, vars);
      return q && a ? [{ id, q, a }] : [];
    }),
  })).filter((g) => g.items.length);

  const all = groups.flatMap((g) => g.items);

  return (
    <section id="auth">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            inLanguage: lang,
            mainEntity: all.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
          }).replace(/</g, '\\u003c'),
        }}
      />
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('faq.title')}</h1>
        <p className="mute">{t('faq.intro')}</p>
        {groups.map((g) => (
          <div key={g.h}>
            <h2 style={h2}>{g.h}</h2>
            {g.items.map((x) => (
              <div key={x.id}>
                <h3 style={h3}>{x.q}</h3>
                <p className="mute">{x.a}</p>
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
