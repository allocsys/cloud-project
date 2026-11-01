import Link from 'next/link';
import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { pagePath } from '@/lib/i18n/codes';
import { TEAM } from '@/lib/site';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const link = { color: 'var(--gold2)' };

// No real names, photos or personal links here: the team works under pseudonyms (see TEAM in lib/site.js).
const SECTIONS = ['what', 'who', 'trust'];

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('about.title'), description: t('about.desc'), alternates: langAlternates('/about', lang) };
}

export default async function About() {
  const t = await getT();
  const lang = await getLang();
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('about.title')}</h1>
        <p className="mute">{t('about.intro')}</p>

        {SECTIONS.map((k) => (
          <div key={k}>
            <h2 style={h2}>{t(`about.${k}.t`)}</h2>
            <p className="mute">{t(`about.${k}.d`)}</p>
          </div>
        ))}

        {TEAM.length > 0 && (
          <div>
            <h2 style={h2}>{t('about.team.t')}</h2>
            {TEAM.map((m) => (
              <p key={m.handle} className="mute" style={{ margin: '4px 0' }}>
                <strong>{m.handle}</strong>
                {' \u00b7 '}
                {t(`about.role.${m.role}`)}
              </p>
            ))}
          </div>
        )}

        <h2 style={h2}>{t('about.contact.t')}</h2>
        <p className="mute">{t('about.contact.d')}</p>

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
