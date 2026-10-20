'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMinedFeed, formatBtc, formatUsd } from '@/lib/useMined';
import { MIN_WITHDRAW, plans } from '@/lib/data';
import { smartPick, reinvestTitle, reinvestHref } from '@/lib/reinvest';
import { ASSETS, NETWORKS, SWAP_FEE_PCT, quote, depositQuote, priceOf } from '@/lib/assets';
import { useApi, post } from '@/lib/api';
import { qrMatrix, qrPath } from '@/lib/qr';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import Field from '@/components/Field';

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
};

const STATUS = { pending: 'Pending approval', approved: 'Approved', sent: 'Sent', failed: 'Failed, refunded', rejected: 'Rejected, refunded' };

const FILTERS = [['all', 'All'], ['payout', 'Payouts'], ['withdrawal', 'Withdraw'], ['deposit', 'Deposits']];

const floorTo = (n, d) => Math.floor(n * 10 ** d) / 10 ** d;
const ceilTo = (n, d) => Math.ceil(n * 10 ** d - 1e-9) / 10 ** d;
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// USD value of an activity row. Amounts are in the row's own coin; purchases are already dollars.
function usdOf(h, prices) {
  if (h.kind === 'purchase' || !h.coin) return null;
  const id = h.coin.toLowerCase();
  const v = Math.abs(parseFloat(h.amount));
  return ASSETS[id] && v > 0 ? v * priceOf(id, prices) : null;
}

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

// Enter the amount in the coin itself or in dollars.
function UnitSwitch({ sym, unit, onUnit }) {
  return (
    <div className="minitabs uswitch" role="group" aria-label="Amount unit">
      <button type="button" aria-pressed={unit === 'coin'} onClick={() => onUnit('coin')}>{sym}</button>
      <button type="button" aria-pressed={unit === 'usd'} onClick={() => onUnit('usd')}>USD</button>
    </div>
  );
}

export default function Wallet() {
  // The live ticker runs at the rate of the user's own online miners (none online means no ticks), the same as the
  // dashboard, so Available here and the dashboard goal agree and Max never exceeds what the server will accept.
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const dailyUsd = (md ? md.contracts : []).filter((c) => c.online).reduce((s, c) => s + c.dailyUsd, 0);
  const { gain: mined } = useMinedFeed(dailyUsd);
  // Prices and the wallet come from the cached API: instant from cache, refreshed quietly.
  // Until the first wallet response arrives the balance shows a dash (never sample data); static prices fill in for prices.
  const { data: pd } = useApi('/api/prices', { ttl: 30000, poll: 30000 });
  const { data: wd, mutate, refresh } = useApi('/api/wallet', { ttl: 10000 });
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const prices = pd?.prices;
  const [tab, setTab] = useState('withdraw');
  const [asset, setAsset] = useState('btc');
  const [net, setNet] = useState('btc');
  const [unit, setUnit] = useState('coin');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [dep, setDep] = useState('');
  const [toast, show] = useToast();

  const btcUsd = priceOf('btc', prices);
  const ready = !!wd;
  const history = wd ? wd.history : [];
  // Server balance at the last fetch, plus the sats the live feed has added since this page opened.
  const earned = (wd ? wd.earned : 0) + mined;
  const available = wd ? Math.max(0, earned - wd.withdrawn - (wd.spent || 0)) : 0;
  // The Reinvest card shows once the balance covers a plan, and suggests the biggest one it can pay for.
  const balUsd = available * btcUsd;
  const rein = ready ? smartPick(cat ? cat.plans : plans, balUsd, cat ? cat.halls : undefined) : null;
  const A = ASSETS[asset];
  const N = NETWORKS[net];
  const price = priceOf(asset, prices);
  const usdMode = unit === 'usd';
  const toCoin = (v) => (usdMode ? v / price : v);
  const parsed = parseFloat(amount);
  const coinAmt = parsed > 0 ? toCoin(parsed) : 0;
  const q = coinAmt > 0 ? quote(asset, net, coinAmt, prices) : null;
  const flatFee = A.nets[net];
  const dp = parseFloat(dep);
  const depCoin = dp > 0 ? toCoin(dp) : 0;
  const dq = depCoin > 0 ? depositQuote(asset, depCoin, prices) : null;
  // Invite income counts as a payout.
  const shown = filter === 'all' ? history : history.filter((h) => h.kind === filter || (filter === 'payout' && h.kind === 'referral'));

  // The minimum is set in BTC, shown in whatever unit the person is typing in.
  const minUsd = MIN_WITHDRAW * btcUsd;
  const minText = usdMode ? `$${formatUsd(ceilTo(minUsd, 2))}` : `${ceilTo(minUsd / price, A.dec).toFixed(A.dec)} ${A.sym}`;
  const dec = usdMode ? 2 : A.dec;

  function setFraction(pct) {
    triggerHaptic('selection');
    const usd = available * pct * btcUsd;
    setAmount(floorTo(usdMode ? usd : usd / price, dec).toFixed(dec));
    setErrors({ ...errors, amount: undefined });
  }

  function handleTabChange(nextTab) {
    if (tab !== nextTab) {
      triggerHaptic('selection');
      setTab(nextTab);
      setErrors({});
    }
  }

  // Switching unit keeps the same value, just restated in the other unit.
  function pickUnit(next) {
    if (next === unit) return;
    triggerHaptic('selection');
    const conv = (s) => {
      const v = parseFloat(s);
      if (!(v > 0)) return s;
      return next === 'usd' ? (v * price).toFixed(2) : (v / price).toFixed(A.dec);
    };
    setAmount(conv(amount));
    setDep(conv(dep));
    setUnit(next);
    setErrors({});
  }

  // A pasted address belongs to one network and amounts belong to one coin, so changing coin clears them.
  function pickAsset(id) {
    if (id === asset) return;
    triggerHaptic('selection');
    setAsset(id);
    setNet(Object.keys(ASSETS[id].nets)[0]);
    setAmount('');
    setDep('');
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

  // Checks locally for instant feedback, shows the withdrawal at once, then lets the server decide.
  // If the server says no, the screen rolls back and shows its message.
  async function withdraw() {
    if (busy || !wd) return;
    const next = {};
    const wq = coinAmt > 0 ? quote(asset, net, coinAmt, prices) : null;
    if (!wq) next.amount = 'Enter an amount to withdraw.';
    else if (wq.btc < MIN_WITHDRAW) next.amount = `Minimum is ${minText}.`;
    else if (wq.btc > available * (1 + 1e-9) + 1e-12) next.amount = 'More than your available balance.';
    else if (wq.receive <= 0) next.amount = 'Too small to cover the fees.';
    if (!N.pattern.test(address.trim())) next.address = `Enter a valid ${N.label} address.`;

    if (next.amount || next.address) {
      triggerHaptic('error');
      setErrors(next);
      const el = document.getElementById(next.amount ? 'wa' : 'wd');
      if (el) el.focus();
      return;
    }

    setErrors({});
    setBusy(true);
    const base = wd;
    mutate({
      ...base,
      withdrawn: base.withdrawn + wq.btc,
      history: [
        {
          kind: 'withdrawal',
          status: 'pending',
          label: `Withdrawal · ${A.sym}`,
          date: 'Just now',
          amount: `-${coinAmt.toFixed(A.dec)}`,
          coin: A.sym,
          net: N.short,
          fee: `${wq.netFee} ${A.sym}${wq.swapUsd ? ` + $${formatUsd(wq.swapUsd)} swap` : ''}`,
        },
        ...base.history,
      ],
    });

    try {
      await post('/api/wallet/withdraw', { asset, net, amount: coinAmt, address: address.trim() }, uid());
      refresh().catch(() => {});
      triggerHaptic('success');
      setAmount('');
      setAddress('');
      show('Withdrawal requested. It is paid after approval.');
    } catch (e) {
      mutate(base);
      refresh().catch(() => {});
      triggerHaptic('error');
      const msg = e.status ? e.message : 'No connection. Try again.';
      setErrors({ [e.field === 'address' ? 'address' : 'amount']: msg });
    } finally {
      setBusy(false);
    }
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
        <div className="card hero slim">
          <span className="mute eyebrow">Available balance</span>
          <div className="big">
            {ready ? formatBtc(available) : '—'}
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>{ready ? `≈ $${formatUsd(available * btcUsd)}` : '\u00a0'}</span>
        </div>

        {rein && (
          <Link href={reinvestHref(rein)} className="card rein">
            <div>
              <b>{reinvestTitle(rein)}</b>
              <small>
                ${formatUsd(rein.plan.price)} · {rein.plan.days} days · ~{rein.plan.daily}/day
                {rein.left >= 1 ? ` · $${formatUsd(rein.left)} left` : ''}
              </small>
            </div>
            <span className="rgo">Review</span>
          </Link>
        )}

        <div className="grid wal">
          <div className="card wcard">
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
                <Field id="wa" label="Amount" className="unit" side={<UnitSwitch sym={A.sym} unit={unit} onUnit={pickUnit} />} error={errors.amount}>
                  <input
                    id="wa"
                    inputMode="decimal"
                    className={errors.amount ? 'bad' : undefined}
                    aria-invalid={!!errors.amount}
                    aria-describedby={errors.amount ? 'wa-err' : undefined}
                    placeholder={(0).toFixed(dec)}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      if (errors.amount) setErrors({ ...errors, amount: undefined });
                    }}
                  />
                </Field>
                <div className="pct-row">
                  {[0.25, 0.5, 0.75, 1].map((p) => (
                    <button key={p} type="button" className="pct-btn" onClick={() => setFraction(p)}>
                      {p === 1 ? 'Max' : `${p * 100}%`}
                    </button>
                  ))}
                </div>

                <Field id="wd" label={`${A.sym} address${A.nets && Object.keys(A.nets).length > 1 ? ` (${N.short})` : ''}`} error={errors.address}>
                  <input
                    id="wd"
                    className={errors.address ? 'bad' : undefined}
                    aria-invalid={!!errors.address}
                    aria-describedby={errors.address ? 'wd-err' : undefined}
                    placeholder={net === 'btc' ? 'bc1q…' : net === 'trc20' ? 'T…' : net === 'ton' ? 'UQ…' : '0x…'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      if (errors.address) setErrors({ ...errors, address: undefined });
                    }}
                  />
                </Field>

                <div className={q ? 'quote' : 'fine winfo'} aria-live="polite">
                  {q ? (
                    <>
                      <div className="row">
                        <span className="mute">Amount</span>
                        <b>{usdMode ? `≈ ${coinAmt.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(q.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">Swap fee ({SWAP_FEE_PCT}%)</span>
                          <b>${formatUsd(q.swapUsd)}</b>
                        </div>
                      )}
                      <div className="row">
                        <span className="mute">Network fee</span>
                        <b>{q.netFee} {A.sym} · ${formatUsd(q.netFeeUsd)}</b>
                      </div>
                      <div className="row total">
                        <span className="mute">You receive</span>
                        <b style={{ textAlign: 'right' }}>
                          {q.receive > 0 ? `≈ ${q.receive.toFixed(A.dec)} ${A.sym}` : '—'}
                          {q.receive > 0 && <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(q.receiveUsd)}</small>}
                        </b>
                      </div>
                    </>
                  ) : (
                    `Min ${minText} · fee ${asset === 'btc' ? '' : `${SWAP_FEE_PCT}% swap + `}${flatFee} ${A.sym}`
                  )}
                </div>

                <button className="btn" type="button" onClick={withdraw} disabled={busy || !ready}>
                  {busy ? 'Sending…' : 'Withdraw'}
                </button>
              </div>
            ) : (
              <div>
                <DepositQr value={`${N.uri}${N.address}`} />
                <div className="addr" style={{ margin: '0 0 10px' }}>{N.address}</div>
                <button className="btn ghost" type="button" onClick={copy}>Copy address</button>
                <p className="fine" style={{ textAlign: 'center', margin: '8px 0 0' }}>
                  {A.sym} only · {N.label} · {N.confirms} confirmation{N.confirms === 1 ? '' : 's'}
                </p>

                <Field id="da" label="Amount you send" className="unit" side={<UnitSwitch sym={A.sym} unit={unit} onUnit={pickUnit} />}>
                  <input
                    id="da"
                    inputMode="decimal"
                    placeholder={(0).toFixed(dec)}
                    value={dep}
                    onChange={(e) => setDep(e.target.value)}
                  />
                </Field>
                <div className={dq ? 'quote' : 'fine winfo'} aria-live="polite">
                  {dq ? (
                    <>
                      <div className="row">
                        <span className="mute">You send</span>
                        <b>{usdMode ? `≈ ${depCoin.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(dq.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">Swap fee ({SWAP_FEE_PCT}%)</span>
                          <b>${formatUsd(dq.swapUsd)}</b>
                        </div>
                      )}
                      <div className="row total">
                        <span className="mute">Credited</span>
                        <b style={{ textAlign: 'right' }}>
                          ≈ {formatBtc(dq.creditedBtc)} BTC
                          <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(dq.creditedUsd)}</small>
                        </b>
                      </div>
                    </>
                  ) : (
                    `Credited as BTC · ${asset === 'btc' ? 'no fee' : `${SWAP_FEE_PCT}% swap fee`}`
                  )}
                </div>
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
                <span className="mute">{ready ? history.length : ''}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {open && (
              <div className="minitabs fill" role="group" aria-label="Filter activity">
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
            )}
            {open && shown.slice(0, 8).map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              const hu = usdOf(h, prices);
              return (
                <div key={`${h.date}-${i}`} className={`row${i === 0 && h.date === 'Just now' ? ' shareitem' : ''}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{h.label}</div>
                      <small>{[h.date, h.net !== h.coin ? h.net : null, h.status ? STATUS[h.status] || h.status : null].filter(Boolean).join(' · ')}{h.fee ? ` · fee ${h.fee}` : ''}</small>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px' }}>
                      {h.amount}{h.coin ? ` ${h.coin}` : ''}
                    </b>
                    {hu != null && <small style={{ display: 'block' }}>≈ ${formatUsd(hu)}</small>}
                  </div>
                </div>
              );
            })}
            {open && shown.length === 0 && <p className="empty">{ready ? 'Nothing here yet.' : 'Loading…'}</p>}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
