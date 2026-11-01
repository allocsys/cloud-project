import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';

// MOCK FIGURES: every value below is a placeholder, not read from the app. Replace each one with a real number
// (miners and payouts from the database, uptime from the health checks) before launch, then drop `robots` below.
const MOCK = { hash: '184 PH/s', miners: '3,412', paid: '12.84 BTC', last: 'Today, 00:00 UTC', up: '99.98%' };
const ROWS = ['hash', 'miners', 'paid', 'last', 'up'];

const card = { border: '1px solid rgba(232, 184, 74, 0.3)', borderRadius: '12px', padding: '12px' };
const num = { fontSize: '20px', fontWeight: 700, margin: '0 0 2px' };

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('status.title'), description: t('status.intro'), alternates: langAlternates('/status', lang), robots: { index: false } };
}

export default async function Status() {
  const t = await getT();
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('status.title')}</h1>
        <p className="mute">{t('status.intro')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginTop: '16px' }}>
          {ROWS.map((k) => (
            <div key={k} style={card}>
              <p style={num}>{MOCK[k]}</p>
              <p className="mute" style={{ margin: 0 }}>{t(`status.${k}`)}</p>
            </div>
          ))}
        </div>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
