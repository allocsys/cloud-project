import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { pagePath } from '@/lib/i18n/codes';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const link = { color: 'var(--gold2)' };

// The wording was approved by the owner on 30 Oct 2026. It has no typed numbers: payout time and fees are shown in the app.
const STEPS = ['s1', 's2', 's3', 's4', 's5'];

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('how.title'), description: t('how.desc'), alternates: langAlternates('/how-it-works', lang) };
}

export default async function HowItWorks() {
  const t = await getT();
  const lang = await getLang();
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('how.title')}</h1>
        <p className="mute">{t('how.intro')}</p>

        {STEPS.map((s, i) => (
          <div key={s}>
            <h2 style={h2}>{i + 1}. {t(`how.${s}.t`)}</h2>
            <p className="mute">{t(`how.${s}.d`)}</p>
          </div>
        ))}

        <h2 style={h2}>{t('how.risk.t')}</h2>
        <p className="mute">{t('how.risk.d')}</p>

        <p className="mute" style={{ marginTop: '18px' }}>
          <Link href={pagePath('/faq', lang)} style={link}>{t('faq.link')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/terms', lang)} style={link}>{t('auth.terms')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/privacy', lang)} style={link}>{t('auth.privacy')}</Link>
        </p>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
