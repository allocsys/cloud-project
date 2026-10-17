'use client';
import { referral } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

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
      } catch {}
      return;
    }
    copy(url, 'Invite link copied');
  }

  const active = referral.friends.filter((f) => f.status === 'active').length;

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
            <div className="addr" style={{ textAlign: 'center', fontSize: '17px', letterSpacing: '0.12em', margin: '0 0 10px' }}>
              {referral.code}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button className="btn" type="button" onClick={share}>Share link</button>
              <button className="btn ghost" type="button" onClick={() => copy(referral.code, 'Code copied')}>Copy code</button>
            </div>
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>Friends</h3>
            </div>
            {referral.friends.length === 0 && <div className="empty">No invites yet.</div>}
            {referral.friends.map((f) => (
              <div key={f.id} className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{f.who}</div>
                  <small>{f.joined}</small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b className={f.earned === '+0' ? '' : 'up'} style={{ fontVariantNumeric: 'tabular-nums', fontSize: '13.5px' }}>{f.earned}</b>
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
      </div>
      {toast}
    </>
  );
}
