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
  const [error, setError] = useState('');
  const [history, setHistory] = useState(seed);
  const [toast, show] = useToast();
  const available = Math.max(0, mined - withdrawn);

  function setFraction(pct) {
    triggerHaptic('selection');
    setAmount((available * pct).toFixed(8));
    setError('');
  }

  function handleTabChange(nextTab) {
    if (tab !== nextTab) {
      triggerHaptic('selection');
      setTab(nextTab);
      setError('');
    }
  }

  // TODO: call your withdrawal API here.
  function withdraw() {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      triggerHaptic('error');
      return setError('Enter an amount to withdraw.');
    }
    if (a < MIN_WITHDRAW) {
      triggerHaptic('error');
      return setError(`Minimum withdrawal is ${MIN_WITHDRAW} BTC.`);
    }
    if (a > available) {
      triggerHaptic('error');
      return setError('Amount is more than your available balance.');
    }
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,60}$/.test(address.trim())) {
      triggerHaptic('error');
      return setError('Enter a valid Bitcoin address.');
    }

    triggerHaptic('success');
    setError('');
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
    show('BTC Address copied');
  }

  return (
    <>
      <div className="top">
        <h2>Wallet</h2>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Available to Withdraw</span>
          <div className="big">
            {formatBtc(available)}
            <small>BTC</small>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap', gap: '8px' }}>
            <span className="mute" style={{ fontSize: '14px' }}>≈ ${formatUsd(available * BTC_USD)} USD</span>
            <span className="pill" style={{ fontSize: '11.5px', padding: '3px 10px' }}>Min {MIN_WITHDRAW} BTC</span>
          </div>
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
                <label htmlFor="wa">Amount (BTC)</label>
                <div className="fieldrow">
                  <input
                    id="wa"
                    inputMode="decimal"
                    placeholder="0.00000000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <button className="btn ghost" type="button" onClick={() => setFraction(1)}>Max</button>
                </div>

                <div className="pct-row">
                  {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button key={p} type="button" className="pct-btn" onClick={() => setFraction(p)}>
                      {p * 100}%
                    </button>
                  ))}
                </div>

                <label htmlFor="wd">Bitcoin address</label>
                <input
                  id="wd"
                  placeholder="bc1q…"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />

                <div className="err" role="alert">
                  {error && (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{error}</span>
                    </>
                  )}
                </div>

                <button className="btn" type="button" onClick={withdraw}>Confirm Withdrawal</button>
              </div>
            ) : (
              <div>
                <p className="mute" style={{ fontSize: '13px', margin: '4px 0 12px' }}>
                  Send Bitcoin (BTC) only. Balances update after 1 network confirmation.
                </p>
                <DepositQr value={`bitcoin:${DEPOSIT_ADDRESS}`} />
                <div className="addr">{DEPOSIT_ADDRESS}</div>
                <button className="btn ghost" type="button" onClick={copy}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Deposit Address
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>Activity</h3>
              <span className="mute">Recent events</span>
            </div>
            {history.map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              return (
                <div key={`${h.date}-${i}`} className={`row${i === 0 && h.date === 'Just now' ? ' shareitem' : ''}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500 }}>{h.label}</div>
                      <small>{h.date}</small>
                    </div>
                  </div>
                  <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontVariantNumeric: 'tabular-nums' }}>
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
