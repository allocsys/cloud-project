'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { contracts, halls } from '@/lib/data';
import { formatBtc, formatUsd } from '@/lib/useMined';
import { useApi } from '@/lib/api';
import RigArt, { rigFor } from '@/components/RigArt';
import { drillBack } from '@/lib/nav';
import Spark from '@/components/Spark';

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

function Back({ title }) {
  const router = useRouter();
  return (
    <div className="tl">
      <Link
        href="/plans"
        className="back"
        aria-label="Back to plans"
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
  const [all, setAll] = useState(false);
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const c = (md ? md.contracts : contracts).find((x) => x.serial === serial);
  // The finished payout days and what they came to in BTC, from the server (each day at its own market).
  const { data: det } = useApi(`/api/miners/${encodeURIComponent(serial)}`, { ttl: 10000 });

  if (!c) {
    return (
      <>
        <div className="top"><Back title="Miner" /></div>
        <div className="card"><p className="empty">Miner not found.</p></div>
      </>
    );
  }

  const hall = (cat && cat.halls[c.hall]) || halls[c.hall];
  const rig = rigFor(c);
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
        <Back title={c.smart ? 'Smart Mining' : `${c.plan} miner`} />
        <span className={`badge ${c.online ? 'ok' : 'warn'}`}>{c.online ? 'Online' : 'Offline'}</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id={c.serial} />
          <span className="mute eyebrow">Earned so far · {c.serial}</span>
          <div className="big"><span>${formatUsd(total)}</span></div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ {formatBtc(det?.contract?.earnedBtc ?? 0)} BTC</span>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="cmeta">
            <span>Day {c.elapsed} of {c.days}</span>
            <span>Ends {c.ends}</span>
          </div>
        </div>

        <div className="grid cols">
          <div className="card">
            <div className="cardhead">
              <h3>Daily earnings</h3>
              <span className="mute">avg ${formatUsd(avg)}/day</span>
            </div>
            {daily.length ? (
              <>
                <div className="bars" role="img" aria-label={`Daily earnings for the last ${bars.length} days`}>
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
                    <div>Daily payout<small>{d.day}</small></div>
                    <b className="up">+${formatUsd(d.usd)}</b>
                  </div>
                ))}
                {daily.length > 5 && (
                  <button className="swap" onClick={() => setAll((v) => !v)}>
                    {all ? 'Show less' : `Show all ${daily.length} days`}
                  </button>
                )}
              </>
            ) : (
              <p className="empty">{det ? 'No payouts yet. The first one lands after 24 hours.' : 'Loading…'}</p>
            )}
          </div>

          {(
          <div className="card">
            <div className="cardhead">
              <h3>Uptime · 7 days</h3>
              <span className="mute">{ch?.uptime.pct == null ? '–' : `${ch.uptime.pct.toFixed(1)}%`}</span>
            </div>
            {ch && ch.uptime.series.some((d) => d.pct !== null) ? (
              <>
                <div className="bars" role="img" aria-label="Uptime for each of the last 7 days">
                  {ch.uptime.series.map((d, i) => (
                    <i
                      key={d.day}
                      title={`${d.day} · ${d.pct === null ? 'no data' : `${d.pct.toFixed(1)}%`}`}
                      className={i === ch.uptime.series.length - 1 ? 'last' : undefined}
                      style={{ height: `${d.pct === null ? 6 : Math.max(8, d.pct)}%`, ...(d.pct === null ? { opacity: 0.25 } : {}) }}
                    />
                  ))}
                </div>
                <div className="chartlabels">
                  <span>{ch.uptime.series[0].day}</span>
                  <span className="now">Today</span>
                </div>
              </>
            ) : (
              <p className="empty">{ch ? 'No uptime data yet.' : 'Loading…'}</p>
            )}
          </div>
          )}

          {c.smart && (
            <div className="card">
              <div className="cardhead">
                <h3>Mining coin</h3>
                <span className="mute">{sc?.today ? `Today ${sc.today}` : '–'}</span>
              </div>
              {sc?.history?.length ? (
                sc.history.map((h) => (
                  <div key={h.day} className="row">
                    <span className="mute">{h.day}</span>
                    <b className="v">{h.coin}</b>
                  </div>
                ))
              ) : (
                <p className="empty">{det ? 'The first coin is recorded after the first full day.' : 'Loading…'}</p>
              )}
            </div>
          )}

          <div className="card">
            <h3>Details</h3>
            <div className="hs">
              <div>
                <span>Hashrate · 24h</span>
                {ch?.hash.hasData ? <b>{ch.hash.now}<small>{c.smart ? machine?.unit || '' : 'TH/s'}</small></b> : <b>–</b>}
              </div>
              {ch?.hash.hasData ? <Spark values={ch.hash.series} /> : <small className="mute">{ch ? 'No data yet' : 'Loading…'}</small>}
            </div>
            {c.smart ? (
              <>
                <div className="row"><span className="mute">Budget</span><b className="v">${formatUsd(c.budget)}</b></div>
                <div className="row"><span className="mute">Mining</span><b className="v">Best coin, chosen daily<small>Paid in BTC</small></b></div>
                {machine && (
                  <>
                    <div className="row"><span className="mute">Hash power</span><b className="v">{machine.rate.toLocaleString('en-US', { maximumFractionDigits: 1 })} {machine.unit}<small>{machine.coin} today</small></b></div>
                    <div className="row"><span className="mute">Mining hall</span><b className="v">{machine.hall.name}<small>{machine.hall.place}</small></b></div>
                    <div className="row"><span className="mute">Rig</span><b className="v">{machine.hall.rig}<small>{machine.hall.power}</small></b></div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="row"><span className="mute">Hash power</span><b className="v">{c.th} TH/s</b></div>
                <div className="row"><span className="mute">Mining hall</span><b className="v">{hall.name}<small>{hall.place}</small></b></div>
                <div className="row"><span className="mute">Rig</span><b className="v">{hall.rig}<small>{hall.efficiency}</small></b></div>
                <div className="row"><span className="mute">Power</span><b className="v">{hall.power}</b></div>
              </>
            )}
            <div className="row"><span className="mute">Term</span><b className="v">{c.started} – {c.ends}</b></div>
          </div>
        </div>
      </div>
    </>
  );
}
