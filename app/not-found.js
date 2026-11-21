import Link from 'next/link';
import { LANG_CODES } from '@/lib/i18n/codes';
import { tForLang } from '@/lib/i18n/server';

// The 404 page. The root layout is static (no cookie), so the page holds the text in every language and the CSS shows the one that
// matches <html lang>, which the layout's first script sets before the first paint.
const CSS = `.nf{display:none}${LANG_CODES.map((l) => `html[lang=${l}] .nf[data-l=${l}]`).join(',')}{display:block}`;

export const metadata = { title: '404' };

export default function NotFound() {
  return (
    <section id="auth">
      <style>{CSS}</style>
      <div className="authbox" style={{ textAlign: 'center' }}>
        <Link href="/" className="lp-brand" aria-label="Vertexhash" style={{ justifyContent: 'center', marginBottom: 24, textDecoration: 'none' }}>
          <img src="/logo.svg" alt="" width="36" height="36" />
          Vertexhash
        </Link>
        {LANG_CODES.map((l) => {
          const t = tForLang(l);
          return (
            <div key={l} className="nf" data-l={l} lang={l}>
              <h1>{t('nf.title')}</h1>
              <p className="mute">{t('nf.text')}</p>
              <Link href="/" className="btn" style={{ textDecoration: 'none' }}>{t('nf.home')}</Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
