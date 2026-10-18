'use client';
import { useEffect, useState } from 'react';
import { referral } from '@/lib/data';
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
  useSheetBack(!!sheet, () => setSheet(null));

  // TODO: build the link from your real referral URL.
  const link = () =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/login?ref=${referral.code}`;

  function copy(text, msg) {
    triggerHaptic('success');
    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
    show(msg);
  }

  async function share() {
    const url = link();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Opus Cloud Mining', text: 'Mine bitcoin without owning a machine.', url });
      } catch {}
      return;
    }
    copy(url, 'Invite link copied');
  }

  function openSheet(name) {
    triggerHaptic('selection');
    setSheet(name);
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
    { icon: ICONS.join, title: 'Friend joins', sub: 'They sign up with it' },
    { icon: ICONS.gift, title: 'You earn', sub: `${referral.ratePct}% reward` },
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
            <span>{referral.ratePct}% reward</span>
          </div>
        </div>

        <div className="grid wal">
          <div className="card">
            <span className="mute eyebrow">Your invite code</span>
            <div className="codebox" style={{ marginTop: 8 }}>
              <b>{referral.code}</b>
              <button className="btn" type="button" onClick={() => copy(referral.code, 'Code copied')}>Copy</button>
            </div>
            <div style={{ height: 12 }} />
            <button className="btn ghost" type="button" onClick={share}>Share link</button>
          </div>

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
            <h3 id="rs">{sheet === 'rules' ? 'Invitation rules' : 'Reward history'}</h3>
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
                      <small>{f.joined}</small>
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
            <button className="btn" type="button" autoFocus onClick={closeSheet}>Done</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
