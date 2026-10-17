'use client';
import { useState } from 'react';
import { plans, halls, contracts } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

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
        <h2>Hash power plans</h2>
      </div>
      <p className="mute lead">Pick a contract. Mining begins within 60 minutes of confirmation.</p>

      <div className="plans">
        {plans.map((p) => {
          const h = halls[p.hall];
          return (
            <div key={p.id} className={`card plan ${p.featured ? 'feat' : ''}`}>
              {p.featured && <span className="tag">Most chosen</span>}
              <h3>{p.name}</h3>
              <div className="price">${p.price.toLocaleString()}</div>
              <p className="blurb">{p.blurb}</p>
              <div className="hall">
                <b>{h.name}</b>
                <span>{h.place} · {h.power}</span>
              </div>
              <ul>
                <li><span>Hash power</span><span>{p.th} TH/s</span></li>
                <li><span>Duration</span><span>{p.days} days</span></li>
                <li><span>Efficiency</span><span>{h.efficiency}</span></li>
                <li><span>Estimated per day</span><span className="up">~{p.daily}</span></li>
              </ul>
              <button className={`btn ${p.featured ? '' : 'ghost'}`} onClick={() => selectPlan(p)}>
                Start {p.name}
              </button>
            </div>
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
            <h3 id="st">Confirm {sel.name} plan</h3>
            <p className="mute" style={{ fontSize: '13px', margin: '4px 0 12px' }}>
              Your mining contract is provisioned automatically.
            </p>
            <div className="sheetbody">
              <div className="row">
                <span className="mute">Contract</span>
                <b className="serial">{nextSerial()}</b>
              </div>
              <div className="row">
                <span className="mute">Hall</span>
                <b>{hall.name}</b>
              </div>
              <div className="row">
                <span className="mute">Hash power</span>
                <b>{sel.th} TH/s</b>
              </div>
              <div className="row">
                <span className="mute">Duration</span>
                <b>{sel.days} days</b>
              </div>
              <div className="row">
                <span className="mute">Est. daily output</span>
                <b className="up">~{sel.daily}</b>
              </div>
              <div className="row" style={{ borderTop: '1px solid rgba(212, 168, 75, 0.25)', paddingTop: '12px' }}>
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
