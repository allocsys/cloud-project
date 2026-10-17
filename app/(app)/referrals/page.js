'use client';
import { referral } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

const STEPS = [
  ['Share your link', 'Send your code or link to a friend.'],
  ['They start mining', 'They sign up and buy any plan.'],
  ['You earn', `Get ${referral.ratePct}% of their plan price, paid in BTC.`],
];

export default function Referrals() {
  const [toast, show] = useToast();

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
        return;
      } catch {
        return;
      }
    }
    copy(url, 'Invite link copied');
  }

  const active = referral.friends.filter((f) => f.status === 'active').length;

  return (
    <>
      <div className="top">
        <h2>Invite friends</h2>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Referral earnings</span>
          <div className="big">
            {referral.earnedBtc}
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>
            {referral.friends.length} invited · {active} active · {referral.ratePct}% reward
          </span>
        </div>

        <div className="grid wal">
          <div className="card">
            <div className="cardhead">
              <h3>Your code</h3>
            </div>
            <div className="addr" style={{ textAlign: 'center', fontSize: '18px', letterSpacing: '0.12em' }}>
              {referral.code}
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <button className="btn" type="button" onClick={share}>Share invite link</button>
              <button className="btn ghost" type="button" onClick={() => copy(referral.code, 'Code copied')}>
                Copy code
              </button>
            </div>
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>How it works</h3>
            </div>
            <ol className="steps">
              {STEPS.map(([t, d]) => (
                <li key={t}>
                  <div>
                    <b style={{ fontWeight: 600 }}>{t}</b>
                    <small>{d}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h3>Your friends</h3>
            <span className="mute">{referral.friends.length} total</span>
          </div>
          {referral.friends.length === 0 && <div className="empty">No invites yet. Share your link to get started.</div>}
          {referral.friends.map((f) => (
            <div key={f.id} className="row">
              <div>
                <div style={{ fontWeight: 500 }}>{f.who}</div>
                <small>Joined {f.joined}</small>
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
      </div>
      {toast}
    </>
  );
}
