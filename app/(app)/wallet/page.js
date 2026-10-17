'use client';
import { useMemo, useState } from 'react';
import { useMined, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { history as seed, DEPOSIT_ADDRESS, MIN_WITHDRAW } from '@/lib/data';
import { qrMatrix, qrPath } from '@/lib/qr';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  withdrawal: { glyph: '↑', cls: 'out' },
};

function DepositQr({ value }) {
  const qr = useMemo(() => {
    try {
      const m = qrMatrix(value);
      return { size: m.length, d: qrPath(m) };
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return null;
  const pad = 3;
  const box = qr.size + pad * 2;
  return (
    <div className="qr">
      <svg viewBox={`${-pad} ${-pad} ${box} ${box}`} role="img" aria-label="Deposit address QR code" shapeRendering="crispEdges">
        <rect x={-pad} y={-pad} width={box} height={box} fill="#fff" />
        <path d={qr.d} fill="#0b0a08" />
      </svg>
    </div>
  );
}

export default function Wallet() {
  const mined = useMined();
  const [withdrawn, setWithdrawn] = useState(0);
  const [tab, setTab] = useState('withdraw');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState({});
  const [history, setHistory] = useState(seed);
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  const available = Math.max(0, mined - withdrawn);

  function setFraction(pct) {
    triggerHaptic('selection');
    setAmount((available * pct).toFixed(8));
    setErrors({ ...errors, amount: undefined });
  }

  function handleTabChange(nextTab) {
    if (tab !== nextTab) {
      triggerHaptic('selection');
      setTab(nextTab);
      setErrors({});
    }
  }

  // TODO: call your withdrawal API here.
  function withdraw() {
    const a = parseFloat(amount);
    const next = {};
    if (!(a > 0)) next.amount = 'Enter an amount to withdraw.';
    else if (a < MIN_WITHDRAW) next.amount = `Minimum is ${MIN_WITHDRAW} BTC.`;
    else if (a > available) next.amount = 'More than your available balance.';
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,60}$/.test(address.trim())) next.address = 'Enter a valid Bitcoin address.';

    if (next.amount || next.address) {
      triggerHaptic('error');
      setErrors(next);
      const el = document.getElementById(next.amount ? 'wa' : 'wd');
      if (el) el.focus();
      return;
    }

    triggerHaptic('success');
    setErrors({});
    setWithdrawn(withdrawn + a);
    setHistory([{ kind: 'withdrawal', label: 'Withdrawal', date: 'Just now', amount: `-${a.toFixed(4)}` }, ...history]);
    setAmount('');
    setAddress('');
    show('Withdrawal initiated');
  }

  function copy() {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(DEPOSIT_ADDRESS);
    }
    show('Address copied');
  }

  return (
    <>
      <div className="top">
        <h2>Wallet</h2>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Available</span>
          <div className="big">
            {formatBtc(available)}
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ ${formatUsd(available * BTC_USD)}</span>
        </div>

        <div className="grid wal">
          <div className="card">
            <div className="tabs" role="group" aria-label="Wallet action">
              <button type="button" aria-pressed={tab === 'withdraw'} onClick={() => handleTabChange('withdraw')}>
                Withdraw
              </button>
              <button type="button" aria-pressed={tab === 'deposit'} onClick={() => handleTabChange('deposit')}>
                Deposit
              </button>
            </div>

            {tab === 'withdraw' ? (
              <div>
                <label htmlFor="wa" style={{ marginTop: 4 }}>Amount (min {MIN_WITHDRAW} BTC)</label>
                <input
                  id="wa"
                  inputMode="decimal"
                  className={errors.amount ? 'bad' : undefined}
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? 'wa-err' : undefined}
                  placeholder="0.00000000"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (errors.amount) setErrors({ ...errors, amount: undefined });
                  }}
                />
                {errors.amount && <div className="ferr" id="wa-err" role="alert">{errors.amount}</div>}
                <div className="pct-row">
                  {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button key={p} type="button" className="pct-btn" onClick={() => setFraction(p)}>
                      {p === 1 ? 'Max' : `${p * 100}%`}
                    </button>
                  ))}
                </div>

                <label htmlFor="wd" style={{ marginTop: 0 }}>Bitcoin address</label>
                <input
                  id="wd"
                  className={errors.address ? 'bad' : undefined}
                  aria-invalid={!!errors.address}
                  aria-describedby={errors.address ? 'wd-err' : undefined}
                  placeholder="bc1q…"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    if (errors.address) setErrors({ ...errors, address: undefined });
                  }}
                />
                {errors.address && <div className="ferr" id="wd-err" role="alert">{errors.address}</div>}

                <div style={{ height: '14px' }} />
                <button className="btn" type="button" onClick={withdraw}>Withdraw</button>
              </div>
            ) : (
              <div>
                <DepositQr value={`bitcoin:${DEPOSIT_ADDRESS}`} />
                <div className="addr" style={{ margin: '0 0 10px' }}>{DEPOSIT_ADDRESS}</div>
                <button className="btn ghost" type="button" onClick={copy}>Copy address</button>
                <p className="fine" style={{ textAlign: 'center', margin: '8px 0 0' }}>BTC only · 1 confirmation</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardhead" style={{ marginBottom: open ? 8 : 0 }}>
              <button
                type="button"
                className="collapse"
                aria-expanded={open}
                onClick={() => {
                  triggerHaptic('selection');
                  setOpen(!open);
                }}
              >
                <h3>Activity</h3>
                <span className="mute">{history.length}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {open && history.slice(0, 6).map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              return (
                <div key={`${h.date}-${i}`} className={`row${i === 0 && h.date === 'Just now' ? ' shareitem' : ''}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{h.label}</div>
                      <small>{h.date}</small>
                    </div>
                  </div>
                  <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontVariantNumeric: 'tabular-nums', fontSize: '13.5px' }}>
                    {h.amount}
                  </b>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
