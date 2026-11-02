import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { getLive } from '@/lib/server/market';
import { NETWORK_MOCK as MOCK, minersText } from '@/lib/status-mock';
import { minersRunning } from '@/lib/server/network-stats';

// The first two cards are REAL: Bitcoin network difficulty from the live market (lib/server/market.js) and the hash power
// that follows from it. With no live reading they show a dash, never a made-up number.
// MOCK FIGURES: miners, paid, last payout and uptime come from lib/status-mock.js (shared with the dashboard). Replace them with
// real numbers before launch, then drop `robots` below.
const ROWS = ['net', 'diff', 'miners', 'paid', 'last', 'up'];
const DASH = '\u2014';

const card = { border: '1px solid rgba(232, 184, 74, 0.3)', borderRadius: '12px', padding: '12px' };
const num = { fontSize: '20px', fontWeight: 700, margin: '0 0 2px' };

// Network hash power in EH/s: difficulty x 2^32 hashes per block, one block every 600 s.
const hashText = (d) => `${Math.round((d * 2 ** 32) / 600 / 1e18).toLocaleString('en-US')} EH/s`;
const diffText = (d) => `${(d / 1e12).toFixed(2)} T`;

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('status.title'), description: t('status.intro'), alternates: langAlternates('/status', lang), robots: { index: false } };
}

export default async function Status() {
  const t = await getT();
  let d = null;
  try {
    d = (await getLive())?.difficulty ?? null;
  } catch {}
  const values = { ...MOCK, miners: minersText(await minersRunning()), net: d ? hashText(d) : DASH, diff: d ? diffText(d) : DASH };
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('status.title')}</h1>
        <p className="mute">{t('status.intro')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginTop: '16px' }}>
          {ROWS.map((k) => (
            <div key={k} style={card}>
              <p style={num}>{values[k]}</p>
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
