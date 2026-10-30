import Reveal from '@/components/Reveal';
import Decrypt from '@/components/Decrypt';
import { flagOf, summary, ROW_MAX } from '@/lib/reviews';

const STAR = 'M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7 6.1 20.8l1.2-6.5L2.5 9.7l6.6-.9z';

function Stars({ n, label }) {
  return (
    <span className="rv-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={i <= n ? 'on' : ''} aria-hidden="true">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

function countryName(cc, lang) {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(cc) || cc;
  } catch {
    return cc;
  }
}

function Card({ r, t, lang }) {
  return (
    <li className="rv-card">
      <Stars n={r.stars} label={t('rev.stars', { n: r.stars })} />
      <p className="rv-text" dir="auto">{r.text}</p>
      <div className="rv-by">
        <b dir="auto">{r.name}</b>
        <span>{flagOf(r.country)} {countryName(r.country, lang)}</span>
      </div>
      <div className="rv-src">
        {r.url ? (
          <a href={r.url} target="_blank" rel="noopener noreferrer nofollow ugc">{r.source} &#8599;</a>
        ) : (
          r.source
        )}
      </div>
    </li>
  );
}

// Real reviews the admin added (lib/reviews.js). No reviews: nothing is drawn. Server rendered, so nothing pops in.
// The first ROW_MAX sit in the swipe row; with more, the rest are under "Show all" (a plain <details>, no script).
export default function Reviews({ list, t, lang }) {
  if (!list?.length) return null;
  const s = summary(list);
  const top = list.slice(0, ROW_MAX);
  const rest = list.slice(ROW_MAX);
  return (
    <section className="lp-sec" aria-labelledby="rev">
      <Reveal>
        <h2 id="rev">
          <Decrypt when="view" text={t('rev.title')} />
        </h2>
        {s.showAvg && (
          <div className="rv-sum">
            <p className="rv-avg">
              <b>{s.avg.toFixed(1)}</b>
              <Stars n={Math.round(s.avg)} label={t('rev.stars', { n: s.avg.toFixed(1) })} />
              <span>{t('rev.count', { n: s.n })}</span>
            </p>
            <ul className="rv-bars" aria-hidden="true">
              {[5, 4, 3, 2, 1].map((k, i) => (
                <li key={k}>
                  <span>{k}</span>
                  <i><u style={{ width: `${Math.round((s.dist[i] / s.n) * 100)}%` }} /></i>
                  <em>{s.dist[i]}</em>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="rv-row">
          {top.map((r) => (
            <Card key={r.id} r={r} t={t} lang={lang} />
          ))}
        </ul>
        {rest.length > 0 && (
          <details className="rv-more">
            <summary>{t('rev.all', { n: s.n })}</summary>
            <ul className="rv-list">
              {rest.map((r) => (
                <Card key={r.id} r={r} t={t} lang={lang} />
              ))}
            </ul>
          </details>
        )}
      </Reveal>
    </section>
  );
}
