'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { plans, halls, contracts } from '@/lib/data';
import { makeContract, formatSerial, serialNumber } from '@/lib/contracts';
import { useApi, post, revalidate } from '@/lib/api';
import RigArt, { rigFor } from '@/components/RigArt';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill, useSheetBack } from '@/lib/nav';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// Used only until the server answers the first time.
const seedMiners = { contracts, nextSerial: formatSerial(Math.max(...contracts.map((c) => serialNumber(c.serial))) + 1) };

export default function Plans() {
  // Catalogue and miners come from the cached API: instant from cache, refreshed quietly.
  const { data: cat } = useApi('/api/plans', { ttl: 300000 });
  const { data: md, mutate, refresh } = useApi('/api/miners', { ttl: 10000 });
  const planList = cat ? cat.plans : plans;
  const hallMap = cat ? cat.halls : halls;
  const list = md ? md.contracts : contracts;
  const nextId = md ? md.nextSerial : seedMiners.nextSerial;

  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('buy');
  const [dragY, setDragY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const startY = useRef(null);
  const hall = sel ? hallMap[sel.hall] : null;

  function selectPlan(p) {
    triggerHaptic('selection');
    openerRef.current = document.activeElement;
    setSel(p);
  }

  // Close the sheet and give focus back to the tile that opened it.
  function dismiss() {
    setSel(null);
    setDragY(0);
    startY.current = null;
    const el = openerRef.current;
    if (el && el.focus) el.focus();
  }

  function closeModal() {
    triggerHaptic('light');
    dismiss();
  }

  // Shows the new miner at once, then lets the server confirm. If it says no, the list rolls back.
  async function pay() {
    if (busy) return;
    const plan = sel;
    const base = md || seedMiners;
    setBusy(true);
    mutate({
      contracts: [...base.contracts, makeContract(plan, base.nextSerial)],
      nextSerial: formatSerial(serialNumber(base.nextSerial) + 1),
    });
    triggerHaptic('success');
    show(`${plan.name} plan activated`);
    dismiss();
    try {
      await post('/api/plans/buy', { planId: plan.id }, uid());
    } catch (e) {
      mutate(base);
      triggerHaptic('error');
      show(e.status ? e.message : 'No connection. Try again.');
    } finally {
      setBusy(false);
      refresh().catch(() => {});
      revalidate('/api/wallet').catch(() => {});
    }
  }

  useSheetBack(!!sel, dismiss);

  // Coming back from a miner page: reopen on the My miners tab.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('opus-plans-tab') === 'mine') {
        sessionStorage.removeItem('opus-plans-tab');
        setTab('mine');
      }
    } catch {}
  }, []);

  function openMiner() {
    try {
      sessionStorage.setItem('opus-plans-tab', 'mine');
    } catch {}
    markDrill();
  }

  // While the sheet is open: Escape closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      } else if (e.key === 'Tab') {
        const f = sheetRef.current ? sheetRef.current.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])') : [];
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [sel]);

  return (
    <>
      <div className="top">
        <h2>Plans</h2>
      </div>

      <div className="tabs" role="group" aria-label="Buy plans or your miners">
        <button aria-pressed={tab === 'buy'} onClick={() => setTab('buy')}>Buy plans</button>
        <button aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>My miners · {list.length}</button>
      </div>

      {tab === 'buy' ? (
      <div className="tiles">
        {planList.map((p) => {
          const a = rigFor(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`card tile ${p.featured ? 'feat' : ''}`}
              onClick={() => selectPlan(p)}
              aria-label={`${p.name}, ${p.th} terahash, $${p.price}`}
            >
              {p.featured && <span className="tag">Most chosen</span>}
              <RigArt units={a.units} speed={a.speed} id={p.id} />
              <div className="tname">{p.name}<span>{p.th} TH/s</span></div>
              <div className="tprice">${p.price.toLocaleString()}</div>
              <div className="tmeta">{p.days} days · <b>~{p.daily}</b>/day</div>
            </button>
          );
        })}
      </div>
      ) : list.length ? (
        <div className="clist">
          {list.map((c) => {
            const pct = Math.round((c.elapsed / c.days) * 100);
            const rig = rigFor(c.plan);
            return (
              <Link key={c.serial} href={`/miners/${c.serial}`} onClick={openMiner} className="card cl">
                <div className="mrow">
                  <RigArt units={rig.units} speed={rig.speed} id={c.serial} />
                  <div className="mi">
                    <div className="mt">
                      <i className={`sdot${c.online ? '' : ' off'}`} />
                      <b>{c.plan}</b>
                      <svg className="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <span className="serial">{c.serial}</span>
                    <div className="mchips">
                      <span>{c.th} TH/s</span>
                      <span>{hallMap[c.hall].efficiency}</span>
                      <span className="up">+${c.dailyUsd.toFixed(2)}/day</span>
                    </div>
                  </div>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="cmeta">
                  <span>Day {c.elapsed}/{c.days}</span>
                  <span>Ends {c.ends}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <p className="empty">No miners yet.</p>
          <button className="swap" onClick={() => setTab('buy')}>Buy a plan</button>
        </div>
      )}

      {sel && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="st"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="card"
            ref={sheetRef}
            style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
            onTouchStart={(e) => {
              startY.current = e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              if (startY.current === null) return;
              setDragY(Math.max(0, e.touches[0].clientY - startY.current));
            }}
            onTouchEnd={() => {
              if (dragY > 90) closeModal();
              else setDragY(0);
              startY.current = null;
            }}
          >
            <div className="grab" aria-hidden="true" />
            <h3 id="st">{sel.name} plan</h3>
            <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>{sel.blurb}</p>
            <div className="sheetbody">
              <div className="row">
                <span className="mute">Hall</span>
                <b>{hall.name}</b>
              </div>
              <div className="row">
                <span className="mute">Power</span>
                <b>{hall.power} · {hall.efficiency}</b>
              </div>
              <div className="row">
                <span className="mute">Miner ID</span>
                <b className="serial">{nextId}</b>
              </div>
              <div className="row" style={{ borderTop: '1px solid rgba(233, 196, 106, 0.25)' }}>
                <span className="mute" style={{ fontWeight: 600 }}>Total due</span>
                <b style={{ color: 'var(--gold2)', fontSize: '20px' }}>${sel.price.toLocaleString()}</b>
              </div>
            </div>
            <button className="btn" autoFocus onClick={pay} disabled={busy}>Confirm &amp; Pay</button>
            <button className="swap" type="button" onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
