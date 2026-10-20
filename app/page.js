import Link from 'next/link';
import { cookies } from 'next/headers';
import DemoButton from '@/components/DemoButton';
import { COOKIE } from '@/lib/server/auth';

export const metadata = {
  title: { absolute: 'Miner Opus: bitcoin cloud mining without the hardware' },
};

const STEPS = [
  { t: 'Pick a plan', d: 'Choose the hash power that fits your budget.' },
  { t: 'Pay in bitcoin', d: 'Send BTC to your personal payment address. Your miner starts once the payment confirms.' },
  { t: 'Follow your earnings', d: 'Open your dashboard to see what your miners earn, day by day.' },
];

const WHY = [
  { t: 'See what you own', d: 'Every miner has its own page, so you can see exactly what it has earned.' },
  { t: 'Withdrawals with a paper trail', d: 'Every withdrawal is reviewed, and you can follow it from pending to sent.' },
  { t: 'Invite friends', d: 'Share your invite code. Friends who join with it get a rebate.' },
  { t: 'Made for your phone', d: 'Install it like an app, or open it right inside Telegram.' },
];

// The page people see before they sign in. It makes no income promises and shows no made-up numbers or reviews:
// in this market, guaranteed returns and invented proof are what people have learned to distrust.
export default async function Home() {
  const jar = await cookies();
  const signedIn = jar.has(COOKIE);

  return (
    <main className="lp">
      <div className="lp-in">
        <header className="lp-top">
          <Link href="/" className="lp-brand" aria-label="Miner Opus">
            <img src="/logo.svg" alt="" width="36" height="36" />
            Miner Opus
          </Link>
          <Link href={signedIn ? '/dashboard' : '/login'} className="lp-signin">
            {signedIn ? 'Dashboard' : 'Sign in'}
          </Link>
        </header>

        <section className="lp-hero">
          <span className="lp-eyebrow">Cloud mining, made simple</span>
          <h1>
            Bitcoin mining <span>without the machines.</span>
          </h1>
          <p className="lp-sub">Rent hash power, pay in bitcoin and follow your earnings every day. No hardware, no setup, no noise.</p>

          <div className="lp-cta">
            <Link href={signedIn ? '/dashboard' : '/login?mode=signup'} className="btn">
              {signedIn ? 'Open my dashboard' : 'Get started'}
            </Link>
            {!signedIn && <DemoButton>Explore the demo first</DemoButton>}
          </div>
          {!signedIn && <p className="lp-fine">The demo is free and needs no sign-up.</p>}

          <div className="trust">
            <span>Daily earnings</span>
            <span>Pay in BTC</span>
            <span>Reviewed withdrawals</span>
            <span>Works in Telegram</span>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <div className="lp-grid c3">
            {STEPS.map((s, i) => (
              <div className="lp-card" key={s.t}>
                <div className="lp-n">{i + 1}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="why">
          <h2 id="why">Why Miner Opus</h2>
          <div className="lp-grid c2">
            {WHY.map((w) => (
              <div className="lp-card" key={w.t}>
                <h3>{w.t}</h3>
                <p>{w.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="know">
          <div className="lp-note">
            <h3 id="know">Know before you start</h3>
            <p>
              Mining returns follow the bitcoin price and network difficulty, so they change over time. Earnings are not guaranteed. Only buy what you are comfortable
              with.
            </p>
          </div>
        </section>

        {!signedIn && (
          <section className="lp-end" aria-labelledby="go">
            <h2 id="go">Take a look inside</h2>
            <p>See the dashboard, the plans and a miner page before you create an account.</p>
            <div className="lp-cta">
              <Link href="/login?mode=signup" className="btn">
                Create an account
              </Link>
              <DemoButton className="btn ghost">Explore the demo</DemoButton>
            </div>
          </section>
        )}

        <p className="lp-foot">&copy; 2026 Miner Opus</p>
      </div>
    </main>
  );
}
