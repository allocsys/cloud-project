// Animated mining-rig illustration. `units` is the number of stacked rack units,
// `speed` is the fan rotation time in seconds (lower is faster). Pure SVG + CSS, no images.
// More rack units and faster fans for bigger plans.
export const RIG = {
  starter: { units: 1, speed: 2.2 },
  growth: { units: 2, speed: 1.5 },
  pro: { units: 3, speed: 0.9 },
};
export const rigFor = (name) => RIG[String(name).toLowerCase()] || RIG.starter;

const GOLD = '#e9c46a';
const GOLD_LIGHT = '#f6dc9a';

export default function RigArt({ units = 1, speed = 1.4, id = 'a' }) {
  const h = units * 24 - 4;
  const top = (100 - h) / 2 - 2;
  const blade = (rot) => (
    <ellipse rx="1.8" ry="6" fill={GOLD_LIGHT} transform={`rotate(${rot})`} />
  );

  return (
    <div className="art" style={{ '--spd': `${speed}s` }}>
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <defs>
          <linearGradient id={`u${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#27241c" />
            <stop offset="1" stopColor="#161410" />
          </linearGradient>
          <radialGradient id={`g${id}`}>
            <stop offset="0" stopColor={GOLD} stopOpacity=".5" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse className="glow" cx="60" cy="52" rx="56" ry="40" fill={`url(#g${id})`} />

        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            className="coin"
            cx={38 + i * 22}
            cy={top - 1}
            r="2.4"
            fill={GOLD_LIGHT}
            style={{ animationDelay: `${i}s` }}
          />
        ))}

        {Array.from({ length: units }).map((_, i) => {
          const y = top + i * 24;
          return (
            <g key={i}>
              <rect x="20" y={y} width="80" height="20" rx="4" fill={`url(#u${id})`} stroke={GOLD} strokeOpacity=".55" />
              {[38, 62].map((cx) => (
                <g key={cx} transform={`translate(${cx} ${y + 10})`}>
                  <circle r="7.5" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".5" />
                  <g className="fan">
                    {blade(0)}
                    {blade(60)}
                    {blade(120)}
                  </g>
                </g>
              ))}
              <path d={`M76 ${y + 6}h14M76 ${y + 10}h14M76 ${y + 14}h14`} stroke={GOLD} strokeOpacity=".25" />
              <circle className="led" cx="94" cy={y + 6} r="1.6" fill="#7dd6a0" style={{ animationDelay: `${i * 0.3}s` }} />
              <circle className="led" cx="94" cy={y + 14} r="1.6" fill={GOLD_LIGHT} style={{ animationDelay: `${i * 0.3 + 0.6}s` }} />
            </g>
          );
        })}

        <rect x="14" y={top + h + 4} width="92" height="3" rx="1.5" fill={GOLD} opacity=".35" />
      </svg>
    </div>
  );
}
