// Tiny sparkline. Scales the series to its own min and max.
export default function Spark({ values, color = 'var(--gold)' }) {
  if (!values || values.length < 2) values = [0, 0];
  const min = Math.min(...values);
  const flat = Math.max(...values) === min;
  const span = Math.max(...values) - min || 1;
  const n = values.length;
  const pts = values
    .map((v, i) => `${((i * 100) / (n - 1)).toFixed(1)},${(flat ? 14 : 26 - ((v - min) / span) * 22).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="sp" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
