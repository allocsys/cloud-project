'use client';
import { SOCIALS } from '@/lib/site';
import { useT } from '@/components/I18nProvider';
import { SubHead } from '@/components/SettingsKit';

// A network with no address in lib/site.js is left out.
const LINKS = [
  ['telegram', 'set.channel'],
  ['bot', 'set.bot'],
  ['x', 'X'],
  ['instagram', 'Instagram'],
];

export default function Help() {
  const t = useT();
  const items = LINKS.filter(([k]) => /^https:\/\//.test(SOCIALS[k] || ''));
  return (
    <>
      <SubHead title={t('set.help')} />
      <div className="grid wal" style={{ alignItems: 'start' }}>
        <div className="card">
          {items.map(([k, name]) => (
            <a key={k} className="row set-nav" href={SOCIALS[k]} target="_blank" rel="noopener noreferrer">
              <span className="set-t">{name.startsWith('set.') ? t(name) : name}</span>
              <span className="set-v">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
