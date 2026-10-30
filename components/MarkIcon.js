// The Vertexhash mark (wedge V with two slanted cuts) for the gold tiles. The wedge takes the tile's text colour, the cuts take the tile's gold, so it works in light and dark.
export default function MarkIcon() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <g transform="translate(16.5 21)">
        <path d="M0 0H28.5L43.5 44L58.5 0H87L43.5 78Z" fill="currentColor" />
        <path d="M-6 47.1L96 5.6" style={{ stroke: 'var(--gold-c)' }} strokeWidth="4" fill="none" />
        <path d="M-6 65.1L96 23.5" style={{ stroke: 'var(--gold-c)' }} strokeWidth="4" fill="none" />
      </g>
    </svg>
  );
}
