'use client';
import { useState } from 'react';
import { plans } from '@/lib/data';
import { useToast } from '@/components/Toast';

export default function Plans() {
  const [sel, setSel] = useState(null);
  const [toast, show] = useToast();

  // TODO: call your checkout API here.
  function pay() {
    show(`${sel.name} plan purchased`);
    setSel(null);
  }

  return (
    <>
      <div className="top"><h2>Hash power plans</h2></div>
      <p className="mute lead">Pick a contract. Earnings start within an hour of payment.</p>
      <div className="plans">
        {plans.map((p) => (
          <div key={p.id} className={`card plan ${p.featured ? 'feat' : ''}`}>
            {p.featured && <span className="tag">Most chosen</span>}
            <h3>{p.name}</h3>
            <div className="price">${p.price.toLocaleString()}</div>
            <ul>
              <li><span>Hash power</span><span>{p.th} TH/s</span></li>
              <li><span>Duration</span><span>{p.days} days</span></li>
              <li><span>Estimated per day</span><span>~{p.daily}</span></li>
            </ul>
            <button className={`btn ${p.featured ? '' : 'ghost'}`} onClick={() => setSel(p)}>Buy {p.name}</button>
          </div>
        ))}
      </div>

      {sel && (
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="st">
          <div className="card">
            <h3 id="st">Confirm {sel.name} plan</h3>
            <div className="sheetbody">
              <div className="row"><span className="mute">Hash power</span><b>{sel.th} TH/s</b></div>
              <div className="row"><span className="mute">Duration</span><b>{sel.days} days</b></div>
              <div className="row"><span className="mute">Total</span><b>${sel.price.toLocaleString()}</b></div>
            </div>
            <button className="btn" autoFocus onClick={pay}>Pay now</button>
            <button className="swap" onClick={() => setSel(null)}>Cancel</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
