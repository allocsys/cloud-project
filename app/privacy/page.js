import BackLink from '@/components/BackLink';
import { getT } from '@/lib/i18n/server';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };

export async function generateMetadata() {
  const t = await getT();
  return { title: t('privacy.title') };
}

// Written from what the app really does today. If the app starts keeping ID photos, adds analytics or another
// provider, change this page in the same commit.
export default async function Privacy() {
  const t = await getT();
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('privacy.title')}</h1>
        <p className="mute">{t('privacy.intro')}</p>

        <h2 style={h2}>{t('privacy.h1')}</h2>
        <p className="mute"><b>{t('privacy.l1a')}</b> {t('privacy.p1a')}</p>
        <p className="mute"><b>{t('privacy.l1b')}</b> {t('privacy.p1b')}</p>
        <p className="mute"><b>{t('privacy.l1c')}</b> {t('privacy.p1c')}</p>
        <p className="mute"><b>{t('privacy.l1d')}</b> {t('privacy.p1d')}</p>
        <p className="mute"><b>{t('privacy.l1e')}</b> {t('privacy.p1e')}</p>

        <h2 style={h2}>{t('privacy.h2')}</h2>
        <p className="mute">{t('privacy.p2')}</p>

        <h2 style={h2}>{t('privacy.h3')}</h2>
        <p className="mute">{t('privacy.p3a')}</p>
        <p className="mute">{t('privacy.p3b')}</p>

        <h2 style={h2}>{t('privacy.h4')}</h2>
        <p className="mute">{t('privacy.p4')}</p>

        <h2 style={h2}>{t('privacy.h5')}</h2>
        <p className="mute">{t('privacy.p5')}</p>

        <h2 style={h2}>{t('privacy.h6')}</h2>
        <p className="mute">{t('privacy.p6')}</p>

        <h2 style={h2}>{t('privacy.h7')}</h2>
        <p className="mute">{t('privacy.p7')}</p>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
