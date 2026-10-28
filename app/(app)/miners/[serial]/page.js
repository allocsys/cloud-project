'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { contracts, halls } from '@/lib/data';
import { formatBtc, formatUsd } from '@/lib/useMined';
import { post, useApi } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import RigArt, { rigFor } from '@/components/RigArt';
import { drillBack } from '@/lib/nav';
import { bonusText } from '@/lib/first-bonus';
import Spark from '@/components/Spark';
import { useT } from '@/components/I18nProvider';

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

function Back({ title }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="tl">
      <Link
        href="/plans"
        className="back"
        aria-label={t('min.back')}
        onClick={(e) => {
          e.preventDefault();
          drillBack(router, '/plans');
        }}
      >
        {chev}
      </Link>
      <h2>{title}</h2>
    </div>
  );
}

export default function ContractPage() {
  const { serial } = useParams();
  const t = useT();
  const [all, setAll] = useState(false);
  const { data: md, mutate: mutateMiners } = useApi('/api/miners', { ttl: 10000 });
  const [toast, show] = useToast();
  const [renewBusy, setRenewBusy] = useState(false);
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const c = (md ? md.contracts : contracts).find((x) => x.serial === serial);
  // The finished payout days and what they came to in BTC, from the server (each day at its own market).
  const { data: det } = useApi(`/api/miners/${encodeURIComponent(serial)}`, { ttl: 10000 });

  if (!c) {
    if (!md) return <div className="top"><Back title={t('min.miner')} /></div>; // still loading: say nothing yet
    return (
      <>
        <div className="top"><Back title={t('min.miner')} /></div>
        <div className="card"><p className="empty">{t('min.notFound')}</p></div>
      </>
    );
  }

  // "Renew at term end": the switch moves at once; if saving fails it goes back and says so.
  async function flipRenew() {
    if (renewBusy || !md) return;
    triggerHaptic('selection');
    const next = !c.renew;
    const was = md;
    setRenewBusy(true);
    mutateMiners({ ...md, contracts: md.contracts.map((x) => (x.serial === serial ? { ...x, renew: next } : x)) });
    try {
      await post(`/api/miners/${encodeURIComponent(serial)}`, { renew: next });
    } catch (err) {
      triggerHaptic('error');
      mutateMiners(was);
      show(err.status ? err.message : t('common.noConnection'));
    } finally {
      setRenewBusy(false);
    }
  }

  const hall = (cat && cat.halls[c.hall]) || halls[c.hall];
  const rig = rigFor(c);
  // Plan names that have a translated tier name show it; any other name stays as it is.
  const planLabel = (n) => {
    const k = `tier.${String(n).toLowerCase()}`;
    const v = t(k);
    return v === k ? n : v;
  };
  const sc = det?.contract?.coins; // Smart Mining: { today, history }
  const machine = det?.contract?.machine; // Smart Mining: { coin, hall, unit, rate }, what it runs on today
  const daily = det?.contract?.daily || [];
  const ch = det?.contract?.charts; // hashrate and uptime, from the server (real samples, or mock while the admin has that on)
  const total = det?.contract?.earnedUsd ?? 0;
  const avg = daily.length ? total / daily.length : 0;
  const pct = Math.round((c.elapsed / c.days) * 100);
  const bars = daily.slice(0, 14).reverse();
  const max = Math.max(...bars.map((d) => d.usd));
  const min = Math.min(...bars.map((d) => d.usd));

  return (
    <>
      <div className="top">
        <Back title={c.smart ? t('dash.smart') : t('min.title', { name: planLabel(c.plan) })} />
        <span className={`badge ${c.online && !c.paused ? 'ok' : 'warn'}`}>{!c.online ? t('dash.offline') : c.paused ? t('plans.pausedToday') : t('dash.online')}</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id={c.serial} />
          <span className="mute eyebrow">{t('min.earned', { serial: c.serial })}</span>
          <div className="big"><span>${formatUsd(total)}</span></div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ {formatBtc(det?.contract?.earnedBtc ?? 0)} BTC</span>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="cmeta">
            <span>{t('dash.dayOf', { d: c.elapsed, n: c.days })}</span>
            <span>{t('plans.ends', { x: c.ends })}</span>
          </div>
          {c.extendedDays > 0 && <span className="mute" style={{ fontSize: '13px' }}>{c.extendedDays === 1 ? t('min.ext1') : t('min.extN', { n: c.extendedDays })}</span>}
        </div>

        <div className="grid cols">
          <div className="card">
            <div className="cardhead">
              <h3>{t('min.daily')}</h3>
              <span className="mute">{t('min.avg', { n: formatUsd(avg) })}</span>
            </div>
            {daily.length ? (
              <>
                <div className="bars" role="img" aria-label={t('min.dailyAria', { n: bars.length })}>
                  {bars.map((d, i) => (
                    <i
                      key={d.day}
                      title={`${d.day} · $${formatUsd(d.usd)}`}
                      className={i === bars.length - 1 ? 'last' : undefined}
                      style={{ height: `${35 + ((d.usd - min) / (max - min || 1)) * 65}%` }}
                    />
                  ))}
                </div>
                <div className="chartlabels">
                  <span>{bars[0].day}</span>
                  <span className="now">{bars[bars.length - 1].day}</span>
                </div>
                {(all ? daily : daily.slice(0, 5)).map((d) => (
                  <div key={d.day} className="row">
                    <div>{d.paused ? t('min.pausedDay') : t('min.payoutDay')}<small>{d.day}</small></div>
                    {d.paused ? <b className="mute">{t('min.paused')}</b> : <b className="up">+${formatUsd(d.usd)}</b>}
                  </div>
                ))}
                {daily.length > 5 && (
                  <button className="swap" onClick={() => setAll((v) => !v)}>
                    {all ? t('min.showLess') : t('min.showAll', { n: daily.length })}
                  </button>
                )}
              </>
            ) : (
              <p className="empty">{det ? t('min.noPayouts') : t('common.loading')}</p>
            )}
          </div>

          {(
          <div className="card">
            <div className="cardhead">
              <h3>{t('min.uptime')}</h3>
              <span className="mute">{ch?.uptime.pct == null ? '–' : `${ch.uptime.pct.toFixed(1)}%`}</span>
            </div>
            {ch && ch.uptime.series.some((d) => d.pct !== null) ? (
              <>
                <div className="bars" role="img" aria-label={t('min.uptimeAria')}>
                  {ch.uptime.series.map((d, i) => (
                    <i
                      key={d.day}
                      title={`${d.day} · ${d.pct === null ? t('min.noData') : `${d.pct.toFixed(1)}%`}`}
                      className={i === ch.uptime.series.length - 1 ? 'last' : undefined}
                      style={{ height: `${d.pct === null ? 6 : Math.max(8, d.pct)}%`, ...(d.pct === null ? { opacity: 0.25 } : {}) }}
                    />
                  ))}
                </div>
                <div className="chartlabels">
                  <span>{ch.uptime.series[0].day}</span>
                  <span className="now">{t('min.today')}</span>
                </div>
              </>
            ) : (
              <p className="empty">{ch ? t('min.noUptime') : t('common.loading')}</p>
            )}
          </div>
          )}

          {c.smart && (
            <div className="card">
              <div className="cardhead">
                <h3>{t('min.coin')}</h3>
                <span className="mute">{sc?.today ? t('min.coinToday', { coin: sc.today }) : '–'}</span>
              </div>
              {sc?.history?.length ? (
                sc.history.map((h) => (
                  <div key={h.day} className="row">
                    <span className="mute">{h.day}</span>
                    <b className="v">{h.coin}</b>
                  </div>
                ))
              ) : (
                <p className="empty">{det ? t('min.firstCoin') : t('common.loading')}</p>
              )}
            </div>
          )}

          <div className="card">
            <h3>{t('min.details')}</h3>
            <div className="hs">
              <div>
                <span>{t('min.hash24')}</span>
                {ch?.hash.hasData ? <b>{ch.hash.now}<small>{c.smart ? machine?.unit || '' : 'TH/s'}</small></b> : <b>–</b>}
              </div>
              {ch?.hash.hasData ? <Spark values={ch.hash.series} /> : <small className="mute">{ch ? t('min.noDataYet') : t('common.loading')}</small>}
            </div>
            {c.smart ? (
              <>
                <div className="row"><span className="mute">{t('min.budget')}</span><b className="v">${formatUsd(c.budget)}</b></div>
                <div className="row"><span className="mute">{t('min.mining')}</span><b className="v">{t('min.bestChosen')}<small>{t('pc.paidBtc')}</small></b></div>
                {machine && (
                  <>
                    <div className="row"><span className="mute">{t('min.hashPower')}</span><b className="v">{machine.rate.toLocaleString('en-US', { maximumFractionDigits: 1 })} {machine.unit}<small>{t('min.coinNow', { coin: machine.coin })}</small></b></div>
                    <div className="row"><span className="mute">{t('min.hall')}</span><b className="v">{machine.hall.name}<small>{machine.hall.place}</small></b></div>
                    <div className="row"><span className="mute">{t('min.rig')}</span><b className="v">{machine.hall.rig}<small>{machine.hall.power}</small></b></div>
                    {machine.kwh > 0 && <div className="row"><span className="mute">{t('min.electricity')}</span><b className="v">{t('min.kwh', { p: machine.kwh.toFixed(2) })}</b></div>}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="row"><span className="mute">{t('min.hashPower')}</span><b className="v">{c.th} TH/s</b></div>
                <div className="row"><span className="mute">{t('min.hall')}</span><b className="v">{hall.name}<small>{hall.place}</small></b></div>
                <div className="row"><span className="mute">{t('min.rig')}</span><b className="v">{hall.rig}<small>{hall.efficiency}</small></b></div>
                <div className="row"><span className="mute">{t('min.power')}</span><b className="v">{hall.power}</b></div>
              </>
            )}
            <div className="row"><span className="mute">{t('min.term')}</span><b className="v">{c.started} – {c.ends}</b></div>
            {c.firstBonus && (
              <div className="row"><span className="mute">{t('plans.firstBonus')}</span><b className="v">{t('plans.bonusLine', { b: bonusText(c.firstBonus) })}<small>{t('plans.fullTerm')}</small></b></div>
            )}
            {c.smart && c.renewable && (
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('min.renew')}</div>
                  <small>{t('min.renewSub')}</small>
                </div>
                <button type="button" role="switch" aria-checked={!!c.renew} aria-label={t('min.renew')} className="switch" disabled={renewBusy} onClick={flipRenew}>
                  <i />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
