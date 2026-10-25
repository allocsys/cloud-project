'use client';
import BackLink from '@/components/BackLink';
import { useT } from '@/components/I18nProvider';
import { halls as defaultHalls, MIN_WITHDRAW, MIN_WITHDRAW_USD } from '@/lib/data';
import { ASSETS, NETWORKS, SWAP_FEE_PCT } from '@/lib/assets';
import { hallRates, MAINT_PER_TH_DAY } from '@/lib/fees';
import { SMART } from '@/lib/smart';
import { REFUND_HOURS, UP_RATIO, SERVICE_TIERS } from '@/lib/rules';
import { useApi } from '@/lib/api';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };
const row = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', fontSize: '13.5px' };

// Terms: what you pay and how a plan works. Fee numbers are read from the same data the app uses.
export default function Terms() {
  const t = useT();
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const halls = cat?.halls || defaultHalls;
  const hallList = Object.values(halls).map((h) => ({ h, r: hallRates(h) })).filter((x) => x.r);
  const coinRows = Object.entries(ASSETS).flatMap(([, a]) => Object.entries(a.nets).map(([net, fee]) => ({ k: `${a.sym}-${net}`, label: t('terms.coinOn', { sym: a.sym, net: NETWORKS[net].short }), fee: `${fee} ${a.sym}` })));
  const pct = SERVICE_TIERS.map((x) => `${x.pct}%`);

  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('terms.title')}</h1>
        <p className="mute">{t('terms.intro')}</p>

        <h2 style={h2}>{t('terms.h1')}</h2>
        <p className="mute">{t('terms.p1a')}</p>
        <p className="mute">{t('terms.p1b')}</p>

        <h2 style={h2}>{t('terms.h2')}</h2>
        <p className="mute">{t('terms.p2a')}</p>
        <div>
          {hallList.map(({ h, r }) => (
            <div key={h.name} style={row}>
              <span>{h.name}</span>
              <span style={{ textAlign: 'end' }}>
                {t('terms.elec')} ${r.elec.toFixed(4)}
                <br />
                {t('terms.maint')} ${MAINT_PER_TH_DAY.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
        <p className="fine">{t('terms.fine2')}</p>
        <p className="mute">{t('terms.p2b')}</p>

        <h2 style={h2}>{t('terms.h3')}</h2>
        <p className="mute">{t('terms.p3a')}</p>
        <p className="mute">{t('terms.p3b', { hours: REFUND_HOURS })}</p>
        <p className="mute">{t('terms.p3c')}</p>
        <p className="mute">{t('terms.p3d')}</p>
        <p className="mute">{t('terms.p3e')}</p>

        <h2 style={h2}>{t('terms.h4')}</h2>
        <p className="mute">{t('terms.p4a', { swap: SWAP_FEE_PCT, minUsd: MIN_WITHDRAW_USD })}</p>
        <div>
          {coinRows.map((c) => (
            <div key={c.k} style={row}>
              <span>{c.label}</span>
              <span>{c.fee}</span>
            </div>
          ))}
        </div>
        <p className="fine">{t('terms.fine4')}</p>
        <p className="mute">{t('terms.p4b', { a: pct[0], b: pct[1], c: pct[2] })}</p>
        <p className="mute">{t('terms.p4c')}</p>

        <h2 style={h2}>{t('terms.h5')}</h2>
        <p className="mute">{t('terms.p5a')}</p>
        <p className="mute">{t('terms.p5b')}</p>
        <p className="mute">{t('terms.p5c')}</p>
        <p className="mute">{t('terms.p5d')}</p>
        <p className="mute">{t('terms.p5e', { up: Math.round(UP_RATIO * 100) })}</p>
        <p className="mute">{t('terms.p5f', { band: +(SMART.bandShare * 100).toFixed(0), seed: +(SMART.seed * 100).toFixed(2), share: +(SMART.userShare * 100).toFixed(0) })}</p>

        <h2 style={h2}>{t('terms.h6')}</h2>
        <p className="mute">{t('terms.p6')}</p>

        <h2 style={h2}>{t('terms.h7')}</h2>
        <p className="mute">{t('terms.p7a')}</p>
        <p className="mute">{t('terms.p7b', { minBtc: MIN_WITHDRAW })}</p>

        <h2 style={h2}>{t('terms.h8')}</h2>
        <p className="mute">{t('terms.p8')}</p>

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
