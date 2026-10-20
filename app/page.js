import Link from 'next/link';
import { cookies } from 'next/headers';
import DemoButton from '@/components/DemoButton';
import HeroVisual from '@/components/HeroVisual';
import Reveal from '@/components/Reveal';
import RigArt from '@/components/RigArt';
import StickyCta from '@/components/StickyCta';
import { COOKIE } from '@/lib/server/auth';

export const metadata = {
  title: { absolute: 'Miner Opus: bitcoin cloud mining without the hardware' },
};

const MARQUEE = ['Daily earnings', 'Pay in BTC', 'Reviewed withdrawals', 'Works in Telegram', 'Install as an app', 'Invite and earn rebates'];

const STEPS = [
  { t: 'Pick a plan', d: 'Choose the hash power that fits your budget.' },
  { t: 'Pay in bitcoin', d: 'Send BTC to your personal payment address. Your miner starts once the payment confirms.' },
  { t: 'Follow your earnings', d: 'Open your dashboard to see what your miners earn, day by day.' },
];

const RIGS = [
  { id: 'r1', plan: 'starter', kind: 'asic', units: 1, speed: 2.2, t: 'Starter', d: 'A first taste of mining.' },
  { id: 'r2', plan: 'growth', kind: 'gpu', units: 2, speed: 1.5, t: 'Growth', d: 'More hash power, more earnings.' },
  { id: 'r3', plan: 'elite', kind: 'container', units: 3, speed: 0.6, t: 'Elite', d: 'Our biggest plan.' },
];

const ICONS = {
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.8 0 5 2.2 5 5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
};

const WHY = [
  { i: 'eye', t: 'See what you own', d: 'Every miner has its own page, so you can see exactly what it has earned.' },
  { i: 'shield', t: 'Withdrawals with a paper trail', d: 'Every withdrawal is reviewed, and you can follow it from pending to sent.' },
  { i: 'users', t: 'Invite friends', d: 'Share your invite code. Friends who join with it get a rebate.' },
  { i: 'phone', t: 'Made for your phone', d: 'Install it like an app, or open it right inside Telegram.' },
];

// The page people see before they sign in. It makes no income promises and shows no made-up numbers or reviews:
// in this market, guaranteed returns and invented proof are what people have learned to distrust.
// The floating card in the hero is labelled as a demo.
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

        <section className="lp-hero2">
          <div className="lp-hero">
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
          </div>
          <HeroVisual />
        </section>

        <div className="lp-marq" aria-label="Highlights">
          <div className="lp-marq-in">
            <div className="lp-marq-g">
              {MARQUEE.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
            <div className="lp-marq-g lp-marq-dup" aria-hidden="true">
              {MARQUEE.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        </div>

        <section className="lp-sec" aria-labelledby="how">
          <Reveal>
            <h2 id="how">How it works</h2>
            <div className="lp-snap c3">
              {STEPS.map((s, i) => (
                <div className="lp-card" key={s.t}>
                  <div className="lp-n">{i + 1}</div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="lp-sec" aria-labelledby="rigs">
          <Reveal>
            <h2 id="rigs">Rigs that grow with your plan</h2>
            <div className="lp-snap c3">
              {RIGS.map((r) => (
                <div className="lp-card" key={r.id}>
                  <div className="lp-rig">
                    <RigArt kind={r.kind} units={r.units} speed={r.speed} id={r.id} />
                  </div>
                  <h3>{r.t}</h3>
                  <p>{r.d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="lp-sec" aria-labelledby="why">
          <Reveal>
            <h2 id="why">Why Miner Opus</h2>
            <div className="lp-snap c4">
              {WHY.map((w) => (
                <div className="lp-card" key={w.t}>
                  <div className="lp-ic">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {ICONS[w.i]}
                    </svg>
                  </div>
                  <h3>{w.t}</h3>
                  <p>{w.d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="lp-sec" aria-labelledby="know">
          <Reveal>
            <div className="lp-note">
              <h3 id="know">Know before you start</h3>
              <p>
                Mining returns follow the bitcoin price and network difficulty, so they change over time. Earnings are not guaranteed. Only buy what you are
                comfortable with.
              </p>
            </div>
          </Reveal>
        </section>

        {!signedIn && (
          <Reveal>
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
          </Reveal>
        )}

        <p className="lp-foot">&copy; 2026 Miner Opus</p>
      </div>
      {!signedIn && <StickyCta />}
    </main>
  );
}
