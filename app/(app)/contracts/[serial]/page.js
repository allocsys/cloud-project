'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { contracts, halls, contractDaily, BTC_USD } from '@/lib/data';
import { formatBtc, formatUsd } from '@/lib/useMined';

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

function Back({ title }) {
  return (
    <div className="tl">
      <Link href="/plans" className="back" aria-label="Back to plans">{chev}</Link>
      <h2>{title}</h2>
    </div>
  );
}

export default function ContractPage() {
  const { serial } = useParams();
  const [all, setAll] = useState(false);
  const c = contracts.find((x) => x.serial === serial);

  if (!c) {
    return (
      <>
        <div className="top"><Back title="Contract" /></div>
        <div className="card"><p className="empty">Contract not found.</p></div>
      </>
    );
  }

  const hall = halls[c.hall];
  const daily = contractDaily(c);
  const total = daily.reduce((s, d) => s + d.usd, 0);
  const avg = daily.length ? total / daily.length : 0;
  const pct = Math.round((c.elapsed / c.days) * 100);
  const bars = daily.slice(0, 14).reverse();
  const max = Math.max(...bars.map((d) => d.usd));
  const min = Math.min(...bars.map((d) => d.usd));

  return (
    <>
      <div className="top">
        <Back title={c.plan} />
        <span className="badge ok">Active</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Earned so far · {c.serial}</span>
          <div className="big"><span>${formatUsd(total)}</span></div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ {formatBtc(total / BTC_USD)} BTC</span>
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
              <p className="empty">No payouts yet. The first one lands after 24 hours.</p>
            )}
          </div>

          <div className="card">
            <h3>Details</h3>
            <div className="row"><span className="mute">Hash power</span><b className="v">{c.th} TH/s</b></div>
            <div className="row"><span className="mute">Mining hall</span><b className="v">{hall.name}<small>{hall.place}</small></b></div>
            <div className="row"><span className="mute">Efficiency</span><b className="v">{hall.efficiency}</b></div>
            <div className="row"><span className="mute">Power</span><b className="v">{hall.power}</b></div>
            <div className="row"><span className="mute">Term</span><b className="v">{c.started} – {c.ends}</b></div>
          </div>
        </div>
      </div>
    </>
  );
}
