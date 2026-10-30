// The Vertexhash mark (wedge V with two slanted cuts) for the gold tiles. The wedge takes the tile's text colour, the cuts take the tile's gold, so it works in light and dark.
export default function MarkIcon() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M8 22H38L60 64L82 22H112L60 100Z" fill="currentColor" />
      <path d="M26 63L100 33" style={{ stroke: 'var(--gold-c)' }} strokeWidth="4.5" fill="none" />
      <path d="M24 84L96 55" style={{ stroke: 'var(--gold-c)' }} strokeWidth="4.5" fill="none" />
    </svg>
  );
}
