import Link from 'next/link';
import { cookies } from 'next/headers';
import Calculator from '@/components/Calculator';
import BoostPromo from '@/components/BoostPromo';
import Decrypt from '@/components/Decrypt';
import LandingTail from '@/components/LandingTail';
import { LangToggle } from '@/components/LangSwitch';
import Reveal from '@/components/Reveal';
import Splash from '@/components/Splash';
import StickyCta from '@/components/StickyCta';
import WinnersBar from '@/components/WinnersBar';
import { AuthSheetProvider, AuthButton } from '@/components/AuthSheet';
import { COOKIE } from '@/lib/server/auth';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: { absolute: t('meta.home.title') }, alternates: langAlternates('/', lang) };
}

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

// The page people see before they sign in. It makes no income promises and shows no made-up numbers or reviews:
// in this market, guaranteed returns and invented proof are what people have learned to distrust.
// The one exception is the winners bar (components/WinnersBar.js): it shows sample winners until real ones fill it. Take the samples out before launch.
// The calculator uses the live market and the real plan prices, and says it is an estimate.
export default async function Home() {
  const jar = await cookies();
  const signedIn = jar.has(COOKIE);
  const t = await getT();

  const WHY = [
    { i: 'eye', t: t('landing.why.see.t'), d: t('landing.why.see.d') },
    { i: 'shield', t: t('landing.why.wd.t'), d: t('landing.why.wd.d') },
    { i: 'users', t: t('landing.why.inv.t'), d: t('landing.why.inv.d') },
    { i: 'phone', t: t('landing.why.phone.t'), d: t('landing.why.phone.d') },
  ];

  return (
    <AuthSheetProvider signedIn={signedIn}>
      <Splash />
      <main className="lp">
      <div className="lp-in">
        <header className="lp-top">
          <Link href="/" className="lp-brand" aria-label="Vertexhash">
            <img src="/logo.svg" alt="" width="36" height="36" />
            Miner Opus
          </Link>
          <div className="topact">
            <LangToggle className="lp-signin" />
            {signedIn ? (
              <Link href="/dashboard" className="lp-signin">
                {t('landing.dashboard')}
              </Link>
            ) : (
              <AuthButton className="lp-signin">{t('auth.signIn')}</AuthButton>
            )}
          </div>
        </header>

        <section className="lp-hero2">
          <div className="lp-hero">
            <span className="lp-eyebrow">
              <Decrypt text={t('landing.eyebrow')} />
            </span>
            <h1>
              <Decrypt text={t('landing.h1a')} delay={400} pace={0.55} />{' '}
              <span>
                <Decrypt text={t('landing.h1b')} delay={1100} pace={0.55} />
              </span>
            </h1>
            <p className="lp-sub">
              <Decrypt text={t('landing.sub')} delay={1500} pace={0.5} />
            </p>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="calc">
          <Reveal>
            <h2 id="calc">
              <Decrypt when="view" text={t('calc.heading')} />
            </h2>
            <Calculator signedIn={signedIn} />
            <BoostPromo signedIn={signedIn} />
          </Reveal>
        </section>

        <LandingTail>
        <WinnersBar />

        <section className="lp-sec" aria-labelledby="why">
          <Reveal>
            <h2 id="why">
              <Decrypt when="view" text={t('landing.why')} />
            </h2>
            <div className="lp-why">
              {WHY.map((w) => (
                <div className="lp-wi" key={w.i}>
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
              <h3 id="know">{t('landing.know.t')}</h3>
              <p>{t('landing.know.d')}</p>
            </div>
          </Reveal>
        </section>

        <p className="lp-foot">&copy; 2026 Miner Opus</p>
        </LandingTail>
      </div>
      {!signedIn && <StickyCta />}
      </main>
    </AuthSheetProvider>
  );
}
