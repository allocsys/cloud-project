'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { referral as seed } from '@/lib/data';
import { useApi, post } from '@/lib/api';
import Field from '@/components/Field';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { useSheetBack } from '@/lib/nav';

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

export default function Referrals() {
  const [toast, show] = useToast();
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
  useSheetBack(!!sheet, () => setSheet(null));

  // TODO: build the link from your real referral URL.
  const link = (code) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/login?ref=${code}`;

  function copy(text, msg) {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    show(msg);
  }

  async function share(code) {
    const url = link(code);
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Miner Opus', text: 'Mine bitcoin without owning a machine.', url });
      } catch {}
      return;
    }
    copy(url, 'Invite link copied');
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

  const steps = [
    { icon: ICONS.share, title: 'Share', sub: 'Send your code' },
    { icon: ICONS.join, title: 'Friend joins', sub: referral.gift ? `Gets ${referral.gift}` : 'They sign up with it' },
    { icon: ICONS.gift, title: 'You earn', sub: referral.reward },
  ];

  return (
    <>
      <div className="top">
        <h2>Invite</h2>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Referral earnings</span>
          <div className="big">
            {referral.earnedBtc}
            <small>BTC</small>
          </div>
          <div className="chips">
            <span>{referral.friends.length} invited</span>
            <span>{active} active</span>
            <span>{referral.reward}</span>
          </div>
        </div>

        <div className="grid wal">
          {locked ? (
            <div className="card">
              <span className="mute eyebrow">Invites locked</span>
              <p style={{ margin: '8px 0 12px' }}>
                Buy any plan, or at least ${rd.minUsd} of custom power, to get your invite code.
              </p>
              <div className="bar" role="progressbar" aria-valuenow={rd.spentUsd} aria-valuemin={0} aria-valuemax={rd.minUsd} aria-label="Custom power bought toward the minimum">
                <i style={{ width: `${Math.round((rd.spentUsd / rd.minUsd) * 100)}%` }} />
              </div>
              <small className="mute" style={{ display: 'block', margin: '6px 0 12px' }}>
                ${rd.spentUsd.toFixed(2)} of ${rd.minUsd} custom power
              </small>
              <Link href="/plans" className="btn" style={{ textDecoration: 'none' }} onClick={() => triggerHaptic('selection')}>Buy a plan</Link>
            </div>
          ) : (
            <div className="card">
              <span className="mute eyebrow">Your invite codes</span>
              {codes.map((c) => (
                <div key={c.code} className="icode">
                  <div className="itop">
                    <b>{c.name}</b>
                    <span className={`badge ${c.rebate ? 'ok' : ''}`}>{c.rebate ? `${c.rebate}% rebate` : 'No rebate'}</span>
                  </div>
                  <div className="codebox">
                    <b>{rd ? c.code : '········'}</b>
                    <button className="btn" type="button" disabled={!rd} onClick={() => copy(c.code, 'Code copied')}>Copy</button>
                  </div>
                  <div className="iact">
                    <small>{c.friends} {c.friends === 1 ? 'friend' : 'friends'}</small>
                    <span>
                      <button className="linkbtn" type="button" disabled={!rd} onClick={() => share(c.code)}>Share</button>
                      {!c.default && <button className="linkbtn" type="button" onClick={() => openEdit(c)}>Edit</button>}
                    </span>
                  </div>
                </div>
              ))}
              {canAdd && rd && <button className="btn ghost" type="button" style={{ marginTop: 12 }} onClick={openNew}>New code</button>}
            </div>
          )}

          {referral.rebate && (
            <div className="card">
              <span className="mute eyebrow">Your rebate</span>
              <div className="irebate">
                <b>{referral.rebate.pct}%</b>
                <span>of what your inviter earns from you comes back to you: +{referral.rebate.btc} BTC so far</span>
              </div>
            </div>
          )}

          <div className="card">
            <h3>How it works</h3>
            <div className="steps3">
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

        <div className="linkrow">
          <button type="button" className="linktile" onClick={() => openSheet('rules')}>
            <span className="sico"><Icon d={ICONS.rules} /></span>
            <b>Invitation rules</b>
            <span className="sub">Check the terms</span>
          </button>
          <button type="button" className="linktile" onClick={() => openSheet('history')}>
            <span className="sico"><Icon d={ICONS.history} /></span>
            <b>Reward history</b>
            <span className="sub">{referral.friends.length} friends</span>
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
            <h3 id="rs">{sheet === 'rules' ? 'Invitation rules' : sheet === 'history' ? 'Reward history' : sheet === 'new' ? 'New code' : edit?.name}</h3>
            <div className="sheetbody">
              {sheet === 'rules' &&
                referral.rules.map((r) => (
                  <div key={r} className="row" style={{ alignItems: 'flex-start' }}>
                    <span>{r}</span>
                  </div>
                ))}
              {sheet === 'history' && referral.friends.length === 0 && <div className="empty">No invites yet.</div>}
              {sheet === 'history' &&
                referral.friends.map((f) => (
                  <div key={f.id} className="row">
                    <div>
                      <div style={{ fontWeight: 500 }}>{f.who}</div>
                      <small>{f.joined}{f.rebate > 0 ? ` · ${f.rebate}% rebate` : ''}</small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <b className={f.earned === '+0' ? '' : 'up'} style={{ fontVariantNumeric: 'tabular-nums' }}>{f.earned}</b>
                      <div>
                        <span className={`badge ${f.status === 'active' ? 'ok' : ''}`}>
                          {f.status === 'active' ? 'Active' : 'Pending'}
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
                    <Field id="cname" label="Name" error={err && !name.trim() ? err : ''}>
                      <input id="cname" value={name} maxLength={20} placeholder="Name" autoComplete="off" onChange={(e) => setName(e.target.value)} />
                    </Field>
                  )}
                  <div className="slide">
                    <div className="big"><b>{pct}% rebate</b><span>you keep {100 - pct}%</span></div>
                    {min < maxPct && (
                      <>
                        <input
                          type="range"
                          min={min}
                          max={maxPct}
                          step="1"
                          value={pct}
                          aria-label="Rebate percent"
                          style={{ '--p': `${((pct - min) / (maxPct - min)) * 100}%` }}
                          onChange={(e) => setPct(+e.target.value)}
                        />
                        <div className="terms" role="group" aria-label="Quick rebate">
                          {presets.filter((p) => p >= min).map((p) => (
                            <button key={p} type="button" aria-pressed={pct === p} onClick={() => { triggerHaptic('selection'); setPct(p); }}>{p}%</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <p className="fine" style={{ margin: '12px 0' }}>
                    Friends who join with this code get {pct}% of what you earn from them. They keep their rate, and you can only raise it later.
                  </p>
                  {err && (sheet === 'edit' || name.trim()) && <div className="ferr" role="alert">{err}</div>}
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || (sheet === 'new' && !name.trim()) || (sheet === 'edit' && pct === min)}
                    onClick={() => (sheet === 'new' ? manage({ action: 'create', name, rebate: pct }, 'Code created') : manage({ action: 'raise', code: edit.code, rebate: pct }, 'Rebate raised'))}
                  >
                    {sheet === 'new' ? 'Create code' : 'Raise rebate'}
                  </button>
                  {sheet === 'edit' && edit.friends === 0 && (
                    <button className="btn ghost" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => manage({ action: 'delete', code: edit.code }, 'Code removed')}>Remove code</button>
                  )}
                </div>
              );
            })()}
            <button className="btn ghost" type="button" autoFocus onClick={closeSheet} style={{ marginTop: 8 }}>{sheet === 'new' || sheet === 'edit' ? 'Cancel' : 'Done'}</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
