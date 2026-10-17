'use client';
import { useMemo, useState } from 'react';
import { useMined, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { history as seed, MIN_WITHDRAW } from '@/lib/data';
import { ASSETS, NETWORKS, SWAP_FEE_PCT, quote } from '@/lib/assets';
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

// Coin buttons, plus a network switch for coins that live on more than one chain (USDT).
function Picker({ asset, net, onAsset, onNet }) {
  const nets = Object.keys(ASSETS[asset].nets);
  return (
    <>
      <div className="assets" role="group" aria-label="Coin">
        {Object.entries(ASSETS).map(([id, a]) => (
          <button key={id} type="button" className="pct-btn" aria-pressed={asset === id} onClick={() => onAsset(id)}>
            {a.sym}
          </button>
        ))}
      </div>
      {nets.length > 1 && (
        <div className="netrow">
          <span>Network</span>
          <div className="minitabs" role="group" aria-label="Network">
            {nets.map((n) => (
              <button key={n} type="button" aria-pressed={net === n} onClick={() => onNet(n)}>
                {NETWORKS[n].short}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function Wallet() {
  const mined = useMined();
  const [withdrawn, setWithdrawn] = useState(0);
  const [tab, setTab] = useState('withdraw');
  const [asset, setAsset] = useState('btc');
  const [net, setNet] = useState('btc');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState({});
  const [history, setHistory] = useState(seed);
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  const available = Math.max(0, mined - withdrawn);
  const A = ASSETS[asset];
  const N = NETWORKS[net];
  const parsed = parseFloat(amount);
  const q = parsed > 0 ? quote(asset, net, parsed) : null;
  const flatFee = A.nets[net];

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

  // A pasted address belongs to one network, so changing coin or network clears it.
  function pickAsset(id) {
    if (id === asset) return;
    triggerHaptic('selection');
    setAsset(id);
    setNet(Object.keys(ASSETS[id].nets)[0]);
    setAddress('');
    setErrors({});
  }

  function pickNet(id) {
    if (id === net) return;
    triggerHaptic('selection');
    setNet(id);
    setAddress('');
    setErrors({});
  }

  // TODO: call your withdrawal API here (coin, network, BTC amount, address).
  function withdraw() {
    const a = parsed;
    const next = {};
    if (!(a > 0)) next.amount = 'Enter an amount to withdraw.';
    else if (a < MIN_WITHDRAW) next.amount = `Minimum is ${MIN_WITHDRAW} BTC.`;
    else if (a > available) next.amount = 'More than your available balance.';
    else if (quote(asset, net, a).receive <= 0) next.amount = 'Too small to cover the fees.';
    if (!N.pattern.test(address.trim())) next.address = `Enter a valid ${N.label} address.`;

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
    setHistory([{ kind: 'withdrawal', label: `Withdrawal · ${A.sym}`, date: 'Just now', amount: `-${a.toFixed(4)}` }, ...history]);
    setAmount('');
    setAddress('');
    show('Withdrawal initiated');
  }

  function copy() {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(N.address);
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

            <Picker asset={asset} net={net} onAsset={pickAsset} onNet={pickNet} />

            {tab === 'withdraw' ? (
              <div>
                <label htmlFor="wa" style={{ marginTop: 4 }}>Amount in BTC (min {MIN_WITHDRAW})</label>
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

                <label htmlFor="wd" style={{ marginTop: 0 }}>{A.sym} address{A.nets && Object.keys(A.nets).length > 1 ? ` (${N.short})` : ''}</label>
                <input
                  id="wd"
                  className={errors.address ? 'bad' : undefined}
                  aria-invalid={!!errors.address}
                  aria-describedby={errors.address ? 'wd-err' : undefined}
                  placeholder={net === 'btc' ? 'bc1q…' : net === 'trc20' ? 'T…' : '0x…'}
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

                <div className="quote" aria-live="polite">
                  {q ? (
                    <>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">Swap fee ({SWAP_FEE_PCT}%)</span>
                          <b>${formatUsd(q.swapUsd)}</b>
                        </div>
                      )}
                      <div className="row">
                        <span className="mute">Network fee</span>
                        <b>{q.netFee} {A.sym}</b>
                      </div>
                      <div className="row total">
                        <span className="mute">You receive</span>
                        <b>{q.receive > 0 ? `≈ ${q.receive.toFixed(A.dec)} ${A.sym}` : '—'}</b>
                      </div>
                    </>
                  ) : (
                    <div className="row">
                      <span className="mute">Fees</span>
                      <span className="mute">
                        {asset === 'btc' ? '' : `${SWAP_FEE_PCT}% swap + `}{flatFee} {A.sym} network
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ height: '14px' }} />
                <button className="btn" type="button" onClick={withdraw}>Withdraw</button>
              </div>
            ) : (
              <div>
                <DepositQr value={`${N.uri}${N.address}`} />
                <div className="addr" style={{ margin: '0 0 10px' }}>{N.address}</div>
                <button className="btn ghost" type="button" onClick={copy}>Copy address</button>
                <p className="fine" style={{ textAlign: 'center', margin: '8px 0 0' }}>
                  {A.sym} only · {N.label} · {N.confirms} confirmation{N.confirms === 1 ? '' : 's'}
                </p>
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
