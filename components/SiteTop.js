import Link from 'next/link';
import LandingMenu from '@/components/LandingMenu';
import { LangToggle } from '@/components/LangSwitch';
import SocialLinks from '@/components/SocialLinks';
import { tForLang } from '@/lib/i18n/server';
import { menuLinks } from '@/components/menu-links';

// The top bar of the info pages (Terms, Privacy, About, FAQ and the rest): the brand takes you home, plus the language and the same menu as the landing page.
// Static: the language comes from the page's address, never from a cookie.
export default function SiteTop({ lang }) {
  const t = tForLang(lang);
  return (
    <header className="site-top">
      <Link href="/" className="lp-brand" aria-label="Vertexhash">
        <img src="/logo.svg" alt="" width="36" height="36" />
        Vertexhash
      </Link>
      <div className="topact">
        <LangToggle className="lp-signin" short />
        <LandingMenu label={t('landing.menu')} links={menuLinks(t, lang)} contact={t('landing.contact')}>
          <SocialLinks className="lp-social lm-soc" />
        </LandingMenu>
      </div>
    </header>
  );
}
