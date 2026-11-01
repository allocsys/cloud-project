'use client';
import { useApi } from '@/lib/api';
import { useCountUp } from '@/lib/useCountUp';
import { useT } from '@/components/I18nProvider';

// The two live numbers under the headline: running miners and their total hash power (from /api/stats, refreshed each minute).
// Real numbers only. Nothing shows until there is at least one running miner.
const fmtTh = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)} PH/s` : `${Math.round(n * 10) / 10} TH/s`);

function Count({ v, f }) {
  return <>{f(useCountUp(v))}</>;
}

export default function LandingStats() {
  const t = useT();
  const { data } = useApi('/api/stats', { ttl: 60000, poll: 60000 });
  const ok = data && data.miners > 0;
  return (
    <div className="lp-stats">
      {ok && (
        <>
          <div className="lp-stat">
            <b><Count v={data.miners} f={(x) => Math.round(x).toLocaleString('en-US')} /></b>
            <span><i />{t('landing.stat.miners')}</span>
          </div>
          <div className="lp-stat">
            <b><Count v={data.th} f={fmtTh} /></b>
            <span><i />{t('landing.stat.hash')}</span>
          </div>
        </>
      )}
    </div>
  );
}
