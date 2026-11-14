import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { getLive } from '@/lib/server/market';
import { NETWORK_MOCK as MOCK, minersText } from '@/lib/status-mock';
import { minersRunning, payoutProof } from '@/lib/server/network-stats';

// The first two cards are REAL: Bitcoin network difficulty from the live market (lib/server/market.js) and the hash power
// that follows from it. With no live reading they show a dash, never a made-up number.
// MOCK FIGURES: miners, paid, last payout and uptime come from lib/status-mock.js (shared with the dashboard). Replace them with
// real numbers before launch, then drop `robots` below.
const TOP = ['net', 'diff', 'miners', 'up'];
const LINES = ['paid', 'last'];
const DASH = '\u2014';

const card = { border: '1px solid rgba(232, 184, 74, 0.3)', borderRadius: '12px', padding: '12px' };
const num = { fontSize: '20px', fontWeight: 700, margin: '0 0 2px' };
// Full-width row: label on the start side, value on the end side (same look as the latest withdrawals list).
const line = { ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' };
const lineNum = { fontSize: '16px', fontWeight: 700, margin: 0, textAlign: 'end' };

// Motion: cards rise in one by one, then a soft gold shine passes over each (transform and opacity only).
const CSS = `
.st-c{position:relative;overflow:hidden;opacity:0;animation:st-in .6s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:calc(var(--i)*70ms)}
.st-c::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 30%,rgba(232,184,74,.15) 50%,transparent 70%);transform:translateX(-120%);animation:st-shine 7s ease-in-out infinite;animation-delay:calc(var(--i)*600ms + 1s)}
@keyframes st-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes st-shine{0%,60%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
`;

// Network hash power in EH/s: difficulty x 2^32 hashes per block, one block every 600 s.
const hashText = (d) => `${Math.round((d * 2 ** 32) / 600 / 1e18).toLocaleString('en-US')} EH/s`;
const diffText = (d) => `${(d / 1e12).toFixed(2)} T`;

// "Withdrawals sent" is REAL: counted from the withdrawals an admin marked sent (payoutProof). Nothing here is typed or mocked.
const when = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const hoursText = (t, h) => (h < 1 ? t('status.proofLess') : t('status.proofHours', { n: h < 10 ? h.toFixed(1) : Math.round(h) }));

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
  const proof = await payoutProof();
  const sent = proof && proof.count > 0 ? proof : null;
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <style>{CSS}</style>
        <h1>{t('status.title')}</h1>
        <p className="mute">{t('status.intro')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginTop: '16px' }}>
          {TOP.map((k, i) => (
            <div key={k} className="st-c" style={{ ...card, '--i': i }}>
              <p style={num}><bdi dir="ltr">{values[k]}</bdi></p>
              <p className="mute" style={{ margin: 0 }}>{t(`status.${k}`)}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>
          {LINES.map((k, i) => (
            <div key={k} className="st-c" style={{ ...line, '--i': TOP.length + i }}>
              <span className="mute">{t(`status.${k}`)}</span>
              <p style={lineNum}><bdi dir="ltr">{values[k]}</bdi></p>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: '16px', margin: '22px 0 6px' }}>{t('status.proofT')}</h2>
        <p className="mute" style={{ margin: '0 0 10px' }}>{t('status.proofIntro')}</p>
        {sent ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div className="st-c" style={{ ...card, '--i': 6 }}>
                <p style={num}><bdi dir="ltr">{sent.btc.toFixed(4)} BTC</bdi></p>
                <p className="mute" style={{ margin: 0 }}>{t('status.proofTotal')}</p>
              </div>
              <div className="st-c" style={{ ...card, '--i': 7 }}>
                <p style={num}><bdi dir="ltr">{sent.count.toLocaleString('en-US')}</bdi></p>
                <p className="mute" style={{ margin: 0 }}>{t('status.proofCount')}</p>
              </div>
            </div>
            {sent.hours !== null && (
              <div className="st-c" style={{ ...line, marginTop: '10px', '--i': 8 }}>
                <span className="mute">{t('status.proofTime')}</span>
                <p style={lineNum}>{hoursText(t, sent.hours)}</p>
              </div>
            )}
            <h3 style={{ fontSize: '14px', margin: '16px 0 6px' }}>{t('status.proofLast')}</h3>
            <div style={{ display: 'grid', gap: '6px' }}>
              {sent.last.map((w, i) => (
                <div key={i} className="st-c" style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', '--i': 9 + i }}>
                  <bdi dir="ltr">{w.amount} {w.asset}</bdi>
                  <bdi className="mute" dir="ltr">{when(w.at)}</bdi>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mute">{t('status.proofNone')}</p>
        )}

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
