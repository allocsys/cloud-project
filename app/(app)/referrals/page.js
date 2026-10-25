'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { referral as seed } from '@/lib/data';
import { useApi, post } from '@/lib/api';
import Field from '@/components/Field';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { useSheetBack } from '@/lib/nav';
import { useT } from '@/components/I18nProvider';

const ICONS = {
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  join: 'M15 8a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 016-6h2a6 6 0 016 6v1M19 8v6M16 11h6',
  gift: 'M3 11h18v10H3zM2 7h20v4H2zM12 7v14M12 7c-1-3-5-3.5-5-1.5S10 7 12 7zM12 7c1-3 5-3.5 5-1.5S14 7 12 7z',
  rules: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2',
};

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// True while the element is on screen, so its animations can pause when it is not.
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

export default function Referrals() {
  const t = useT();
  const [toast, show] = useToast();
  const [heroRef, heroSeen] = useSeen();
  const [stepsRef, stepsSeen] = useSeen();
  const [sheet, setSheet] = useState(null);
  const { data: rd, mutate } = useApi('/api/referrals', { ttl: 0 });
  const referral = rd || seed;
  const [name, setName] = useState('');
  const [pct, setPct] = useState(10);
  const [edit, setEdit] = useState(null); // the code being edited
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const maxPct = referral.limits?.maxRebate ?? 50;
  const codes = referral.codes || [{ code: referral.code, name: 'Default', rebate: 0, default: true, friends: referral.friends.length, earnedBtc: referral.earnedBtc }];
  const canAdd = codes.length < (referral.limits?.maxCodes ?? 5);
  const presets = [0, 5, 10, 20].filter((p) => p <= maxPct);
  const locked = !!rd && rd.unlocked === false;
  // The cards keep their place but stay hidden until the referral data is in (or 1.5 seconds), so the free-invites and rebate cards never pop in and sample numbers never flash.
  const [calmWait, setCalmWait] = useState(true);
  useEffect(() => {
    const tm = setTimeout(() => setCalmWait(false), 1500);
    return () => clearTimeout(tm);
  }, []);
  const hideCalm = rd ? undefined : calmWait ? { visibility: 'hidden' } : undefined;
  useSheetBack(!!sheet, () => setSheet(null));

  // Links use the public address the server reports (APP_URL); the current origin is only a fallback.
  const link = (code) =>
    `${referral.linkBase || (typeof window !== 'undefined' ? window.location.origin : '')}/login?ref=${encodeURIComponent(code)}`;

  function copy(text, msg) {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    show(msg);
  }

  async function share(code) {
    const url = link(code);
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Miner Opus', text: t('ref.shareText'), url });
      } catch {}
      return;
    }
    copy(url, t('ref.linkCopied'));
  }

  function openSheet(name) {
    triggerHaptic('selection');
    setErr('');
    setSheet(name);
  }

  function openNew() {
    setName('');
    setPct(Math.min(10, maxPct));
    openSheet('new');
  }

  function openEdit(c) {
    setEdit(c);
    setPct(c.rebate);
    openSheet('edit');
  }

  // Create, raise or remove a code. The server answers with the refreshed referral data.
  async function manage(body, msg) {
    setBusy(true);
    setErr('');
    try {
      const res = await post('/api/referrals', body);
      mutate(res);
      triggerHaptic('success');
      setSheet(null);
      show(msg);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function closeSheet() {
    triggerHaptic('light');
    setSheet(null);
  }

  // While a sheet is open: Escape closes and the page behind does not scroll.
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSheet(null);
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [sheet]);

  const active = referral.friends.filter((f) => f.status === 'active').length;

  const rewardText = referral.rewardV ? t('ref.reward', referral.rewardV) : referral.reward;
  const giftText = referral.giftV ? t('ref.giftLine', referral.giftV) : referral.gift;
  const steps = [
    { icon: ICONS.share, title: t('ref.share'), sub: t('ref.sendCode') },
    { icon: ICONS.join, title: t('ref.joins'), sub: giftText ? t('ref.gets', { gift: giftText }) : t('ref.signsUp') },
    { icon: ICONS.gift, title: t('ref.youEarn'), sub: rewardText },
  ];

  return (
    <>
      <style>{'.rhero{position:relative;overflow:hidden}.rshine{position:absolute;top:0;bottom:0;left:0;width:45%;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.1),transparent);animation:rShine 8s ease-in-out infinite}@keyframes rShine{0%,55%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(330%) skewX(-18deg)}}.steps3 .sico{position:relative}.steps3 .sico::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;border-radius:inherit;border:1.5px solid var(--gold2);opacity:0;animation:rPing 4.5s ease-out infinite}.steps3 .st:nth-child(2) .sico::after{animation-delay:1.5s}.steps3 .st:nth-child(3) .sico::after{animation-delay:3s}@keyframes rPing{0%{transform:scale(.9);opacity:.7}30%,100%{transform:scale(1.6);opacity:0}}.rpause .rshine,.rpause .sico::after{animation-play-state:paused}'}</style>
      <div className="top">
        <h2>{t('nav.invite')}</h2>
      </div>
      <div className="grid rise">
        <div ref={heroRef} className={`card hero rhero${heroSeen ? '' : ' rpause'}`} style={hideCalm}>
          <i className="rshine" aria-hidden="true" />
          <span className="mute eyebrow">{t('ref.earnings')}</span>
          <div className="big">
            {referral.earnedBtc}
            <small>BTC</small>
          </div>
          <div className="chips">
            <span>{t('ref.invited', { n: referral.friends.length })}</span>
            <span>{t('ref.active', { n: active })}</span>
            <span>{rewardText}</span>
          </div>
        </div>

        <div className="grid wal" style={hideCalm}>
          {locked && (
            <div className="card">
              <span className="mute eyebrow">{t('ref.freeInvites')}</span>
              <p style={{ margin: '8px 0 12px' }}>
                {rd.left > 0
                  ? t(rd.left === 1 ? 'ref.left1' : 'ref.leftN', { left: rd.left, invited: rd.invited, free: rd.freeInvites })
                  : t('ref.usedAll', { free: rd.freeInvites })}
              </p>
              <Link href="/plans" className="btn" style={{ textDecoration: 'none' }} onClick={() => triggerHaptic('selection')}>{t('plans.buyOne')}</Link>
            </div>
          )}
          <div className="card">
              <span className="mute eyebrow">{t('ref.codes')}</span>
              {codes.map((c) => (
                <div key={c.code} className="icode">
                  <div className="itop">
                    <b>{c.name}</b>
                    <span className={`badge ${c.rebate ? 'ok' : ''}`}>{c.rebate ? t('ref.rebateN', { n: c.rebate }) : t('ref.noRebate')}</span>
                  </div>
                  <div className="codebox">
                    <b>{rd ? c.code : '········'}</b>
                    <button className="btn" type="button" disabled={!rd} onClick={() => copy(c.code, t('ref.codeCopied'))}>{t('ref.copy')}</button>
                  </div>
                  <div className="iact">
                    <small>{t(c.friends === 1 ? 'dash.friend' : 'dash.friends', { n: c.friends })}</small>
                    <span>
                      <button className="linkbtn" type="button" disabled={!rd} onClick={() => share(c.code)}>{t('ref.share')}</button>
                      {!c.default && <button className="linkbtn" type="button" onClick={() => openEdit(c)}>{t('ref.edit')}</button>}
                    </span>
                  </div>
                </div>
              ))}
              {canAdd && rd && !locked && <button className="btn ghost" type="button" style={{ marginTop: 12 }} onClick={openNew}>{t('ref.new')}</button>}
            </div>

          {referral.rebate && (
            <div className="card">
              <span className="mute eyebrow">{t('ref.yourRebate')}</span>
              <div className="irebate">
                <b>{referral.rebate.pct}%</b>
                <span>{t('ref.rebateLine', { btc: referral.rebate.btc })}</span>
              </div>
            </div>
          )}

          <div className="card">
            <h3>{t('ref.how')}</h3>
            <div ref={stepsRef} className={`steps3${stepsSeen ? '' : ' rpause'}`}>
              {steps.map((s) => (
                <div key={s.title} className="st">
                  <span className="sico"><Icon d={s.icon} /></span>
                  <b>{s.title}</b>
                  <span>{s.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="linkrow" style={hideCalm}>
          <button type="button" className="linktile" onClick={() => openSheet('rules')}>
            <span className="sico"><Icon d={ICONS.rules} /></span>
            <b>{t('ref.rules')}</b>
            <span className="sub">{t('ref.check')}</span>
          </button>
          <button type="button" className="linktile" onClick={() => openSheet('history')}>
            <span className="sico"><Icon d={ICONS.history} /></span>
            <b>{t('ref.history')}</b>
            <span className="sub">{t('dash.friends', { n: referral.friends.length })}</span>
          </button>
        </div>
      </div>

      {sheet && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet();
          }}
        >
          <div className="card">
            <div className="grab" aria-hidden="true" />
            <h3 id="rs">{sheet === 'rules' ? t('ref.rules') : sheet === 'history' ? t('ref.history') : sheet === 'new' ? t('ref.new') : edit?.name}</h3>
            <div className="sheetbody">
              {sheet === 'rules' &&
                referral.rules.map((r) => (
                  <div key={r} className="row" style={{ alignItems: 'flex-start' }}>
                    <span>{r}</span>
                  </div>
                ))}
              {sheet === 'history' && referral.friends.length === 0 && <div className="empty">{t('ref.noInvites')}</div>}
              {sheet === 'history' &&
                referral.friends.map((f) => (
                  <div key={f.id} className="row">
                    <div>
                      <div style={{ fontWeight: 500 }}>{f.who}</div>
                      <small>{f.joined}{f.rebate > 0 ? ` · ${t('ref.rebateN', { n: f.rebate })}` : ''}</small>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <b className={f.earned === '+0' ? '' : 'up'} style={{ fontVariantNumeric: 'tabular-nums' }}>{f.earned}</b>
                      <div>
                        <span className={`badge ${f.status === 'active' ? 'ok' : ''}`}>
                          {f.status === 'active' ? t('ref.stActive') : t('ref.stPending')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            {(sheet === 'new' || sheet === 'edit') && (() => {
              const min = sheet === 'edit' ? edit.rebate : 0;
              return (
                <div className="sheetbody">
                  {sheet === 'new' && (
                    <Field id="cname" label={t('ref.name')} error={err && !name.trim() ? err : ''}>
                      <input id="cname" value={name} maxLength={20} placeholder={t('ref.name')} autoComplete="off" onChange={(e) => setName(e.target.value)} />
                    </Field>
                  )}
                  <div className="slide">
                    <div className="big"><b>{t('ref.rebateN', { n: pct })}</b><span>{t('ref.keep', { n: 100 - pct })}</span></div>
                    {min < maxPct && (
                      <>
                        <input
                          type="range"
                          min={min}
                          max={maxPct}
                          step="1"
                          value={pct}
                          aria-label={t('ref.pctAria')}
                          style={{ '--p': `${((pct - min) / (maxPct - min)) * 100}%` }}
                          onChange={(e) => setPct(+e.target.value)}
                        />
                        <div className="terms" role="group" aria-label={t('ref.quickAria')}>
                          {presets.filter((p) => p >= min).map((p) => (
                            <button key={p} type="button" aria-pressed={pct === p} onClick={() => { triggerHaptic('selection'); setPct(p); }}>{p}%</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <p className="fine" style={{ margin: '12px 0' }}>
                    {t('ref.fine', { pct })}
                  </p>
                  {err && (sheet === 'edit' || name.trim()) && <div className="ferr" role="alert">{err}</div>}
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || (sheet === 'new' && !name.trim()) || (sheet === 'edit' && pct === min)}
                    onClick={() => (sheet === 'new' ? manage({ action: 'create', name, rebate: pct }, t('ref.created')) : manage({ action: 'raise', code: edit.code, rebate: pct }, t('ref.raised')))}
                  >
                    {sheet === 'new' ? t('ref.create') : t('ref.raise')}
                  </button>
                  {sheet === 'edit' && edit.friends === 0 && (
                    <button className="btn ghost" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => manage({ action: 'delete', code: edit.code }, t('ref.removed'))}>{t('ref.remove')}</button>
                  )}
                </div>
              );
            })()}
            <button className="btn ghost" type="button" autoFocus onClick={closeSheet} style={{ marginTop: 8 }}>{sheet === 'new' || sheet === 'edit' ? t('common.cancel') : t('common.done')}</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
