'use client';
// Deposit flow of our own gateway checkout: amount, then connect the wallet, with Pay manually as the side path.
// The screen comes from state: no open order = amount, an order = connect, the manual flag = manual. The coin comes from the order.
import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { formatUsd } from '@/lib/useMined';
import Field from '@/components/Field';
import { Qr } from '@/components/Qr';
import { CoinPicker, PayInfo } from '@/components/PayCoin';
import { ConnectBtn, Spin, connectKind, tryOpen } from '@/components/ConnectPay';
import { useWallet } from '@/components/WalletProvider';
import { useT } from '@/components/I18nProvider';

const CHIPS = [30, 100, 500];
const ENVS = [['tg', 'dep.envTg'], ['site', 'dep.envSite'], ['pwa', 'dep.envPwa']];
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
// TON Connect needs a TON order (Telegram, no choice), EVM connect needs an EVM one (site, app: ETH, BNB, USDT on eth or bsc).
const EVM_COINS = ['eth', 'bnb', 'usdt'];
const TON_COIN = { asset: 'ton', net: 'ton' };

function copyText(text) {
  triggerHaptic('success');
  try {
    const p = navigator.clipboard?.writeText(text);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}

const CSS = '.dfbar{height:4px;border-radius:2px;background:#3d3519;overflow:hidden;margin:0 0 12px}.dfbar i{display:block;height:100%;background:#e8b84a;transform-origin:left;transition:transform .3s}[dir=rtl] .dfbar i{transform-origin:right}.dfstep{--dx:12px;animation:dfIn .25s ease-out}[dir=rtl] .dfstep{--dx:-12px}@keyframes dfIn{from{opacity:0;transform:translateX(var(--dx))}to{opacity:1;transform:none}}.dfenv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 12px}.dfenv .dfpulse{animation:dfPulse 1.1s ease-in-out infinite}@keyframes dfPulse{0%,100%{opacity:.45}50%{opacity:1}}.dfback{background:none;border:0;padding:4px 8px 4px 0;margin:0 0 6px;color:inherit;cursor:pointer;display:inline-flex}[dir=rtl] .dfback{padding:4px 0 4px 8px}[dir=rtl] .dfback svg{transform:scaleX(-1)}.dfcol{display:flex;flex-direction:column;gap:8px}';

const linkBtn = { background: 'none', border: 0, padding: '10px 0 0', margin: 0, font: 'inherit', fontSize: 13, color: '#9aa6c2', textDecoration: 'underline', cursor: 'pointer', alignSelf: 'center' };

export default function DepositFlow({ minDep, ready, show, refreshDod, onCancel, orders }) {
  const dt = useT();
  const w = useWallet();
  const [env, setEnv] = useState('site');
  const [amt, setAmt] = useState('');
  const [coin, setCoin] = useState({ asset: 'eth', net: 'eth' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [phase, setPhase] = useState('done');
  const [gone, setGone] = useState(() => new Set());
  const [qr, setQr] = useState(false);
  const [opening, setOpening] = useState(false);
  const key = useRef(null); // idempotency key of the order in progress: { sig, key }
  const last = useRef(null); // the last order shown, kept while a coin change is busy so nothing flickers

  useEffect(() => {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
    setEnv(w.tg ? 'tg' : standalone ? 'pwa' : 'site');
  }, [w.tg]);

  const cur = (orders || []).find((o) => o.address && !gone.has(o.id)) || null;
  if (cur) last.current = cur;
  const order = cur || (busy ? last.current : null);
  const others = (orders || []).filter((o) => o.url && !gone.has(o.id));
  const oid = order?.id;

  // A new order: the device chips pulse for a moment, then the detected one is pressed.
  useEffect(() => {
    if (!oid) return undefined;
    setPhase('checking');
    const id = setTimeout(() => setPhase('done'), 1100);
    return () => clearTimeout(id);
  }, [oid]);

  const connected = !!order && !!w.acct && !!connectKind(order, w);
  const screen = !order ? 'amount' : manual ? 'manual' : 'connect';
  const step = screen === 'amount' ? 1 : screen === 'connect' && connected ? 3 : 2;

  async function create(usd, c) {
    setBusy(true);
    setErr('');
    try {
      const body = { usd, asset: c.asset, network: c.net };
      const sig = JSON.stringify(body);
      if (key.current?.sig !== sig) key.current = { sig, key: uid() };
      await post('/api/wallet/deposit', body, key.current.key);
      key.current = null;
      await refreshDod().catch(() => {});
    } catch (e) {
      triggerHaptic('error');
      setErr(e.status ? e.message : dt('common.noConnection'));
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (busy) return;
    const v = parseFloat(amt);
    if (!(v > 0)) {
      triggerHaptic('error');
      setErr(dt('err.depAmount'));
      return;
    }
    if (v < minDep) {
      triggerHaptic('error');
      setErr(dt('err.wdMin', { n: minDep }));
      return;
    }
    create(Math.round(v * 100) / 100, env === 'tg' ? TON_COIN : coin);
  }

  // A coin change = cancel the open order and make a new one for the same amount.
  async function switchCoin(next) {
    if (busy || !order) return;
    const prev = order;
    last.current = prev;
    setBusy(true);
    try {
      await post('/api/orders/cancel', { id: prev.id });
      setGone((s) => new Set(s).add(prev.id));
    } catch (e) {
      show(e.status ? e.message : dt('common.noConnection'));
      setBusy(false);
      return;
    }
    await create(prev.usd, next);
  }

  function leave(id) {
    setGone((s) => new Set(s).add(id));
    last.current = null;
    setManual(false);
    setQr(false);
    onCancel(id);
  }

  function back() {
    triggerHaptic('light');
    if (screen === 'manual') setManual(false);
    else if (order) leave(order.id);
  }

  // Telegram's webview cannot hand a link to a wallet, except the TON one that opens in the browser.
  const canOpen = !!order && !!order.uri && /^[a-z][a-z0-9+.-]*:/i.test(order.uri) && !(w.tg && order.network !== 'ton');
  async function openWallet() {
    if (opening || !order) return;
    // Telegram's webview does not hand ton:// to a wallet: open the https form of the same link in its own browser instead.
    const tg = window.Telegram?.WebApp;
    if (order.network === 'ton' && tg?.initData && tg.openLink && /^ton:\/\/transfer\//.test(order.uri || '')) {
      tg.openLink(order.uri.replace(/^ton:\/\//, 'https://app.tonkeeper.com/'));
      return;
    }
    setOpening(true);
    const ok = await tryOpen(order.uri);
    setOpening(false);
    if (ok) return;
    copyText(order.address);
    show(dt('pay.noWallet'));
    setManual(true);
  }

  const openBtn = canOpen && (
    <button type="button" className="btn ghost" onClick={openWallet} disabled={opening}>
      {opening && <Spin />}
      {dt('plans.openWallet')}
    </button>
  );
  const scanBtn = (
    <button type="button" className="btn ghost" aria-pressed={qr} onClick={() => setQr(!qr)}>{dt('dep.scan')}</button>
  );
  const short = w.acct ? `${w.acct.slice(0, 6)}\u2026${w.acct.slice(-4)}` : '';

  return (
    <div>
      <style>{CSS}</style>
      <div className="dfbar" role="progressbar" aria-label={dt('dep.progress')} aria-valuemin={0} aria-valuemax={3} aria-valuenow={step}>
        <i style={{ width: '100%', transform: `scaleX(${step / 3})` }} />
      </div>
      {screen !== 'amount' && (
        <button type="button" className="dfback" aria-label={dt('dep.back')} onClick={back}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      )}

      <div className="dfstep" key={screen}>
        {screen === 'amount' && (
          <div>
            <Field id="du" label={dt('wal.depUsd')} error={err}>
              <input
                id="du"
                inputMode="decimal"
                className={err ? 'bad' : undefined}
                aria-invalid={!!err}
                aria-describedby={err ? 'du-err' : undefined}
                placeholder="0.00"
                value={amt}
                onChange={(e) => {
                  setAmt(e.target.value);
                  if (err) setErr('');
                }}
              />
            </Field>
            <div className="pct-row">
              {CHIPS.filter((v) => v >= minDep).map((v) => (
                <button key={v} type="button" className="pct-btn" onClick={() => { triggerHaptic('selection'); setAmt(String(v)); setErr(''); }}>${v}</button>
              ))}
            </div>
            <p className="fine" style={{ margin: '6px 0 10px' }}>{dt('wal.depNote', { n: minDep })}</p>
            {env !== 'tg' && <CoinPicker only={EVM_COINS} value={coin} onChange={setCoin} disabled={busy} />}
            <button className="btn" type="button" onClick={start} disabled={busy || !ready}>
              {busy && <Spin />}
              {dt('pay.connect')}
            </button>
          </div>
        )}

        {screen === 'connect' && order && (
          <div>
            <div className="dfenv" role="group" aria-label={dt('dep.checking')}>
              {ENVS.map(([id, label]) => (
                <button key={id} type="button" tabIndex={-1} className={`pct-btn${phase === 'checking' ? ' dfpulse' : ''}`} aria-pressed={phase === 'done' && env === id} onClick={() => {}}>
                  {dt(label)}
                </button>
              ))}
            </div>
            {phase === 'checking' ? (
              <p className="fine" role="status" style={{ margin: '0 0 6px' }}>{dt('dep.checking')}</p>
            ) : (
              <div className="dfcol">
                {connected && <p className="fine" style={{ margin: 0 }}>{`${dt('dep.connected')} \u00b7 ${short}`}</p>}
                {connected || env !== 'pwa' ? (
                  <ConnectBtn big order={order} show={show} onFail={() => {}} payLabel={dt('dep.pay', { n: `$${formatUsd(order.usd)}` })} />
                ) : null}
                {!connected && env !== 'site' && openBtn}
                {!connected && env !== 'tg' && scanBtn}
                <button type="button" style={linkBtn} onClick={() => setManual(true)}>{dt('dep.manual')}</button>
              </div>
            )}
            {qr && <Qr value={order.uri || order.address} />}
          </div>
        )}

        {screen === 'manual' && order && (
          <div>
            <CoinPicker value={{ asset: order.asset || 'btc', net: order.network }} onChange={switchCoin} disabled={busy} />
            <PayInfo order={order} show={show} slim />
            <div className="dfcol" style={{ marginTop: 10 }}>
              <button type="button" className="btn ghost" onClick={() => { copyText(order.address); show(dt('wal.copied')); }}>{dt('wal.copy')}</button>
              <button type="button" className="btn ghost" onClick={() => { copyText(String(order.amount)); show(dt('wal.copied')); }}>{dt('pay.copyAmt')}</button>
              <button type="button" className="btn ghost" onClick={() => leave(order.id)}>{dt('wal.depCancel')}</button>
            </div>
          </div>
        )}
      </div>

      {others.map((o) => (
        <div key={o.id} className="row" style={{ marginTop: 12, gap: 8 }}>
          <small style={{ minWidth: 0 }}>{dt('wal.depOrder', { n: formatUsd(o.usd) })}</small>
          <button className="btn ghost" type="button" onClick={() => { setGone((s) => new Set(s).add(o.id)); onCancel(o.id); }}>{dt('wal.depCancel')}</button>
        </div>
      ))}
    </div>
  );
}
