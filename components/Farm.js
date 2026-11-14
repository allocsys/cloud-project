import Reveal from '@/components/Reveal';
import Decrypt from '@/components/Decrypt';
import FarmVideo from '@/components/FarmVideo';

// Motion: the play button sends out a soft ring (transform and opacity only).
const CSS = `
.fm-row{list-style:none;display:flex;gap:12px;margin:12px -20px 0;padding:0 20px 4px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.fm-row::-webkit-scrollbar{display:none}
.fm-row li{flex:0 0 min(320px,86%);scroll-snap-align:start;min-width:0}
.fm-row.one li{flex-basis:100%}
.fm-box{position:relative;aspect-ratio:16/9;border:1px solid var(--line);border-radius:14px;background:var(--s1);overflow:hidden}
.fm-box img,.fm-frame{position:absolute;inset:0;width:100%;height:100%;border:0}
.fm-box img{object-fit:cover;opacity:.85}
.fm-play{position:absolute;inset:0;display:grid;place-items:center;width:100%;border:0;padding:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.fm-dot{position:relative;display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:var(--gold-c)}
.fm-dot svg{width:24px;height:24px;fill:var(--on-gold-c);margin-inline-start:3px}
.fm-dot::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--gold);animation:fm-ring 2.4s ease-out infinite}
@keyframes fm-ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.7);opacity:0}}
.fm-cap{margin:8px 0 0;font-size:13px;line-height:18px}
@media (min-width:720px){.fm-row{margin-inline:0;padding-inline:0}}
`;

// "Our farm": a short note that always shows, then the videos the admin added (Settings > Our farm videos). No videos = the note only.
// Server rendered; each video is a fixed 16:9 box, so nothing shifts when a player opens.
export default function Farm({ list, t }) {
  const videos = (list || []).map((v) => ({ id: v.id, title: v.title, kind: v.kind, embed: v.embed, thumb: v.thumb }));
  return (
    <section className="lp-sec" aria-labelledby="farm">
      <style>{CSS}</style>
      <Reveal>
        <h2 id="farm">
          <Decrypt when="view" text={t('farm.title')} />
        </h2>
        <div className="lp-note">
          <p>{t('farm.text')}</p>
        </div>
        {videos.length > 0 && (
          <ul className={`fm-row${videos.length === 1 ? ' one' : ''}`}>
            {videos.map((v) => (
              <li key={v.id}>
                <FarmVideo v={v} label={t('farm.play')} />
                <p className="fm-cap" dir="auto">{v.title}</p>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </section>
  );
}
