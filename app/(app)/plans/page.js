'use client';
import { useState } from 'react';
import { plans, halls, contracts } from '@/lib/data';
import RigArt from '@/components/RigArt';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

// More rack units and faster fans for bigger plans.
const ART = {
  starter: { units: 1, speed: 2.2 },
  growth: { units: 2, speed: 1.5 },
  pro: { units: 3, speed: 0.9 },
};

// Placeholder: your backend assigns the real serial at checkout.
const nextSerial = () => {
  const n = Math.max(...contracts.map((c) => parseInt(c.serial.slice(3), 10)));
  return `OP-${String(n + 1).padStart(7, '0')}`;
};

export default function Plans() {
  const [sel, setSel] = useState(null);
  const [toast, show] = useToast();
  const hall = sel ? halls[sel.hall] : null;

  function selectPlan(p) {
    triggerHaptic('selection');
    setSel(p);
  }

  function closeModal() {
    triggerHaptic('light');
    setSel(null);
  }

  // TODO: call your checkout API here.
  function pay() {
    triggerHaptic('success');
    show(`${sel.name} plan activated`);
    setSel(null);
  }

  return (
    <>
      <div className="top">
        <h2>Plans</h2>
      </div>

      <div className="tiles">
        {plans.map((p, i) => {
          const a = ART[p.id] || ART.starter;
          return (
            <button
              key={p.id}
              type="button"
              className={`card tile ${p.featured ? 'feat' : ''}`}
              style={{ animationDelay: `${0.05 + i * 0.08}s` }}
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
          <div className="card">
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
                <span className="mute">Contract</span>
                <b className="serial">{nextSerial()}</b>
              </div>
              <div className="row" style={{ borderTop: '1px solid rgba(212, 168, 75, 0.25)' }}>
                <span className="mute" style={{ fontWeight: 600 }}>Total due</span>
                <b style={{ color: 'var(--gold2)', fontSize: '20px' }}>${sel.price.toLocaleString()}</b>
              </div>
            </div>
            <button className="btn" autoFocus onClick={pay}>Confirm &amp; Pay</button>
            <button className="swap" type="button" onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
