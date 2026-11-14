'use client';
// "Start small" on the page people see before they sign in: what the smallest purchase costs and what it is estimated to earn,
// for ASICs power (CUSTOM.min TH/s on the shortest term, priced from the live halls) and Smart Mining (SMART.min budget on
// 90 days, the range is the reserve band of the Plans card). Every figure comes from the code and the live catalogue, none is typed.
// Estimates at today's market, never promises. Until the catalogue answers the cards keep their size and show dashes.
import { useApi } from '@/lib/api';
import { CUSTOM, customPlan } from '@/lib/data';
import { SMART, smartPlan, smartBand } from '@/lib/smart';
import { useT } from '@/components/I18nProvider';

const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DASH = '\u2014';

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', margin: '12px 0 0' };
const card = { border: '1px solid rgba(232, 184, 74, 0.3)', borderRadius: '12px', padding: '12px' };
const eyebrow = { margin: '0 0 2px', fontSize: '12px', opacity: 0.75 };
const big = { margin: '0 0 4px', fontSize: '20px', fontWeight: 700 };
const small = { margin: 0, fontSize: '13px', opacity: 0.85 };

export default function StartCards() {
  const t = useT();
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });

  const th = CUSTOM.min;
  const asicDays = CUSTOM.terms[0];
  const asic = cat?.halls ? customPlan(th, asicDays, cat.halls) : null;
  const asicProfit = asic ? Math.max(0, cat.halls[asic.hall].net * th * asicDays - asic.price) : null;

  const smartDays = SMART.terms[0];
  const band = smartBand(smartPlan(SMART.min, smartDays, cat?.smartTable));
  const smartOn = cat?.smartOn !== false;

  return (
    <div>
      <div style={grid}>
        <div style={card}>
          <p style={eyebrow}>{t('start.asic.t')}</p>
          <p style={big}>{t('start.from', { min: asic ? money(asic.price) : DASH })}</p>
          <p style={small}>{t('start.asic.d', { th, d: asicDays, profit: asic ? money(asicProfit) : DASH })}</p>
        </div>
        {smartOn && (
          <div style={card}>
            <p style={eyebrow}>{t('start.smart.t')}</p>
            <p style={big}>{t('start.from', { min: money(SMART.min) })}</p>
            <p style={small}>{t('start.smart.d', { d: smartDays, low: money(band.low), high: money(band.high) })}</p>
          </div>
        )}
      </div>
      <p className="fine" style={{ margin: '8px 0 0' }}>{t('start.fine')}</p>
    </div>
  );
}
