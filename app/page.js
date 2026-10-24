import Link from 'next/link';
import { cookies } from 'next/headers';
import Calculator from '@/components/Calculator';
import BoostPromo from '@/components/BoostPromo';
import Decrypt from '@/components/Decrypt';
import Reveal from '@/components/Reveal';
import Splash from '@/components/Splash';
import StickyCta from '@/components/StickyCta';
import WinnersBar from '@/components/WinnersBar';
import { AuthSheetProvider, AuthButton } from '@/components/AuthSheet';
import { COOKIE } from '@/lib/server/auth';

export const metadata = {
  title: { absolute: 'Miner Opus: bitcoin cloud mining without the hardware' },
};

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
// The one exception is the winners bar (components/WinnersBar.js): it shows sample winners until real ones fill it. Take the samples out before launch.
// The calculator uses the live market and the real plan prices, and says it is an estimate.
export default async function Home() {
  const jar = await cookies();
  const signedIn = jar.has(COOKIE);

  return (
    <AuthSheetProvider signedIn={signedIn}>
      <Splash />
      <main className="lp">
      <div className="lp-in">
        <header className="lp-top">
          <Link href="/" className="lp-brand" aria-label="Miner Opus">
            <img src="/logo.svg" alt="" width="36" height="36" />
            Miner Opus
          </Link>
          {signedIn ? (
            <Link href="/dashboard" className="lp-signin">
              Dashboard
            </Link>
          ) : (
            <AuthButton className="lp-signin">Sign in</AuthButton>
          )}
        </header>

        <section className="lp-hero2">
          <div className="lp-hero">
            <span className="lp-eyebrow">
              <Decrypt text="Cloud mining, made simple" />
            </span>
            <h1>
              <Decrypt text="Bitcoin mining" delay={400} pace={0.55} />{' '}
              <span>
                <Decrypt text="without the machines." delay={1100} pace={0.55} />
              </span>
            </h1>
            <p className="lp-sub">
              <Decrypt text="Rent hash power, pay in bitcoin and follow your earnings every day. No hardware, no setup, no noise." delay={1500} pace={0.5} />
            </p>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="calc">
          <Reveal>
            <h2 id="calc">
              <Decrypt when="view" text="Estimate your mining" />
            </h2>
            <Calculator signedIn={signedIn} />
            <BoostPromo signedIn={signedIn} />
          </Reveal>
        </section>

        <WinnersBar />

        <section className="lp-sec" aria-labelledby="why">
          <Reveal>
            <h2 id="why">
              <Decrypt when="view" text="Why Miner Opus" />
            </h2>
            <div className="lp-why">
              {WHY.map((w) => (
                <div className="lp-wi" key={w.t}>
                  <div className="lp-ic">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {ICONS[w.i]}
                    </svg>
                  </div>
                  <div className="lp-wt">
                    <h3>
                      <Decrypt when="view" text={w.t} />
                    </h3>
                    <p>{w.d}</p>
                  </div>
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
                comfortable with. You pay in bitcoin to your own personal payment address, and your miner starts once the payment confirms.
              </p>
            </div>
          </Reveal>
        </section>

        <p className="lp-foot">&copy; 2026 Miner Opus</p>
      </div>
      {!signedIn && <StickyCta />}
      </main>
    </AuthSheetProvider>
  );
}
