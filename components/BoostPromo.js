'use client';
// The Boost card on the landing page, under the calculator. It reads the ticket table from /api/plans (null while boost tickets are
// off, then nothing shows). Every figure comes from the server settings, so it always matches the Boost tab. No state, no animation.
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { AuthButton } from '@/components/AuthSheet';

const whole = (n) => n.toLocaleString('en-US');
const usd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLOR = { t1: '#EF9F27', t10: '#5DCAA5', t100: '#AFA9EC' }; // the same tier colours as the dial on the Boost tab

export default function BoostPromo({ signedIn = false }) {
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const b = cat?.boost;
  if (!b) return null;
  const same = b.tickets.every((t) => t.chance === b.tickets[0].chance); // one chance for all: say it once, in the footnote

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3>Boost</h3>
      <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>Extra hashrate for {b.hours} hours. Always pays, plus a chance to win.</p>
      {b.tickets.map((t) => (
        <div className="row" key={t.id}>
          <div>
            <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLOR[t.id], marginRight: 8 }} />
            <b>${whole(t.price)} ticket</b>
            <small style={{ display: 'block' }}>{t.coin} · pays ${usd(t.pay)}{same ? '' : ` · ${t.chance}% chance`}</small>
          </div>
          <b style={{ color: 'var(--gold2)', textAlign: 'right', fontSize: '14px' }}>chance to win ${whole(t.prize)}</b>
        </div>
      ))}
      {signedIn ? (
        <Link
          href="/plans"
          className="btn boost-go"
          onClick={() => {
            try {
              sessionStorage.setItem('opus-plans-tab', 'boost');
            } catch {}
            triggerHaptic('light');
          }}
        >
          Open Boost
        </Link>
      ) : (
        <AuthButton mode="signup" className="btn boost-go">
          Get started
        </AuthButton>
      )}
      <p className="fine" style={{ margin: '12px 0 0' }}>Each ticket has its own draw{same ? `, ${b.tickets[0].chance}% chance` : ''}. The result shows when the boost ends.</p>
    </div>
  );
}
