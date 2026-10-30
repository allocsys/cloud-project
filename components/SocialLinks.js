import { SOCIALS } from '@/lib/site';

const ICONS = {
  x: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  telegram: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  ),
  instagram: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const NAMES = { x: 'X', telegram: 'Telegram', instagram: 'Instagram' };

// Round icon links (X, Telegram, Instagram). A network with no address in lib/site.js is left out; with none, nothing shows.
export default function SocialLinks() {
  const items = Object.keys(ICONS).filter((k) => /^https:\/\//.test(SOCIALS[k] || ''));
  if (!items.length) return null;
  return (
    <div className="lp-social">
      {items.map((k) => (
        <a key={k} href={SOCIALS[k]} target="_blank" rel="noopener noreferrer me" aria-label={NAMES[k]}>
          {ICONS[k]}
        </a>
      ))}
    </div>
  );
}
