import Link from 'next/link';
import { GUIDES } from '@/lib/guides';
import { pagePath } from '@/lib/i18n/codes';

// The list of guide links. skip = the guide being read, so it does not link to itself.
export default function GuideLinks({ t, lang, skip, style }) {
  return (
    <div>
      {GUIDES.filter((g) => g.id !== skip).map((g) => (
        <p key={g.id} className="mute" style={{ margin: '0 0 6px' }}>
          <Link href={pagePath(g.path, lang)} style={style || { color: 'var(--gold2)' }}>{t(`gd.${g.id}.t`)}</Link>
        </p>
      ))}
    </div>
  );
}
