'use client';
import PageHead from '@/components/PageHead';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccrued, formatBtc, formatUsd } from '@/lib/useMined';
import { MIN_WITHDRAW, MIN_WITHDRAW_USD, MIN_DEPOSIT_USD } from '@/lib/data';
import { smartPick, reinvestTitle, reinvestHref } from '@/lib/reinvest';
import { ASSETS, NETWORKS, SWAP_FEE_PCT, quote, depositQuote, priceOf } from '@/lib/assets';
import { serviceTier, serviceLine } from '@/lib/service-fee';
import { useApi, post } from '@/lib/api';
import { qrMatrix, qrPath } from '@/lib/qr';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import Field from '@/components/Field';
import { fill, useLang, useT } from '@/components/I18nProvider';
import { CoinPicker, PayInfo } from '@/components/PayCoin';
import { DEFAULT_PAY } from '@/lib/pay-coins';
import { histLabel, histDate, histFee, histNet } from '@/lib/i18n/history';

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  adjustment: { glyph: '±', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
};

const STATUS = { pending: 'wal.stPending', approved: 'wal.stApproved', sent: 'wal.stSent', failed: 'wal.stFailed', rejected: 'wal.stRejected' };

const FILTERS = [['all', 'wal.fAll'], ['payout', 'wal.fPayouts'], ['withdrawal', 'wal.withdraw'], ['deposit', 'wal.fDeposits']];

// True while the element is on screen, so its animation pauses when it is not.
function useSeen() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

// Wallet motion: transform and opacity only. A light band crosses the balance card, activity rows fade in one by one, the fee quote fades in.
const WALLET_CSS = '.whero{position:relative;overflow:hidden}.wshine{position:absolute;top:0;bottom:0;left:0;width:45%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.1),transparent);animation:wShine 8s ease-in-out infinite}@keyframes wShine{0%,55%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(330%) skewX(-18deg)}}.wpause .wshine{animation-play-state:paused}.wrow{animation:wRow .35s ease-out both}@keyframes wRow{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.quote{animation:wQuote .25s ease-out}@keyframes wQuote{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}';

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
  const t = useT();
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
      <svg viewBox={`${-pad} ${-pad} ${box} ${box}`} role="img" aria-label={t('wal.qr')} shapeRendering="crispEdges">
        <rect x={-pad} y={-pad} width={box} height={box} fill="#fff" />
        <path d={qr.d} fill="#0b0a08" />
      </svg>
    </div>
  );
}

// Coin buttons, plus a network switch for coins that live on more than one chain (USDT).
function Picker({ asset, net, onAsset, onNet }) {
  const t = useT();
  const nets = Object.keys(ASSETS[asset].nets);
  return (
    <>
      <div className="assets" role="group" aria-label={t('wal.coin')}>
        {Object.entries(ASSETS).map(([id, a]) => (
          <button key={id} type="button" className="pct-btn" aria-pressed={asset === id} onClick={() => onAsset(id)}>
            {a.sym}
          </button>
        ))}
      </div>
      {nets.length > 1 && (
        <div className="netrow">
          <span>{t('wal.network')}</span>
          <div className="minitabs" role="group" aria-label={t('wal.network')}>
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
  const t = useT();
  return (
    <div className="minitabs uswitch" role="group" aria-label={t('wal.unitAria')}>
      <button type="button" aria-pressed={unit === 'coin'} onClick={() => onUnit('coin')}>{sym}</button>
      <button type="button" aria-pressed={unit === 'usd'} onClick={() => onUnit('usd')}>USD</button>
    </div>
  );
}

export default function Wallet() {
  const { t, lang } = useLang();
  // The live ticker runs at the rate of the user's own online miners (none online means no ticks), the same as the
  // dashboard, so Available here and the dashboard goal agree and Max never exceeds what the server will accept.
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const dailyUsd = (md ? md.contracts : []).filter((c) => c.online).reduce((s, c) => s + c.dailyUsd, 0);
  // Prices and the wallet come from the cached API: instant from cache, refreshed quietly.
  // Until the first wallet response arrives the balance shows a dash (never sample data); static prices fill in for prices.
  const { data: pd } = useApi('/api/prices', { ttl: 30000, poll: 30000 });
  const { data: wd, mutate, refresh } = useApi('/api/wallet', { ttl: 10000 });
  // What the online miners added since the server worked out the wallet (asOf): same maths as the dashboard.
  const mined = useAccrued(dailyUsd, wd ? wd.asOf : null);
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
  const [heroRef, heroSeen] = useSeen();
  // Deposit through the crypto provider (a hosted payment page), when it is switched on. The open top-up orders come with the same answer.
  const { data: dod, refresh: refreshDod } = useApi('/api/orders?kind=deposit', { ttl: 10000 });
  const cryptoOn = !!dod?.crypto;
  const minDep = dod?.min ?? MIN_DEPOSIT_USD; // the admin's minimum; the shown text waits for this answer (hideCalm)
  const depPending = (dod?.orders || []).filter((o) => o.status === 'pending');
  const [depUsd, setDepUsd] = useState('');
  const [depErr, setDepErr] = useState('');
  const [payCoin, setPayCoin] = useState(DEFAULT_PAY); // the coin a top-up is paid in (our own checkout only)
  const depKey = useRef(null); // idempotency key of the top-up in progress: { usd, key }

  async function startDeposit() {
    if (busy) return;
    const v = parseFloat(depUsd);
    if (!(v > 0)) {
      triggerHaptic('error');
      setDepErr(t('err.depAmount'));
      return;
    }
    if (v < minDep) {
      triggerHaptic('error');
      setDepErr(t('err.wdMin', { n: minDep }));
      return;
    }
    setDepErr('');
    setBusy(true);
    let leaving = false;
    try {
      const usd = Math.round(v * 100) / 100;
      const body = dod?.multi ? { usd, asset: payCoin.asset, network: payCoin.net } : { usd };
      const sig = JSON.stringify(body);
      if (depKey.current?.sig !== sig) depKey.current = { sig, key: uid() };
      const r = await post('/api/wallet/deposit', body, depKey.current.key);
      if (r.pending && r.order?.url) {
        leaving = true;
        window.location.assign(r.order.url);
        return;
      }
      depKey.current = null;
      setDepUsd('');
      if (r.order?.address) show(t('pay.sendExact'));
    } catch (e) {
      triggerHaptic('error');
      setDepErr(e.status ? e.message : t('common.noConnection'));
    } finally {
      if (!leaving) {
        setBusy(false);
        refreshDod().catch(() => {});
      }
    }
  }

  async function cancelDep(id) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : t('common.noConnection'));
    }
    refreshDod().catch(() => {});
  }

  // While a top-up is open, look for the payment every few seconds. When one turns paid, say so and refresh the balance.
  useEffect(() => {
    if (!depPending.length) return undefined;
    const i = setInterval(() => refreshDod().catch(() => {}), 5000);
    return () => clearInterval(i);
  }, [depPending.length]);
  const depSeen = useRef(new Set());
  useEffect(() => {
    if (!dod) return;
    const ids = new Set(depPending.map((o) => o.id));
    for (const id of depSeen.current) {
      if (!ids.has(id) && dod.orders.find((o) => o.id === id)?.status === 'paid') {
        triggerHaptic('success');
        show(t('wal.depPaid'));
        refresh().catch(() => {});
      }
    }
    depSeen.current = ids;
  }, [dod]);
  // Back from the payment page can restore this page as it was left: free the button and start the next top-up with a fresh key.
  useEffect(() => {
    const back = (e) => {
      if (!e.persisted) return;
      setBusy(false);
      depKey.current = null;
      refreshDod().catch(() => {});
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);
  // The Reinvest card and the action card keep their place but stay hidden until the wallet and catalogue have answered (or 1.5 seconds), so Reinvest never pushes the action card down.
  const [calmWait, setCalmWait] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setCalmWait(false), 1500);
    return () => clearTimeout(t);
  }, []);
  const hideCalm = wd && cat && dod ? undefined : calmWait ? { visibility: 'hidden' } : undefined;

  const btcUsd = priceOf('btc', prices);
  const ready = !!wd;
  const history = wd ? wd.history : [];
  // Server balance at the last fetch, plus the sats the live feed has added since this page opened.
  const earned = (wd ? wd.earned : 0) + mined;
  const available = wd ? Math.max(0, earned - wd.withdrawn - (wd.spent || 0)) : 0;
  // The Reinvest card shows once the balance covers a plan, and suggests the biggest one it can pay for.
  const balUsd = available * btcUsd;
  const rein = ready ? smartPick([], balUsd, cat ? cat.halls : undefined) : null;
  const A = ASSETS[asset];
  const N = NETWORKS[net];
  const price = priceOf(asset, prices);
  const usdMode = unit === 'usd';
  const toCoin = (v) => (usdMode ? v / price : v);
  const parsed = parseFloat(amount);
  const coinAmt = parsed > 0 ? toCoin(parsed) : 0;
  // The withdrawal service fee tier, counted from the last withdrawal (or the first purchase). The server decides the real one.
  const tier = ready && wd.svcSince ? serviceTier(wd.svcSince) : null;
  const svcPct = tier ? tier.pct : 0;
  const q = coinAmt > 0 ? quote(asset, net, coinAmt, prices, svcPct) : null;
  const flatFee = A.nets[net];
  const dp = parseFloat(dep);
  const depCoin = dp > 0 ? toCoin(dp) : 0;
  const dq = depCoin > 0 ? depositQuote(asset, depCoin, prices) : null;
  // Invite income counts as a payout.
  const shown = filter === 'all' ? history : history.filter((h) => h.kind === filter || (filter === 'payout' && h.kind === 'referral'));

  // The minimum is $15 worth of coin, shown in whatever unit the person is typing in.
  const minUsd = MIN_WITHDRAW_USD;
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
    const wq = coinAmt > 0 ? quote(asset, net, coinAmt, prices, svcPct) : null;
    if (!wq) next.amount = t('wal.errAmount');
    else if (wq.btc < MIN_WITHDRAW) next.amount = t('wal.errMin', { min: minText });
    else if (wq.btc > available * (1 + 1e-9) + 1e-12) next.amount = t('wal.errMore');
    else if (wq.receive <= 0) next.amount = t('wal.errSmall');
    if (!N.pattern.test(address.trim())) next.address = t('wal.errAddr', { net: N.label });

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
      svcSince: Date.now(),
      history: [
        {
          kind: 'withdrawal',
          status: 'pending',
          label: `Withdrawal · ${A.sym}`,
          date: 'Just now',
          amount: `-${coinAmt.toFixed(A.dec)}`,
          coin: A.sym,
          net: N.short,
          fee: `${wq.netFee} ${A.sym}${wq.swapUsd ? ` + $${formatUsd(wq.swapUsd)} swap` : ''}${wq.svcUsd ? ` + $${formatUsd(wq.svcUsd)} service` : ''}`,
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
      show(t('wal.requested'));
    } catch (e) {
      mutate(base);
      refresh().catch(() => {});
      triggerHaptic('error');
      const msg = e.status ? e.message : t('common.noConnection');
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
    show(t('wal.copied'));
  }

  return (
    <>
      <style>{WALLET_CSS}</style>
      <PageHead title={t('nav.wallet')} icon="wallet" />
      <div className="grid">
        <div ref={heroRef} className={`card hero slim whero${heroSeen ? '' : ' wpause'}`}>
          <i className="wshine" aria-hidden="true" />
          <span className="mute eyebrow">{t('wal.avail')}</span>
          <div className="big">
            {ready ? formatBtc(available) : '—'}
            <small>BTC</small>
          </div>
          <span className="mute" style={{ display: 'block', fontSize: '14px' }}>{ready ? `≈ $${formatUsd(available * btcUsd)}` : '\u00a0'}</span>
          <span className="mute" style={{ display: 'block', fontSize: '12.5px', marginTop: '2px' }}>{ready && wd.mined != null ? t('wal.totalMined', { n: formatBtc(wd.mined + mined) }) : '\u00a0'}</span>
        </div>

        {rein && (
          <Link href={reinvestHref(rein)} className="card rein" style={hideCalm}>
            <div>
              <b>{reinvestTitle(rein, t)}</b>
              <small>
                {t('dash.reinLine', { price: formatUsd(rein.plan.price), days: rein.plan.days, daily: rein.plan.daily })}
                {rein.left >= 1 ? ` · ${t('dash.left', { n: formatUsd(rein.left) })}` : ''}
              </small>
            </div>
            <span className="rgo">{t('dash.review')}</span>
          </Link>
        )}

        <div className="grid wal" style={hideCalm}>
          <div className="card wcard">
            <div className="tabs" role="group" aria-label={t('wal.aria')}>
              <button type="button" aria-pressed={tab === 'withdraw'} onClick={() => handleTabChange('withdraw')}>
                {t('wal.withdraw')}
              </button>
              <button type="button" aria-pressed={tab === 'deposit'} onClick={() => handleTabChange('deposit')}>
                {t('wal.deposit')}
              </button>
            </div>

            {!(tab === 'deposit' && cryptoOn) && <Picker asset={asset} net={net} onAsset={pickAsset} onNet={pickNet} />}

            {tab === 'withdraw' ? (
              <div>
                <Field id="wa" label={t('wal.amount')} className="unit" side={<UnitSwitch sym={A.sym} unit={unit} onUnit={pickUnit} />} error={errors.amount}>
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
                      {p === 1 ? t('wal.max') : `${p * 100}%`}
                    </button>
                  ))}
                </div>

                <Field id="wd" label={A.nets && Object.keys(A.nets).length > 1 ? t('wal.addrNet', { sym: A.sym, net: N.short }) : t('wal.addr', { sym: A.sym })} error={errors.address}>
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
                        <span className="mute">{t('wal.amount')}</span>
                        <b>{usdMode ? `≈ ${coinAmt.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(q.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">{t('wal.swapFee', { n: SWAP_FEE_PCT })}</span>
                          <b>${formatUsd(q.swapUsd)}</b>
                        </div>
                      )}
                      {svcPct > 0 && (
                        <div className="row">
                          <span className="mute">{t('wal.svcFee', { n: svcPct })}</span>
                          <b>−${formatUsd(q.svcUsd)}</b>
                        </div>
                      )}
                      <div className="row">
                        <span className="mute">{t('wal.netFee')}</span>
                        <b>{q.netFee} {A.sym} · ${formatUsd(q.netFeeUsd)}</b>
                      </div>
                      <div className="row total">
                        <span className="mute">{t('wal.receive')}</span>
                        <b style={{ textAlign: 'end' }}>
                          {q.receive > 0 ? `≈ ${q.receive.toFixed(A.dec)} ${A.sym}` : '—'}
                          {q.receive > 0 && <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(q.receiveUsd)}</small>}
                        </b>
                      </div>
                    </>
                  ) : (
                    t('wal.hint', { min: minText, fee: asset === 'btc' ? t('wal.feeFlat', { flat: flatFee, sym: A.sym }) : t('wal.feeSwap', { n: SWAP_FEE_PCT, flat: flatFee, sym: A.sym }) })
                  )}
                </div>

                {tier && <p className="fine" style={{ margin: '6px 0 10px' }}>{serviceLine(tier, t)}</p>}

                <button className="btn" type="button" onClick={withdraw} disabled={busy || !ready}>
                  {busy ? t('wal.sending') : t('wal.withdraw')}
                </button>
              </div>
            ) : cryptoOn ? (
              <div>
                {dod?.multi && <CoinPicker value={payCoin} onChange={setPayCoin} disabled={busy} />}
                <Field id="du" label={t('wal.depUsd')} error={depErr}>
                  <input
                    id="du"
                    inputMode="decimal"
                    className={depErr ? 'bad' : undefined}
                    aria-invalid={!!depErr}
                    aria-describedby={depErr ? 'du-err' : undefined}
                    placeholder="0.00"
                    value={depUsd}
                    onChange={(e) => {
                      setDepUsd(e.target.value);
                      if (depErr) setDepErr('');
                    }}
                  />
                </Field>
                <p className="fine" style={{ margin: '6px 0 10px' }}>{t('wal.depNote', { n: minDep })}</p>
                <button className="btn" type="button" onClick={startDeposit} disabled={busy || !ready}>
                  {t('wal.depPay')}
                </button>
                {depPending.map((o) => (
                  <div key={o.id} className="row" style={{ marginTop: 12, gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('wal.depOrder', { n: formatUsd(o.usd) })}</div>
                      {o.url ? <small style={{ overflowWrap: 'anywhere' }}>{t('wal.depWait')}</small> : <PayInfo order={o} show={show} />}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {o.url && <a className="btn ghost" href={o.url}>{t('wal.depOpen')}</a>}
                      <button className="btn ghost" type="button" onClick={() => cancelDep(o.id)}>{t('wal.depCancel')}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <DepositQr value={`${N.uri}${N.address}`} />
                <div className="addr" style={{ margin: '0 0 10px' }}>{N.address}</div>
                <button className="btn ghost" type="button" onClick={copy}>{t('wal.copy')}</button>
                <p className="fine" style={{ textAlign: 'center', margin: '8px 0 0' }}>
                  {t('wal.depInfo', { sym: A.sym, net: N.label, c: N.confirms === 1 ? t('wal.confirm1') : t('wal.confirmN', { n: N.confirms }), m: minDep })}
                </p>

                <Field id="da" label={t('wal.sendAmt')} className="unit" side={<UnitSwitch sym={A.sym} unit={unit} onUnit={pickUnit} />}>
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
                        <span className="mute">{t('wal.youSend')}</span>
                        <b>{usdMode ? `≈ ${depCoin.toFixed(A.dec)} ${A.sym}` : `≈ $${formatUsd(dq.usd)}`}</b>
                      </div>
                      {asset !== 'btc' && (
                        <div className="row">
                          <span className="mute">{t('wal.swapFee', { n: SWAP_FEE_PCT })}</span>
                          <b>${formatUsd(dq.swapUsd)}</b>
                        </div>
                      )}
                      <div className="row total">
                        <span className="mute">{t('wal.credited')}</span>
                        <b style={{ textAlign: 'end' }}>
                          ≈ {formatBtc(dq.creditedBtc)} BTC
                          <small className="mute" style={{ display: 'block', fontWeight: 400 }}>≈ ${formatUsd(dq.creditedUsd)}</small>
                        </b>
                      </div>
                      {dq.usd < minDep - 0.01 && (
                        <p className="fine" role="alert" style={{ margin: '8px 0 0' }}>{t('wal.below', { n: minDep })}</p>
                      )}
                    </>
                  ) : (
                    t('wal.depHint', { n: minDep, fee: asset === 'btc' ? t('wal.noFee') : t('wal.swapFeeN', { n: SWAP_FEE_PCT }) })
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
                <h3>{t('wal.activity')}</h3>
                <span className="mute">{ready ? history.length : ''}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {open && (
              <div className="minitabs fill" role="group" aria-label={t('wal.filterAria')}>
                {FILTERS.map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{t(label)}</button>
                ))}
              </div>
            )}
            {open && shown.slice(0, 8).map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              const hu = usdOf(h, prices);
              return (
                <div key={`${h.date}-${i}`} className={`row wrow${i === 0 && h.date === 'Just now' ? ' shareitem' : ''}`} style={{ animationDelay: `${i * 50}ms` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{histLabel(h, t)}</div>
                      <small>{[histDate(h, lang, t), h.net !== h.coin ? histNet(h.net, t) : null, h.status ? (STATUS[h.status] ? t(STATUS[h.status]) : h.status) : null].filter(Boolean).join(' · ')}{h.fee ? ` · ${t('wal.feeIs', { fee: histFee(h.fee, t) })}` : ''}</small>
                    </div>
                  </div>
                  <div style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                    <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px' }}>
                      {h.amount}{h.coin ? ` ${h.coin}` : ''}
                    </b>
                    {hu != null && <small style={{ display: 'block' }}>≈ ${formatUsd(hu)}</small>}
                  </div>
                </div>
              );
            })}
            {open && shown.length === 0 && <p className="empty">{ready ? t('wal.nothing') : t('wal.loading')}</p>}
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
