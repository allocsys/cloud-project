import BackLink from '@/components/BackLink';
import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';
import { REFUND_HOURS } from '@/lib/rules';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };

export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('refunds.title'), description: t('refunds.desc'), alternates: langAlternates('/refunds', lang) };
}

// The hours come from lib/rules, the same number the Terms and the FAQ use. Refunds are done by the team (admin), so the
// page sends people to support with their Miner ID.
export default async function Refunds() {
  const t = await getT();
  const v = { hours: REFUND_HOURS };
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'start', maxWidth: '560px' }}>
        <h1>{t('refunds.title')}</h1>
        <p className="mute">{t('refunds.intro')}</p>

        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n}>
            <h2 style={h2}>{t(`refunds.h${n}`, v)}</h2>
            <p className="mute">{t(`refunds.p${n}`, v)}</p>
          </div>
        ))}

        <div style={{ height: '14px' }} />
        <BackLink />
      </div>
    </section>
  );
}
