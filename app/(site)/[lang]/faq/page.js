import BackLink from '@/components/BackLink';
import { langFromSegment, staticLangParams, tForLang } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { faqAnswer, faqList, faqVars } from '@/lib/faq';
import { faqTr } from '@/lib/i18n/faq';
import { siteData } from '@/lib/site-api';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
// One question per row: tap to open. The answers stay in the page itself, so search engines and no-script readers still get them.
const row = { borderBottom: '1px solid rgba(128,128,128,.25)' };
const sum = { cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center', fontSize: '14.5px', fontWeight: 500, padding: '6px 0' };
const ans = { margin: '0 0 12px' };

// Only general questions that are the same for everyone. The answers are the ones the owner approved in lib/faq.js
// (read from there, never copied), so a change to an answer shows here too. Smart Mining, boost, bonus and paused-day
// answers are left off on purpose. In another language an answer shows only when that language's book has it.
const GROUPS = [
  { h: 'faq.g1', ids: ['plans', 'plan_duration', 'hardware', 'electricity', 'returns', 'btc_price', 'multi_plan', 'units'] },
  { h: 'faq.g2', ids: ['deposit', 'deposit_min', 'networks', 'pay_method', 'withdraw_how', 'withdraw_min', 'withdraw_time', 'fees', 'withdraw_fee', 'network_fee', 'refund', 'wrong_address'] },
  { h: 'faq.g3', ids: ['register', 'demo', 'telegram', 'security', 'twofa', 'password', 'verify_email', 'support'] },
];

export function generateStaticParams() {
  return staticLangParams();
}

export async function generateMetadata({ params }) {
  const lang = langFromSegment((await params)?.lang);
  const t = tForLang(lang);
  return { title: t('faq.title'), description: t('faq.desc'), alternates: langAlternates('/faq', lang) };
}

export default async function Faq({ params }) {
  const lang = langFromSegment((await params)?.lang);
  const t = tForLang(lang);
  const en = new Map(faqList().map((e) => [e.id, e.q]));
  // The live minimum deposit and withdrawal; if they cannot be read the answers fall back to the built-in numbers.
  const ctx = await siteData('/api/site/flags', {}, { revalidate: 60 });

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
              <details key={x.id} style={row}>
                <summary style={sum}>{x.q}</summary>
                <p className="mute" style={ans}>{x.a}</p>
              </details>
            ))}
          </div>
        ))}
        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
