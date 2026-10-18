// Animated mining-rig illustration. `units` is the number of stacked rack units,
// `speed` is the fan rotation time in seconds (lower is faster). Pure SVG + CSS, no images.
// More rack units and faster fans for bigger plans.
export const RIG = {
  starter: { units: 1, speed: 2.2 },
  growth: { units: 2, speed: 1.5 },
  pro: { units: 3, speed: 0.9 },
};
export const rigFor = (name) => RIG[String(name).toLowerCase()] || RIG.starter;

export default function RigArt({ units = 1, speed = 1.4, id = 'a' }) {
  const h = units * 24 - 4;
  const top = (100 - h) / 2 - 2;
  const blade = (rot) => (
    <ellipse rx="1.8" ry="6" fill="#f1d48a" transform={`rotate(${rot})`} />
  );

  return (
    <div className="art" style={{ '--spd': `${speed}s` }}>
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <defs>
          <linearGradient id={`u${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2214" />
            <stop offset="1" stopColor="#14100a" />
          </linearGradient>
          <radialGradient id={`g${id}`}>
            <stop offset="0" stopColor="#d4a84b" stopOpacity=".55" />
            <stop offset="1" stopColor="#d4a84b" stopOpacity="0" />
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
            fill="#f1d48a"
            style={{ animationDelay: `${i}s` }}
          />
        ))}

        {Array.from({ length: units }).map((_, i) => {
          const y = top + i * 24;
          return (
            <g key={i}>
              <rect x="20" y={y} width="80" height="20" rx="4" fill={`url(#u${id})`} stroke="#d4a84b" strokeOpacity=".55" />
              {[38, 62].map((cx) => (
                <g key={cx} transform={`translate(${cx} ${y + 10})`}>
                  <circle r="7.5" fill="#0b0906" stroke="#d4a84b" strokeOpacity=".5" />
                  <g className="fan">
                    {blade(0)}
                    {blade(60)}
                    {blade(120)}
                  </g>
                </g>
              ))}
              <path d={`M76 ${y + 6}h14M76 ${y + 10}h14M76 ${y + 14}h14`} stroke="#d4a84b" strokeOpacity=".25" />
              <circle className="led" cx="94" cy={y + 6} r="1.6" fill="#6fcf97" style={{ animationDelay: `${i * 0.3}s` }} />
              <circle className="led" cx="94" cy={y + 14} r="1.6" fill="#f1d48a" style={{ animationDelay: `${i * 0.3 + 0.6}s` }} />
            </g>
          );
        })}

        <rect x="14" y={top + h + 4} width="92" height="3" rx="1.5" fill="#d4a84b" opacity=".35" />
      </svg>
    </div>
  );
}
