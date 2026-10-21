// Animated mining-rig illustrations. Six variations, one per plan size:
// asic, rack, gpu, tank, cabinet, container. `speed` is the fan rotation time in seconds
// (lower is faster). Pure SVG + CSS, no images.
export const RIG = {
  starter: { kind: 'asic', units: 1, speed: 2.2 },
  basic: { kind: 'rack', units: 1, speed: 1.8 },
  growth: { kind: 'gpu', units: 2, speed: 1.5 },
  plus: { kind: 'tank', units: 2, speed: 1.2 },
  pro: { kind: 'cabinet', units: 3, speed: 0.9 },
  elite: { kind: 'container', units: 3, speed: 0.6 },
  smart: { kind: 'cabinet', units: 3, speed: 1.1 },
  'smart mining': { kind: 'cabinet', units: 3, speed: 1.1 },
};
// Takes a plan name or id, or a miner: custom miners get a rig that fits their size.
export const rigFor = (x) => {
  const key = String(x && typeof x === 'object' ? x.plan : x).toLowerCase();
  if (RIG[key]) return RIG[key];
  const th = x && typeof x === 'object' ? x.th : 0;
  return th >= 1000 ? RIG.elite : th >= 500 ? RIG.pro : th >= 250 ? RIG.plus : th >= 100 ? RIG.growth : th >= 30 ? RIG.basic : RIG.starter;
};

const GOLD = '#e9c46a';
const GOLD_LIGHT = '#f6dc9a';
const GREEN = '#7dd6a0';

const Fan = ({ cx, cy, r = 7.5, n = 3 }) => (
  <g transform={`translate(${cx} ${cy})`}>
    <circle r={r} fill="#0e0d0a" stroke={GOLD} strokeOpacity=".5" />
    <g className="fan">
      {Array.from({ length: n }).map((_, i) => (
        <ellipse key={i} rx={r * 0.24} ry={r * 0.8} fill={GOLD_LIGHT} transform={`rotate(${(i * 360) / n})`} />
      ))}
    </g>
  </g>
);

const Led = ({ cx, cy, d = 0, c = GOLD_LIGHT }) => (
  <circle className="led" cx={cx} cy={cy} r="1.6" fill={c} style={{ animationDelay: `${d}s` }} />
);

function Rack({ units, speed, u }) {
  const h = units * 24 - 4;
  const top = (100 - h) / 2 - 2;
  return (
    <>
      {Array.from({ length: units }).map((_, i) => {
        const y = top + i * 24;
        return (
          <g key={i}>
            <rect x="20" y={y} width="80" height="20" rx="4" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
            <Fan cx={38} cy={y + 10} />
            <Fan cx={62} cy={y + 10} />
            <path d={`M76 ${y + 6}h14M76 ${y + 10}h14M76 ${y + 14}h14`} stroke={GOLD} strokeOpacity=".25" />
            <Led cx={94} cy={y + 6} d={i * 0.3} c={GREEN} />
            <Led cx={94} cy={y + 14} d={i * 0.3 + 0.6} />
          </g>
        );
      })}
      <rect x="14" y={top + h + 4} width="92" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

function Asic({ u }) {
  const bars = [0, 1, 2, 3];
  return (
    <>
      <rect x="22" y="26" width="76" height="52" rx="7" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
      <Fan cx={48} cy={52} r={17} n={5} />
      <rect x="74" y="36" width="18" height="30" rx="3" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".3" />
      {bars.map((i) => (
        <rect
          key={i}
          className="eq"
          x={77 + i * 3.6}
          y="40"
          width="2.4"
          height="22"
          rx="1"
          fill={i % 2 ? GOLD_LIGHT : GREEN}
          style={{ animationDelay: `${i * 0.22}s`, animationDuration: `${1 + i * 0.25}s` }}
        />
      ))}
      <Led cx={86} cy={71} c={GREEN} />
      <rect x="16" y="82" width="88" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

function Gpu({ u }) {
  return (
    <>
      <path d="M16 28h88M16 74h88" stroke={GOLD} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
      <rect x="18" y="32" width="84" height="38" rx="5" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
      {[34, 60, 86].map((cx, i) => (
        <Fan key={cx} cx={cx} cy={51} r={11} n={7 - (i % 2)} />
      ))}
      {[28, 40, 52, 64, 76, 88].map((cx, i) => (
        <circle key={cx} className="led" cx={cx + 3} cy={66} r="1.1" fill={i % 3 === 0 ? GREEN : GOLD_LIGHT} style={{ animationDelay: `${i * 0.25}s` }} />
      ))}
      <rect x="14" y="78" width="92" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

function Tank({ u, id }) {
  const bubbles = [
    [36, 70, 0], [46, 74, 0.8], [58, 68, 1.5], [68, 74, 0.4], [78, 70, 1.1], [86, 74, 1.9], [52, 76, 2.2],
  ];
  return (
    <>
      <rect x="22" y="22" width="76" height="62" rx="8" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
      <rect x="25" y="36" width="70" height="45" rx="5" fill={`url(#l${id})`} />
      {[36, 52, 68, 84].map((x, i) => (
        <g key={x}>
          <rect x={x - 3} y="42" width="6" height="30" rx="1.5" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".4" />
          <Led cx={x} cy={48} d={i * 0.35} c={i % 2 ? GOLD_LIGHT : GREEN} />
          <Led cx={x} cy={56} d={i * 0.35 + 0.5} />
        </g>
      ))}
      {bubbles.map(([cx, cy, d], i) => (
        <circle key={i} className="bubble" cx={cx} cy={cy} r={i % 2 ? 1.4 : 1.9} fill={GOLD_LIGHT} style={{ animationDelay: `${d}s` }} />
      ))}
      <rect x="18" y="86" width="84" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

function Cabinet({ u }) {
  return (
    <>
      <rect x="34" y="12" width="52" height="78" rx="5" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
      <Fan cx={60} cy={21} r={6} n={4} />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 32 + i * 11;
        return (
          <g key={i}>
            <rect x="40" y={y} width="40" height="8" rx="2" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".3" />
            {[0, 1, 2, 3].map((j) => (
              <circle
                key={j}
                className="led"
                cx={46 + j * 5}
                cy={y + 4}
                r="1.1"
                fill={(i + j) % 3 === 0 ? GREEN : GOLD_LIGHT}
                style={{ animationDelay: `${((i * 4 + j) % 7) * 0.2}s` }}
              />
            ))}
            <path d={`M69 ${y + 4}h8`} stroke={GOLD} strokeOpacity=".3" />
          </g>
        );
      })}
      <rect className="scan" x="36" y="30" width="48" height="2" rx="1" fill={GREEN} opacity=".7" />
      <rect x="28" y="92" width="64" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

function Container({ u }) {
  return (
    <>
      <rect x="8" y="38" width="104" height="42" rx="3" fill={`url(#${u})`} stroke={GOLD} strokeOpacity=".55" />
      {[22, 34, 46, 58, 70, 82].map((x) => (
        <path key={x} d={`M${x} 42v34`} stroke={GOLD} strokeOpacity=".18" />
      ))}
      {[30, 60, 90].map((cx) => (
        <g key={cx}>
          <rect x={cx - 10} y="36" width="20" height="4" rx="1.5" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".4" />
          <Fan cx={cx} cy={32} r={6.5} n={4} />
        </g>
      ))}
      <rect x="92" y="48" width="14" height="26" rx="2" fill="#0e0d0a" stroke={GOLD} strokeOpacity=".4" />
      <Led cx={99} cy={54} c={GREEN} />
      <Led cx={99} cy={60} d={0.4} />
      <Led cx={99} cy={66} d={0.8} c={GREEN} />
      <path className="flow" d="M14 76h74" stroke={GREEN} strokeOpacity=".8" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="4" y="84" width="112" height="3" rx="1.5" fill={GOLD} opacity=".35" />
    </>
  );
}

const COIN_Y = { asic: 20, rack: 0, gpu: 22, tank: 15, cabinet: 6, container: 16 };

export default function RigArt({ kind = 'rack', units = 1, speed = 1.4, id = 'a' }) {
  const u = `u${id}`;
  const coinY = kind === 'rack' ? (100 - (units * 24 - 4)) / 2 - 3 : COIN_Y[kind] ?? 15;

  const body =
    kind === 'asic' ? <Asic u={u} />
    : kind === 'gpu' ? <Gpu u={u} />
    : kind === 'tank' ? <Tank u={u} id={id} />
    : kind === 'cabinet' ? <Cabinet u={u} />
    : kind === 'container' ? <Container u={u} />
    : <Rack units={units} u={u} />;

  return (
    <div className="art" style={{ '--spd': `${speed}s` }}>
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <defs>
          <linearGradient id={u} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#27241c" />
            <stop offset="1" stopColor="#161410" />
          </linearGradient>
          <linearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GOLD} stopOpacity=".28" />
            <stop offset="1" stopColor={GOLD} stopOpacity=".08" />
          </linearGradient>
          <radialGradient id={`g${id}`}>
            <stop offset="0" stopColor={GOLD} stopOpacity=".5" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse className="glow" cx="60" cy="52" rx="56" ry="40" fill={`url(#g${id})`} />

        {[0, 1, 2].map((i) => (
          <circle key={i} className="coin" cx={38 + i * 22} cy={coinY} r="2.4" fill={GOLD_LIGHT} style={{ animationDelay: `${i}s` }} />
        ))}

        {body}
      </svg>
    </div>
  );
}
