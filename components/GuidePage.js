import Link from 'next/link';
import BackLink from '@/components/BackLink';
import GuideLinks from '@/components/GuideLinks';
import { langFromSegment, tForLang } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { pagePath } from '@/lib/i18n/codes';
import { GUIDES } from '@/lib/guides';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const link = { color: 'var(--gold2)' };

export async function guideMeta(id, params) {
  const lang = langFromSegment((await params)?.lang);
  const t = tForLang(lang);
  const g = GUIDES.find((x) => x.id === id);
  return { title: t(`gd.${id}.t`), description: t(`gd.${id}.desc`), alternates: langAlternates(g.path, lang) };
}

export default async function GuidePage({ id, params }) {
  const lang = langFromSegment((await params)?.lang);
  const t = tForLang(lang);
  const g = GUIDES.find((x) => x.id === id);
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t(`gd.${id}.t`)}</h1>

        {g.parts.map((p) =>
          p === 'd' ? (
            <p key={p} className="mute">{t(`gd.${id}.d`)}</p>
          ) : (
            <div key={p}>
              <h2 style={h2}>{t(`gd.${id}.${p}.t`)}</h2>
              <p className="mute">{t(`gd.${id}.${p}.d`)}</p>
            </div>
          ),
        )}

        <h2 style={h2}>{t('gd.more')}</h2>
        <GuideLinks t={t} lang={lang} skip={id} />

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
