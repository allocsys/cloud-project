import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { pagePath } from '@/lib/i18n/codes';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const link = { color: 'var(--gold2)' };

// The wording was approved by the owner on 30 Oct 2026. No typed income, payout or fee figures.
const TERMS = ['hash', 'rate', 'diff', 'risk'];

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('glo.title'), description: t('glo.desc'), alternates: langAlternates('/glossary', lang) };
}

export default async function Glossary() {
  const t = await getT();
  const lang = await getLang();
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('glo.title')}</h1>
        <p className="mute">{t('glo.intro')}</p>

        {TERMS.map((k) => (
          <div key={k}>
            <h2 style={h2}>{t(`glo.${k}.t`)}</h2>
            <p className="mute">{t(`glo.${k}.d`)}</p>
          </div>
        ))}

        <p className="mute" style={{ marginTop: '18px' }}>
          <Link href={pagePath('/how-it-works', lang)} style={link}>{t('how.link')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/faq', lang)} style={link}>{t('faq.link')}</Link>
        </p>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
