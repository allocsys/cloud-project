'use client';
// Pay screens for our own gateway checkout: the coin picker, and the open payment (exact amount, address, copy, QR).
import { useEffect, useState } from 'react';
import { PAY_ASSETS, PAY_NETS } from '@/lib/pay-coins';
import { triggerHaptic } from '@/lib/haptics';
import { fill, useT } from '@/components/I18nProvider';
import { ConnectBtn } from '@/components/ConnectPay';
import { Qr } from '@/components/Qr';
import { trustLink } from '@/lib/trust-link';

// Coin buttons, plus a network row for a coin that lives on more than one chain (USDT, USDC).
// value and onChange use { asset, net }.
export function CoinPicker({ value, onChange, disabled = false }) {
  const t = useT();
  const nets = PAY_ASSETS[value.asset].nets;
  const pick = (next) => {
    triggerHaptic('selection');
    onChange(next);
  };
  return (
    <>
      <div className="assets" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }} role="group" aria-label={t('wal.coin')}>
        {Object.entries(PAY_ASSETS).map(([id, a]) => (
          <button key={id} type="button" className="pct-btn" aria-pressed={value.asset === id} disabled={disabled} onClick={() => id !== value.asset && pick({ asset: id, net: a.nets[0] })}>
            {a.sym}
          </button>
        ))}
      </div>
      {nets.length > 1 && (
        <>
          <p className="fine" style={{ margin: '0 0 6px' }}>{t('wal.network')}</p>
          <div className="assets" style={{ gridTemplateColumns: `repeat(${nets.length > 3 ? 3 : nets.length}, 1fr)` }} role="group" aria-label={t('wal.network')}>
            {nets.map((n) => (
              <button key={n} type="button" className="pct-btn" aria-pressed={value.net === n} disabled={disabled} onClick={() => n !== value.net && pick({ asset: value.asset, net: n })}>
                {PAY_NETS[n]}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// Compact version for tight sheets: one row showing the chosen coin, tap to open the full picker. A coin with one network closes it on pick;
// USDT and USDC stay open so the network can be chosen next, and close when it is.
export function CoinSelect({ value, onChange, disabled = false }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const a = PAY_ASSETS[value.asset];
  const label = a.nets.length > 1 ? `${a.sym} \u00b7 ${PAY_NETS[value.net]}` : a.sym;
  const change = (next) => {
    onChange(next);
    if (PAY_ASSETS[next.asset].nets.length === 1 || next.asset === value.asset) setOpen(false);
  };
  return (
    <>
      <button type="button" className="coinrow" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <span>{t('pay.coin')}</span>
        <b>{label}<i aria-hidden="true" /></b>
      </button>
      {open && <CoinPicker value={value} onChange={change} disabled={disabled} />}
    </>
  );
}

function copyText(text) {
  triggerHaptic('success');
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

// Time left on an open payment, as m:ss (h:mm:ss from an hour up). `at` is the invoice's expiry. It ticks once a second, only while the
// tab is visible, and stops by itself at zero. Digits are fixed width, so the line does not jitter.
function Countdown({ at }) {
  const t = useT();
  const end = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(() => Date.now());
  const live = Number.isFinite(end) && end > now;
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [live]);
  if (!Number.isFinite(end)) return null;
  if (!live) return <small style={{ display: 'block', color: 'var(--red)' }}>{t('pay.expired')}</small>;
  const s = Math.max(0, Math.ceil((end - now) / 1000));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0');
  const time = `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
  return (
    <small style={{ display: 'block', fontVariantNumeric: 'tabular-nums', color: s < 60 ? 'var(--gold)' : undefined }}>
      {t('pay.expiresIn', { time })}
    </small>
  );
}

// An open gateway payment: send exactly this amount, to this address, on this network.
// `show` is the page's toast function; it says the text was copied.
export function PayInfo({ order, show }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const a = PAY_ASSETS[order.asset || 'btc'];
  const sym = a ? a.sym : 'BTC';
  const net = PAY_NETS[order.network || 'btc'] || '';
  const copy = (text) => {
    copyText(text);
    show(t('wal.copied'));
  };
  const trust = trustLink(order);
  // A payment link only opens a wallet that registered its scheme. If the page is still in front after 1.5 s, nothing opened: copy the address instead.
  const openWallet = () => {
    let left = false;
    const gone = () => {
      left = true;
    };
    const evs = ['pagehide', 'blur', 'visibilitychange'];
    evs.forEach((e) => window.addEventListener(e, gone));
    setTimeout(() => {
      evs.forEach((e) => window.removeEventListener(e, gone));
      if (left || document.hidden) return;
      copyText(order.address);
      show(t('pay.noWallet'));
    }, 1500);
  };
  return (
    <div style={{ marginTop: 6 }}>
      <Countdown at={order.expiresAt} />
      <small style={{ display: 'block' }}>{fill(t('plans.sendTo'), { amount: <b>{order.amount} {sym}</b> })}</small>
      <small className="serial" style={{ display: 'block', wordBreak: 'break-all', userSelect: 'all' }}>{order.address}</small>
      {net && <small style={{ display: 'block' }}>{t('pay.onNet', { net })}</small>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <ConnectBtn order={order} show={show} />
        {order.uri && /^[a-z][a-z0-9+.-]*:/i.test(order.uri) && (
          <a className="pct-btn" href={order.uri} onClick={openWallet} style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>{t('plans.openWallet')}</a>
        )}
        {trust && (
          <a className="pct-btn" href={trust} target="_blank" rel="noopener noreferrer" style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>{t('pay.trust')}</a>
        )}
        <button type="button" className="pct-btn" style={{ padding: '0 12px' }} onClick={() => copy(String(order.amount))}>{t('pay.copyAmt')}</button>
        <button type="button" className="pct-btn" style={{ padding: '0 12px' }} onClick={() => copy(order.address)}>{t('pay.copyAddr')}</button>
        <button type="button" className="pct-btn" style={{ padding: '0 12px' }} aria-pressed={qr} onClick={() => setQr(!qr)}>{t('pay.qr')}</button>
      </div>
      {qr && <Qr value={order.uri || order.address} />}
    </div>
  );
}
