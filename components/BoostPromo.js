'use client';
// The Boost card on the landing page, under the calculator. It reads the ticket table from /api/plans (null while boost tickets are
// off, then nothing shows). Every figure comes from the server settings, so it always matches the Boost tab. The only motion is the small
// miner picture (BoostArt): CSS transform and opacity only, no timers, paused while off screen. It animates for everyone (owner's choice).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { AuthButton } from '@/components/AuthSheet';
import { useT } from '@/components/I18nProvider';

const whole = (n) => n.toLocaleString('en-US');
const usd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLOR = { t1: '#EF9F27', t10: '#5DCAA5', t100: '#AFA9EC' }; // the same tier colours as the dial on the Boost tab

// A miner solves a block every 2 s (three bars, one per tier colour). The 6 s loop sends up a $1 bubble, a $10 bubble, then a big shiny $100 one.
const ART_CSS = `
.bp-fan{transform-box:fill-box;transform-origin:center;animation:bpSp 1s linear infinite}
@keyframes bpSp{to{transform:rotate(360deg)}}
.bp-pk{opacity:0;animation:bpPk 1.4s linear infinite}
.bp-p2{animation-delay:.47s}.bp-p3{animation-delay:.93s}
@keyframes bpPk{0%{opacity:0;transform:translateX(0)}15%{opacity:1}85%{opacity:1}100%{opacity:0;transform:translateX(62px)}}
.bp-bar{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation:bpBf 2s ease-out infinite}
.bp-b2{animation-delay:.3s}.bp-b3{animation-delay:.6s}
@keyframes bpBf{0%{transform:scaleX(0);opacity:1}30%,88%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
.bp-fh{opacity:0;animation:bpFh 2s ease-out infinite}
@keyframes bpFh{0%,58%{opacity:0}66%,84%{opacity:1}100%{opacity:0}}
.bp-sb,.bp-bg,.bp-rg{opacity:0;transform-box:fill-box;transform-origin:center;animation-duration:6s;animation-iteration-count:infinite;animation-timing-function:ease-out}
.bp-sb{animation-name:bpSb}
@keyframes bpSb{0%{opacity:0;transform:translate(0,0) scale(.6)}5%{opacity:1;transform:translate(0,-8px) scale(1)}28%{opacity:1;transform:translate(var(--dx),-32px) scale(1)}34%,100%{opacity:0;transform:translate(var(--dx),-36px) scale(1)}}
.bp-bg{animation-name:bpBg;animation-delay:5.2s}
@keyframes bpBg{0%{opacity:0;transform:translateY(0) scale(.5)}8%{opacity:1;transform:translateY(-32px) scale(1.25)}26%{opacity:1;transform:translateY(-32px) scale(1.12)}33%,100%{opacity:0;transform:translateY(-32px) scale(1.12)}}
.bp-rg{animation-name:bpRg;animation-delay:5.2s}
@keyframes bpRg{0%,5%{opacity:0;transform:scale(.4)}11%{opacity:1;transform:scale(1)}22%,100%{opacity:0;transform:scale(1.25)}}
.bp-sh{animation:bpSh 6s ease-in-out infinite;animation-delay:5.2s}
@keyframes bpSh{0%,8%{transform:translateX(-26px)}22%,100%{transform:translateX(32px)}}
.bp-off *{animation-play-state:paused!important}
`;

const Ray = ({ a }) => <line x1="23" y1="0" x2="31" y2="0" transform={`rotate(${a})`} />;
const Spokes = () => <path d="M-14 0H14M0 -14V14M-10 -10L10 10M-10 10L10 -10" stroke="#EF9F27" strokeWidth="2" strokeLinecap="round" />;

function BoostArt() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <svg ref={ref} className={seen ? undefined : 'bp-off'} viewBox="0 -20 300 150" role="img" aria-label="A miner solves blocks and sends up prize bubbles" style={{ display: 'block', width: '100%', maxWidth: 300, margin: '0 auto 4px' }}>
      <style>{ART_CSS}</style>
      <defs>
        <clipPath id="bpClip">
          <circle cx="232" cy="44" r="17" />
        </clipPath>
      </defs>
      <rect x="16" y="36" width="100" height="76" rx="8" fill="currentColor" fillOpacity="0.06" stroke="var(--border-strong)" strokeWidth="0.5" />
      <circle cx="26" cy="46" r="2.5" fill="#EF9F27" />
      {[46, 86].map((x) => (
        <g key={x} transform={`translate(${x} 78)`}>
          <circle r="17" fill="none" stroke="var(--border-strong)" strokeWidth="0.5" />
          <g className="bp-fan">
            <Spokes />
          </g>
        </g>
      ))}
      <line x1="122" y1="74" x2="186" y2="74" stroke="var(--border-strong)" strokeWidth="0.5" strokeDasharray="3 3" />
      <rect className="bp-pk" x="122" y="71.5" width="9" height="5" rx="2.5" fill="#EF9F27" />
      <rect className="bp-pk bp-p2" x="122" y="71.5" width="9" height="5" rx="2.5" fill="#5DCAA5" />
      <rect className="bp-pk bp-p3" x="122" y="71.5" width="9" height="5" rx="2.5" fill="#AFA9EC" />
      <rect x="190" y="44" width="84" height="68" rx="8" fill="currentColor" fillOpacity="0.06" stroke="var(--border-strong)" strokeWidth="0.5" />
      {[58, 74, 90].map((y) => (
        <rect key={y} x="202" y={y} width="60" height="8" rx="4" fill="none" stroke="var(--border-strong)" strokeWidth="0.5" />
      ))}
      <rect className="bp-bar" x="202" y="58" width="60" height="8" rx="4" fill="#EF9F27" />
      <rect className="bp-bar bp-b2" x="202" y="74" width="60" height="8" rx="4" fill="#5DCAA5" />
      <rect className="bp-bar bp-b3" x="202" y="90" width="60" height="8" rx="4" fill="#AFA9EC" />
      <rect className="bp-fh" x="190" y="44" width="84" height="68" rx="8" fill="none" stroke="#EF9F27" strokeWidth="2" />
      <g className="bp-sb" style={{ '--dx': '-8px', animationDelay: '1.2s' }}>
        <circle cx="232" cy="44" r="10" fill="#EF9F27" fillOpacity="0.2" stroke="#EF9F27" strokeWidth="1" />
        <text x="232" y="48" textAnchor="middle" fontSize="11" fontWeight="500" fill="#EF9F27">$1</text>
      </g>
      <g className="bp-sb" style={{ '--dx': '10px', animationDelay: '3.2s' }}>
        <circle cx="232" cy="44" r="12" fill="#5DCAA5" fillOpacity="0.22" stroke="#5DCAA5" strokeWidth="1.2" />
        <text x="232" y="48" textAnchor="middle" fontSize="11" fontWeight="500" fill="#5DCAA5">$10</text>
      </g>
      <g transform="translate(232 12)">
        <g className="bp-rg" stroke="#AFA9EC" strokeWidth="2" strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <Ray key={a} a={a} />
          ))}
        </g>
      </g>
      <g className="bp-bg">
        <circle cx="232" cy="44" r="17" fill="#AFA9EC" stroke="#7F77DD" strokeWidth="3" />
        <g clipPath="url(#bpClip)">
          <g transform="rotate(20 232 44)">
            <rect className="bp-sh" x="212" y="22" width="8" height="44" fill="#fff" opacity="0.6" />
          </g>
        </g>
        <ellipse cx="225" cy="35" rx="4" ry="2.4" fill="#fff" opacity="0.55" transform="rotate(-30 225 35)" />
        <text x="232" y="48.5" textAnchor="middle" fontSize="12" fontWeight="500" fill="#26215C">$100</text>
      </g>
    </svg>
  );
}

export default function BoostPromo({ signedIn = false }) {
  const t = useT();
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const b = cat?.boost;
  if (!b) return null;
  const same = b.tickets.every((t) => t.chance === b.tickets[0].chance); // one chance for all: say it once, in the footnote

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3>{t('boost.title')}</h3>
      <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>{t('boost.sub', { h: b.hours })}</p>
      <BoostArt />
      {b.tickets.map((tk) => (
        <div className="row" key={tk.id}>
          <div>
            <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLOR[tk.id], marginInlineEnd: 8 }} />
            <b>{t('boost.ticket', { n: whole(tk.price) })}</b>
            <small style={{ display: 'block' }}>{tk.coin} · {t('boost.pays', { n: usd(tk.pay) })}{same ? '' : ` · ${t('boost.chance', { n: tk.chance })}`}</small>
          </div>
          <b style={{ color: 'var(--gold2)', textAlign: 'end', fontSize: '14px' }}>{t('boost.win', { n: whole(tk.prize) })}</b>
        </div>
      ))}
      {signedIn ? (
        <Link
          href="/plans"
          className="btn boost-go"
          onClick={() => {
            try {
              sessionStorage.setItem('vtx-plans-tab', 'boost');
            } catch {}
            triggerHaptic('light');
          }}
        >
          {t('boost.open')}
        </Link>
      ) : (
        <AuthButton mode="signup" className="btn boost-go">
          {t('common.getStarted')}
        </AuthButton>
      )}
      <p className="fine" style={{ margin: '12px 0 0' }}>{same ? t('boost.footChance', { n: b.tickets[0].chance }) : t('boost.foot')}</p>
    </div>
  );
}
