'use client';
// Pay screens for our own gateway checkout: the coin picker, and the open payment (exact amount, address, copy, QR).
import { useEffect, useState } from 'react';
import { PAY_ASSETS, PAY_NETS } from '@/lib/pay-coins';
import { triggerHaptic } from '@/lib/haptics';
import { fill, useT } from '@/components/I18nProvider';
import { ConnectBtn, Spin, connectKind, tryOpen } from '@/components/ConnectPay';
import { useWallet } from '@/components/WalletProvider';
import { Qr } from '@/components/Qr';
import { trustLink } from '@/lib/trust-link';

// Coin buttons, plus a network row for a coin that lives on more than one chain (USDT).
// value and onChange use { asset, net }. `only` (optional) is a list of asset ids to show; without it every coin shows.
// `skipNets` (optional) is a list of network ids to hide; a coin then starts on its first network left.
const PICK_BTN = { height: 'auto', minHeight: 44, minWidth: 0, padding: '6px 2px', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, lineHeight: 1.15 };

export function CoinPicker({ value, onChange, disabled = false, only, skipNets, mark }) {
  const t = useT();
  const left = (id) => PAY_ASSETS[id].nets.filter((n) => !skipNets || !skipNets.includes(n));
  const nets = left(value.asset);
  const pick = (next) => {
    triggerHaptic('selection');
    onChange(next);
  };
  const coins = Object.entries(PAY_ASSETS).filter(([id]) => !only || only.includes(id));
  return (
    <>
      <div className="assets" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(coins.length, 1), 5)}, 1fr)`, gap: 6 }} role="group" aria-label={t('wal.coin')}>
        {coins.map(([id, a]) => (
          <button key={id} type="button" className="pct-btn" style={PICK_BTN} aria-pressed={value.asset === id} disabled={disabled} onClick={() => id !== value.asset && pick({ asset: id, net: left(id)[0] || a.nets[0] })}>
            {a.sym}
            {mark && mark(id) && <span style={{ fontSize: 9, opacity: 0.75 }}>{t('dep.auto')}</span>}
          </button>
        ))}
      </div>
      {nets.length > 1 && (
        <>
          <p className="fine" style={{ margin: '0 0 6px' }}>{t('wal.network')}</p>
          <div className="assets" style={{ gridTemplateColumns: `repeat(${nets.length > 3 ? 3 : nets.length}, 1fr)`, gap: 6 }} role="group" aria-label={t('wal.network')}>
            {nets.map((n) => (
              <button key={n} type="button" className="pct-btn" style={PICK_BTN} aria-pressed={value.net === n} disabled={disabled} onClick={() => n !== value.net && pick({ asset: value.asset, net: n })}>
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
// USDT stays open so the network can be chosen next, and close when it is.
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
// `slim` drops More (Copy amount, QR, Trust link): the deposit flow shows Copy address and Copy amount itself.
export function PayInfo({ order, show, slim = false }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const [more, setMore] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  // Where Connect wallet does the job (EVM, TON in Telegram): Open wallet and Copy address (kept in More) come back up front only if it is not set up or it fails.
  const w = useWallet();
  const hideEvm = !!connectKind(order, w) && !failed;
  const a = PAY_ASSETS[order.asset || 'btc'];
  const sym = a ? a.sym : 'BTC';
  const net = PAY_NETS[order.network || 'btc'] || '';
  const copy = (text) => {
    copyText(text);
    show(t('wal.copied'));
  };
  const trust = slim ? null : trustLink(order);
  // A payment link only opens a wallet that registered its scheme. If the page is still in front after 1.5 s, nothing opened:
  // copy the address, and show Copy address, Copy amount and the rest under More.
  const openWallet = async () => {
    if (opening) return;
    // Telegram's webview does not hand ton:// to a wallet: open the https form of the same link in its own browser instead.
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    if (order.network === 'ton' && tg?.initData && tg.openLink && /^ton:\/\/transfer\//.test(order.uri || '')) {
      tg.openLink(order.uri.replace(/^ton:\/\//, 'https://app.tonkeeper.com/'));
      return;
    }
    setOpening(true);
    const ok = await tryOpen(order.uri);
    setOpening(false);
    if (ok) return;
    copyText(order.address);
    show(t('pay.noWallet'));
    setFailed(true);
    setMore(true);
  };
  return (
    <div style={{ marginTop: 6 }}>
      <Countdown at={order.expiresAt} />
      <small style={{ display: 'block' }}>{fill(t('plans.sendTo'), { amount: <b>{order.amount} {sym}</b> })}</small>
      <small className="serial" style={{ display: 'block', wordBreak: 'break-all', userSelect: 'all' }}>{order.address}</small>
      {net && <small style={{ display: 'block' }}>{t('pay.onNet', { net })}</small>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <ConnectBtn
          order={order}
          show={show}
          onFail={(auto) => {
            setFailed(true);
            if (auto) openWallet();
          }}
        />
        {!hideEvm && !(w.tg && order.network !== 'ton') && order.uri && /^[a-z][a-z0-9+.-]*:/i.test(order.uri) && (
          <button type="button" className="pct-btn" onClick={openWallet} disabled={opening} style={{ padding: '0 12px' }}>
            {opening && <Spin />}
            {t('plans.openWallet')}
          </button>
        )}
        {!slim && <button type="button" className="pct-btn" style={{ padding: '0 12px' }} aria-expanded={more} onClick={() => setMore(!more)}>{t('pay.more')}</button>}
        {more && !slim && (
          <>
            {!slim && <button type="button" className="pct-btn" style={{ padding: '0 12px' }} onClick={() => copy(String(order.amount))}>{t('pay.copyAmt')}</button>}
            <button type="button" className="pct-btn" style={{ padding: '0 12px' }} aria-pressed={qr} onClick={() => setQr(!qr)}>{t('pay.qr')}</button>
            {trust && (
              <a className="pct-btn" href={trust} target="_blank" rel="noopener noreferrer" style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}>{t('pay.trust')}</a>
            )}
          </>
        )}
      </div>
      {qr && !slim && <Qr value={order.uri || order.address} />}
    </div>
  );
}
