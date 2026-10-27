'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { halls, CUSTOM, customPlan, thFromPos, fmtTh, fmtUsd, BTC_USD, MIN_WITHDRAW_USD } from '@/lib/data';
import { useApi, post, revalidate } from '@/lib/api';
import RigArt, { rigFor } from '@/components/RigArt';
import { AsicsCard, SmartCard } from '@/components/PowerCards';
import BoostCard from '@/components/BoostCard';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill, useSheetBack } from '@/lib/nav';
import { posFromTh, SLIDER_SIZES } from '@/lib/reinvest';
import { budgetFromPos, posFromBudget } from '@/lib/tiers';
import { dailyCosts, fmtCost } from '@/lib/fees';
import { liveDaily } from '@/lib/market';
import { SMART, smartPlan, smartBand } from '@/lib/smart';
import { applyFirstBonus, bonusText } from '@/lib/first-bonus';
import { fill, useT } from '@/components/I18nProvider';
import { CoinSelect, PayInfo } from '@/components/PayCoin';
import { DEFAULT_PAY } from '@/lib/pay-coins';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function Plans() {
  const t = useT();
  // Catalogue and miners come from the cached API: instant from cache, refreshed quietly.
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: md, refresh } = useApi('/api/miners', { ttl: 10000 });
  const { data: wd } = useApi('/api/wallet', { ttl: 10000 });
  const { data: pd } = useApi('/api/prices', { ttl: 30000 });
  const { data: ord, refresh: refreshOrders } = useApi('/api/orders', { ttl: 10000 });
  const hallMap = cat ? cat.halls : halls;
  // What a plan is expected to pay per day at today's market (the catalogue's static label until the server answers).
  const dailyOf = (p) => {
    if (p.smart) return p.daily;
    const v = liveDaily(p.th, hallMap[p.hall], cat?.live);
    return v === null ? p.daily : `$${v.toFixed(2)}`;
  };
  const list = md ? md.contracts : []; // nothing is shown as a miner until the server has answered
  const nextId = md ? md.nextSerial : '';

  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState(666); // ASICs slider position, about 100 TH/s
  const [aterm, setAterm] = useState(180); // ASICs term
  const [term, setTerm] = useState(120); // Smart Mining term
  const [budget, setBudget] = useState('500'); // Smart Mining budget as typed, in dollars
  const [spos, setSpos] = useState(() => posFromBudget(500)); // Smart Mining slider position
  const [tab, setTab] = useState('buy');
  // The Boost tab shows only while boost tickets are on (or a boost is still running); otherwise the page falls back to Buy plans.
  const { data: bd } = useApi('/api/boost', { ttl: 10000 });
  const boostOn = !!bd && (bd.enabled || (bd.running || []).length > 0);
  // Restored on the Boost tab: wait for /api/boost before deciding, so Buy plans does not flash first.
  const boostWait = tab === 'boost' && !bd;
  // The tab row keeps its place but stays hidden until /api/boost has answered (or 1.5 seconds), so the Boost tab never pops in between the others.
  const [tabsWait, setTabsWait] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTabsWait(false), 1500);
    return () => clearTimeout(t);
  }, []);
  const view = tab === 'boost' && bd && !boostOn ? 'buy' : tab;
  const [dragY, setDragY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [coin, setCoin] = useState(DEFAULT_PAY); // the coin a crypto payment is made in (our own checkout only)
  const [toast, show] = useToast();
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const startY = useRef(null);
  const lock = useRef(null); // what the open sheet keeps fixed once everything has loaded: plan, balance and pay options
  const paying = useRef(false); // set at once on a tap, unlike `busy`, which only changes on the next render
  const payKey = useRef(null); // idempotency key of the purchase in progress: { sig, key }
  // The pay buttons wait until the catalogue, miners, wallet and orders have answered (or 4 seconds, if one never does).
  const [slow, setSlow] = useState(false);
  const ready = !!(cat && md && wd && ord) || slow;
  useEffect(() => {
    if (!sel) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [sel]);
  // What the two cards show, and what the sheet confirms: the ASICs pick and the Smart Mining pick.
  const bNum = Math.min(SMART.max, Math.max(SMART.min, Math.round(Number(budget)) || SMART.min));
  const ap = customPlan(thFromPos(pos), aterm, hallMap);
  const sp = smartPlan(bNum, term, cat?.smartTable);
  // The balance that can pay for a plan, in USD at the live rate (the server checks again with its own rate).
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * (pd?.prices?.btc ?? BTC_USD) : 0;
  // The plan on the sheet: Smart Mining or an ASICs pick. Once everything has loaded, the sheet keeps the plan, balance and pay
  // options it opened with, so a price or a button never changes under a finger.
  const liveCur = sel ? (sel.id === 'smart' ? sp : sel.id === 'custom' ? ap : sel) : null;
  if (!sel) lock.current = null;
  else if (ready && !lock.current) lock.current = { plan: liveCur, bal: balUsd, crypto: !!ord?.crypto };
  const cur = sel ? lock.current?.plan || liveCur : null;
  const hall = cur ? hallMap[cur.hall] || null : null;
  const costs = cur && hall ? dailyCosts(cur.th, hall) : null; // already taken out of the mining, never billed
  // Smart Mining: the profit a day is held between the bottom and the top of the reserve band (lib/smart.js), so the term's profit
  // is estimated as that band over the whole term. An estimate, not a promise: a weak market can pay less, a strong one more.
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const profitRange = cur?.smart ? smartBand(cur) : null; // { low, mid, high } from lib/smart.js
  const sheetBal = lock.current ? lock.current.bal : balUsd;
  const canBal = !!cur && sheetBal >= cur.price;
  const crypto = lock.current ? lock.current.crypto : !!ord?.crypto;
  const methods = canBal ? ['balance', ...(crypto ? ['crypto'] : [])] : crypto ? ['crypto'] : ['balance'];
  // The first-buy bonus is shown when crypto is the only way to pay (a first buy from the balance gets none).
  const fb = cur && md?.firstBonus && crypto && !canBal ? applyFirstBonus(md.firstBonus, cur) : null;

  // Smart Mining amount box and slider keep each other in step.
  const onAmount = (v) => {
    setBudget(v);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= SMART.min) setSpos(posFromBudget(n));
  };
  const onAmountBlur = () => {
    setBudget(String(bNum));
    setSpos(posFromBudget(bNum));
  };
  const onSlide = (v) => {
    setSpos(v);
    setBudget(String(budgetFromPos(v)));
  };

  function selectPlan(p) {
    triggerHaptic('selection');
    openerRef.current = document.activeElement;
    payKey.current = null;
    setSel(p);
  }

  // Close the sheet and give focus back to the button that opened it.
  function dismiss() {
    setSel(null);
    setDragY(0);
    startY.current = null;
    payKey.current = null;
    const el = openerRef.current;
    if (el && el.focus) el.focus();
  }

  function closeModal() {
    triggerHaptic('light');
    dismiss();
  }

  const pending = (ord?.orders || []).filter((o) => o.status === 'pending');
  const review = (ord?.orders || []).filter((o) => o.status === 'review');

  // Pays by the chosen method. Balance and the demo account activate at once; crypto leaves for the payment page.
  async function pay(method) {
    if (paying.current || busy || !ready) return;
    paying.current = true;
    const plan = cur;
    setBusy(true);
    let leaving = false;
    try {
      const body = plan.smart
        ? { planId: 'smart', budget: plan.budget, days: plan.days, pay: method }
        : plan.id === 'custom'
          ? { planId: 'custom', th: plan.th, days: plan.days, pay: method }
          : { planId: plan.id, pay: method };
      if (method === 'crypto' && ord?.multi) {
        body.asset = coin.asset;
        body.network = coin.net;
      }
      // One key per plan, size, term, coin and method: a retry after a lost answer repeats the same purchase instead of making a second one.
      const sig = JSON.stringify(body);
      if (payKey.current?.sig !== sig) payKey.current = { sig, key: uid() };
      const r = await post('/api/plans/buy', body, payKey.current.key);
      if (r.pending && r.order?.url) {
        leaving = true;
        window.location.assign(r.order.url);
        return;
      }
      if (r.pending && r.order?.address) {
        await refreshOrders().catch(() => {});
        show(t('pay.sendExact'));
        dismiss();
        return;
      }
      await refresh().catch(() => {});
      triggerHaptic('success');
      show(plan.smart ? t('plans.smartStarted') : plan.id === 'custom' ? t('plans.asicsActivated') : t('plans.planActivated', { name: plan.name }));
      dismiss();
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : t('common.noConnection'));
      if (!e.status) refresh().catch(() => {}); // the answer may have been lost after the purchase went through: look
    } finally {
      if (!leaving) {
        paying.current = false;
        setBusy(false);
        revalidate('/api/wallet').catch(() => {});
        refreshOrders().catch(() => {});
      }
    }
  }

  async function cancelOrder(id) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : t('common.noConnection'));
    }
    refreshOrders().catch(() => {});
  }

  // While a payment is open, check for it every few seconds. When one turns paid, say so and refresh the miners.
  const seen = useRef(new Set());
  useEffect(() => {
    if (!pending.length) return undefined;
    const t = setInterval(() => refreshOrders().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [pending.length]);
  useEffect(() => {
    if (!ord) return;
    const ids = new Set(pending.map((o) => o.id));
    for (const id of seen.current) {
      if (!ids.has(id) && ord.orders.find((o) => o.id === id)?.status === 'paid') {
        triggerHaptic('success');
        show(t('plans.paid'));
        refresh().catch(() => {});
        revalidate('/api/wallet').catch(() => {});
      }
    }
    seen.current = ids;
  }, [ord]);

  useSheetBack(!!sel, dismiss);

  // Back from the payment page can restore this page exactly as it was left (sheet open, buttons disabled): free it and show the open order.
  useEffect(() => {
    const back = (e) => {
      if (!e.persisted) return;
      paying.current = false;
      setBusy(false);
      dismiss();
      refreshOrders().catch(() => {});
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  // Coming back from a miner page, or from the Boost card on the landing page: reopen on that tab.
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('opus-plans-tab');
      if (t === 'mine' || t === 'boost') {
        sessionStorage.removeItem('opus-plans-tab');
        setTab(t);
      }
    } catch {}
  }, []);

  // Coming from a Reinvest card or the calculator: /plans?plan=<id> opens that plan's sheet once the catalogue has loaded.
  // /plans?plan=custom&th=24&days=180 sets the ASICs card to that size and term and opens its sheet.
  // /plans?plan=smart&budget=500&days=120 does the same for Smart Mining.
  const deepPlan = useRef(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get('plan');
      if (id) {
        deepPlan.current = { id, th: parseFloat(q.get('th')), days: parseInt(q.get('days'), 10), budget: parseInt(q.get('budget'), 10) };
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!deepPlan.current || !cat) return;
    const { id, th, days, budget: b } = deepPlan.current;
    deepPlan.current = null;
    if (id === 'smart') {
      setTab('buy');
      if (Number.isInteger(b)) {
        const n = Math.min(SMART.max, Math.max(SMART.min, b));
        setBudget(String(n));
        setSpos(posFromBudget(n));
      }
      if (SMART.terms.includes(days)) setTerm(days);
      setSel({ id: 'smart' });
      return;
    }
    if (id === 'custom') {
      setTab('buy');
      if (SLIDER_SIZES.includes(th)) setPos(posFromTh(th));
      if (CUSTOM.terms.includes(days)) setAterm(days);
      setSel({ id: 'custom' });
    }
  }, [cat]);

  function openMiner() {
    try {
      sessionStorage.setItem('opus-plans-tab', 'mine');
    } catch {}
    markDrill();
  }

  // While the sheet is open: Escape closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      } else if (e.key === 'Tab') {
        const f = sheetRef.current ? sheetRef.current.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])') : [];
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [sel]);

  return (
    <>
      <div className="top">
        <h2>{t('nav.plans')}</h2>
      </div>

      <div className="tabs" role="group" aria-label={t('plans.aria')} style={bd || !tabsWait ? undefined : { visibility: 'hidden' }}>
        <button aria-pressed={view === 'buy'} onClick={() => setTab('buy')}>{t('plans.buy')}</button>
        {boostOn && <button aria-pressed={view === 'boost'} onClick={() => setTab('boost')}>{t('boost.title')}</button>}
        <button aria-pressed={view === 'mine'} onClick={() => setTab('mine')}>{t('plans.myMiners')}{md ? ` · ${list.length}` : ''}</button>
      </div>

      {view === 'buy' && [...pending, ...review].map((o) => (
        <div key={o.id} className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div>
              <b>{o.status === 'review' ? t('plans.needCheck') : t('plans.waiting')}</b>
              <small style={{ display: 'block' }}>{o.label} · ${fmtUsd(o.usd)}</small>
              {o.status === 'pending' && o.address && <PayInfo order={o} show={show} />}
            </div>
            {o.status === 'pending' && (
              <div>
                {o.url && <a className="linkbtn" href={o.url} style={{ display: 'inline-flex', alignItems: 'center' }}>{t('plans.pay')}</a>}
                <button type="button" className="linkbtn" onClick={() => cancelOrder(o.id)}>{t('common.cancel')}</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {view === 'boost' && boostWait ? null : view === 'boost' ? (
        <BoostCard show={show} />
      ) : view === 'buy' ? (
      <>
      {cat?.smartOn !== false && (
        <SmartCard
          budget={budget}
          bNum={bNum}
          spos={spos}
          term={term}
          setTerm={setTerm}
          plan={sp}
          within={balUsd >= sp.price}
          onAmount={onAmount}
          onAmountBlur={onAmountBlur}
          onSlide={onSlide}
          onBuy={() => selectPlan({ id: 'smart' })}
        />
      )}
      <AsicsCard
        pos={pos}
        setPos={setPos}
        term={aterm}
        setTerm={setAterm}
        plan={ap}
        daily={dailyOf(ap)}
        hall={hallMap[ap.hall] || null}
        within={balUsd >= ap.price}
        onBuy={() => selectPlan({ id: 'custom' })}
      />
      </>
      ) : list.length ? (
        <div className="clist">
          {list.map((c) => {
            const pct = Math.round((c.elapsed / c.days) * 100);
            const rig = rigFor(c);
            return (
              <Link key={c.serial} href={`/miners/${c.serial}`} onClick={openMiner} className="card cl">
                <div className="crow">
                  <RigArt units={rig.units} speed={rig.speed} id={c.serial} />
                  <div className="mi">
                    <div className="mt">
                      <i className={`sdot${c.online && !c.paused ? '' : ' off'}`} />
                      <b>{c.plan}</b>
                      <svg className="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <span className="serial">{c.serial}</span>
                    <div className="mchips">
                      <span>{c.smart ? t('plans.budgetN', { n: fmtUsd(c.budget) }) : `${c.th} TH/s`}</span>
                      <span>{c.smart ? t('plans.bestCoin') : hallMap[c.hall].efficiency}</span>
                      {c.paused ? <span>{t('plans.pausedToday')}</span> : <span className="up">+${c.dailyUsd.toFixed(2)}/{t('calc.day')}</span>}
                    </div>
                  </div>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="cmeta">
                  <span>{t('plans.dayOf', { e: c.elapsed, d: c.days })}</span>
                  <span>{t('plans.ends', { x: c.ends })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : md ? (
        <div className="card">
          <p className="empty">{t('plans.noMiners')}</p>
          <button className="swap" onClick={() => setTab('buy')}>{t('plans.buyOne')}</button>
        </div>
      ) : null}

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
          <div
            className="card pinned"
            ref={sheetRef}
            style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
            onTouchStart={(e) => {
              startY.current = e.target.closest?.('.sheetscroll')?.scrollTop > 0 ? null : e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              if (startY.current === null) return;
              setDragY(Math.max(0, e.touches[0].clientY - startY.current));
            }}
            onTouchEnd={() => {
              if (dragY > 90) closeModal();
              else setDragY(0);
              startY.current = null;
            }}
          >
            <div className="sheetscroll">
            <div className="grab" aria-hidden="true" />
            <h3 id="st">{cur.smart ? t('dash.smart') : cur.id === 'custom' ? 'ASICs' : t('plans.planName', { name: cur.name })}</h3>
            <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>
              {cur.smart
                ? t('plans.smartLine', { n: fmtUsd(cur.budget), d: cur.days })
                : cur.id === 'custom'
                  ? t('plans.asicsLine', { th: fmtTh(cur.th), d: cur.days })
                  : cur.blurb}
            </p>
            <div className="sheetbody">
              {hall ? (
                <>
                  <div className="row">
                    <span className="mute">{t('dash.hall')}</span>
                    <b className="v">{hall.name}<small>{hall.power}</small></b>
                  </div>
                  <div className="row">
                    <span className="mute">{t('plans.rig')}</span>
                    <b className="v">{hall.rig}<small>{hall.efficiency}</small></b>
                  </div>
                </>
              ) : null}
              {costs ? (
                <>
                  <div className="row">
                    <span className="mute">{t('plans.elec')}</span>
                    <b className="v">~${fmtCost(costs.elec)}/{t('calc.day')}<small>{t('plans.taken')}</small></b>
                  </div>
                  <div className="row">
                    <span className="mute">{t('plans.maint')}</span>
                    <b className="v">~${fmtCost(costs.maint)}/{t('calc.day')}<small>{t('plans.taken')}</small></b>
                  </div>
                </>
              ) : null}
              <div className="row">
                <span className="mute">{t('plans.minerId')}</span>
                <b className="serial">{nextId || '...'}</b>
              </div>
              {fb && (
                <div className="row">
                  <span className="mute">{t('plans.firstBonus')}</span>
                  <b className="v" style={{ color: 'var(--green)' }}>{t('plans.bonusLine', { b: bonusText(fb.bonus) })}<small>{t('plans.fullTerm')}</small></b>
                </div>
              )}
              <div className="row" style={{ borderTop: '1px solid rgba(233, 196, 106, 0.25)' }}>
                <span className="mute" style={{ fontWeight: 600 }}>{t('plans.due')}</span>
                <b style={{ color: 'var(--gold2)', fontSize: '20px' }}>${fmtUsd(cur.price)}</b>
              </div>
              <div className="row">
                <span className="mute">{t('plans.balance')}</span>
                <b className="v">${fmtUsd(sheetBal)}</b>
              </div>
              <div className="row">
                <span className="mute">{t('dash.perDayCap')}</span>
                <b className="v">~{dailyOf(cur)}/{t('calc.day')}</b>
              </div>
              {profitRange && (
                <div className="row">
                  <span className="mute">{t('plans.profit')}</span>
                  <b className="v" style={{ color: 'var(--green)' }}>{t('plans.about', { n: money(profitRange.mid) })}<small>{t('plans.range', { a: money(profitRange.low), b: money(profitRange.high) })}</small></b>
                </div>
              )}
              {profitRange && (
                <div className="row">
                  <span className="mute">{t('plans.totalEnd')}</span>
                  <b className="v">{t('plans.about', { n: money(cur.budget + profitRange.mid) })}<small>{t('plans.budgetProfit')}</small></b>
                </div>
              )}
            </div>
            <p className="fine" style={{ margin: '-8px 0 12px' }}>
              {fill(t('plans.fine', { n: MIN_WITHDRAW_USD }), { terms: <Link href="/terms">{t('auth.terms')}</Link> })}
            </p>
            {ready && !canBal && (
              <p className="fine" style={{ margin: '-4px 0 0' }}>
                {!crypto
                  ? t('plans.noBalance')
                  : t('plans.short', { n: fmtUsd(cur.price - sheetBal) })}
              </p>
            )}
            </div>
            <div className="sheetfoot">
            {ready && ord?.multi && methods.includes('crypto') && (
              <CoinSelect value={coin} onChange={setCoin} disabled={busy} />
            )}
            {!ready ? (
              <button className="btn" type="button" disabled>{t('plans.loading')}</button>
            ) : (
              methods.map((m, i) => (
                <button key={m} className={i === 0 ? 'btn' : 'swap'} autoFocus={i === 0} onClick={() => pay(m)} disabled={busy || (m === 'balance' && !canBal)}>
                  {m === 'balance' ? t('plans.payBalance') : t('plans.payCrypto')}
                </button>
              ))
            )}
            <button className="swap" type="button" onClick={closeModal}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
