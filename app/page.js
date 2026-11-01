import Link from 'next/link';
import { cookies } from 'next/headers';
import ChainSteps from '@/components/ChainSteps';
import Decrypt from '@/components/Decrypt';
import LandingStats from '@/components/LandingStats';
import { LangToggle } from '@/components/LangSwitch';
import Reveal from '@/components/Reveal';
import Splash from '@/components/Splash';
import StickyCta from '@/components/StickyCta';
import { AuthSheetProvider, AuthButton } from '@/components/AuthSheet';
import { COOKIE } from '@/lib/server/auth';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { pagePath } from '@/lib/i18n/codes';
import SocialLinks from '@/components/SocialLinks';
import Reviews from '@/components/Reviews';
import { reviewList } from '@/lib/server/reviews';
import { showDemo, minDeposit } from '@/lib/server/flags';
import { SITE_URL } from '@/lib/site';
import { ASIC_TIERS, SMART_TIERS } from '@/lib/tiers';
import { faqAnswer, faqList, faqVars } from '@/lib/faq';
import { faqTr } from '@/lib/i18n/faq';

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: { absolute: t('meta.home.title') }, alternates: langAlternates('/', lang) };
}

// The home page's FAQ: only answers the owner approved (read from lib/faq.js, never copied), same as the FAQ page.
const FAQ_IDS = ['plans', 'hardware', 'returns', 'withdraw_how'];

// The page people see before they sign in: headline and one button, live counter (real numbers), 3 steps, plans, short FAQ, footer.
// It makes no income promises and shows no made-up numbers or reviews. The counter shows nothing until a miner is running.
// (The calculator, boost promo and winners bar are no longer on this page; their components are still in the repo.)
export default async function Home() {
  const jar = await cookies();
  const signedIn = jar.has(COOKIE);
  const t = await getT();
  const lang = await getLang();
  const demoOn = await showDemo(); // the admin's switch (Settings > Demo account)
  const reviews = await reviewList(); // real reviews the admin added (Settings > Reviews); none = no section
  const foot = { color: 'inherit', textDecoration: 'underline' };

  const STEPS = [1, 2, 3].map((n) => ({ t: t(`landing.s${n}.t`), d: t(`landing.s${n}.d`) }));
  const en = new Map(faqList().map((e) => [e.id, e.q]));
  const ctx = await minDeposit().then((n) => ({ minDeposit: n }), () => ({}));
  const faq = FAQ_IDS.flatMap((id) => {
    if (lang === 'en') {
      const a = faqAnswer(id, ctx);
      return a && en.has(id) ? [{ id, q: en.get(id), a }] : [];
    }
    const q = faqTr(lang, `${id}.q`);
    const a = faqTr(lang, `${id}.a`, faqVars(id, ctx));
    return q && a ? [{ id, q, a }] : [];
  });

  return (
    <AuthSheetProvider signedIn={signedIn} showDemo={demoOn}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'Organization',
                '@id': `${SITE_URL}/#org`,
                name: 'Vertexhash',
                url: SITE_URL,
                logo: `${SITE_URL}/icons/192`,
                email: 'support@vertexhash.com',
                description: t('meta.description'),
              },
              {
                '@type': 'WebSite',
                '@id': `${SITE_URL}/#site`,
                name: 'Vertexhash',
                url: SITE_URL,
                inLanguage: ['en', 'fa'],
                publisher: { '@id': `${SITE_URL}/#org` },
              },
            ],
          }).replace(/</g, '\\u003c'),
        }}
      />
      <Splash />
      <main className="lp">
      <div className="lp-in">
        <header className="lp-top">
          <Link href="/" className="lp-brand" aria-label="Vertexhash">
            <img src="/logo.svg" alt="" width="36" height="36" />
            Vertexhash
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
            <h1>
              <Decrypt text={t('landing.h1a')} delay={300} pace={0.55} />{' '}
              <span>
                <Decrypt text={t('landing.h1b')} delay={900} pace={0.55} />
              </span>
            </h1>
            <p className="lp-sub">
              <Decrypt text={t('landing.sub')} delay={1300} pace={0.5} />
            </p>
            <div className="lp-cta">
              {signedIn ? (
                <Link href="/dashboard" className="btn lp-start">{t('landing.dashboard')}</Link>
              ) : (
                <AuthButton mode="signup" className="btn lp-start">{t('landing.start')}</AuthButton>
              )}
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <LandingStats />
        </section>

        <section className="lp-sec" aria-labelledby="steps">
          <Reveal>
            <h2 id="steps">
              <Decrypt when="view" text={t('how.link')} />
            </h2>
            <ChainSteps steps={STEPS} />
          </Reveal>
        </section>

        <section className="lp-sec" aria-labelledby="plans">
          <Reveal>
            <h2 id="plans">
              <Decrypt when="view" text={t('landing.plans')} />
            </h2>
            <div className="lp-plans">
              <div className="lp-pg">
                <h3>{t('landing.plans.asics')}</h3>
                <div className="lp-pl">
                  {ASIC_TIERS.map((x) => (
                    <span key={x.id}>{x.name}<small>{t('landing.plans.th', { n: x.from })}</small></span>
                  ))}
                </div>
              </div>
              <div className="lp-pg">
                <h3>{t('dash.smart')}</h3>
                <div className="lp-pl">
                  {SMART_TIERS.map((x) => (
                    <span key={x.id}>{x.name}<small>{t('landing.plans.usd', { n: x.from })}</small></span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {faq.length > 0 && (
          <section className="lp-sec" aria-labelledby="faq">
            <Reveal>
              <h2 id="faq">
                <Decrypt when="view" text={t('faq.title')} />
              </h2>
              <div className="lp-faq">
                {faq.map((x) => (
                  <details key={x.id}>
                    <summary>{x.q}</summary>
                    <p>{x.a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </section>
        )}

        <section className="lp-sec" aria-labelledby="know">
          <Reveal>
            <div className="lp-note">
              <h3 id="know">{t('landing.know.t')}</h3>
              <p>{t('landing.know.d')}</p>
            </div>
          </Reveal>
        </section>

        <Reviews list={reviews} t={t} lang={lang} />

        <p className="lp-foot">
          &copy; 2026 Vertexhash<br />
          <Link href={pagePath('/how-it-works', lang)} style={foot}>{t('how.link')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/faq', lang)} style={foot}>{t('faq.link')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/glossary', lang)} style={foot}>{t('glo.link')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/terms', lang)} style={foot}>{t('auth.terms')}</Link>
          {' \u00b7 '}
          <Link href={pagePath('/privacy', lang)} style={foot}>{t('auth.privacy')}</Link>
        </p>
        <SocialLinks />
      </div>
      {!signedIn && <StickyCta />}
      </main>
    </AuthSheetProvider>
  );
}
