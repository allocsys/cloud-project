// Shimmering placeholders, shown only when a screen has no data at all yet (a first-ever start, nothing saved on the phone).
// Once any data has been seen, the saved copy fills the screen at once (lib/api.js) and these are not needed.
// Styles: .sk in app/globals.css.

// One shimmering block. w and h are CSS sizes (numbers are px); r overrides the corner radius.
export function Sk({ w = '100%', h = 14, r, style }) {
  return <i className="sk" aria-hidden="true" style={{ width: w, height: h, ...(r !== undefined ? { borderRadius: r } : null), ...style }} />;
}

// A card with a short heading and a few lines.
export function SkCard({ lines = 3, heading = true }) {
  return (
    <div className="card skc" aria-hidden="true">
      {heading && <Sk w="38%" h={16} />}
      {Array.from({ length: lines }).map((_, i) => (
        <Sk key={i} w={i === lines - 1 ? '62%' : '100%'} h={12} />
      ))}
    </div>
  );
}

// The big number card: a label, a big figure and four small figures.
export function SkHero() {
  return (
    <div className="card hero skc" aria-hidden="true">
      <Sk w="34%" h={12} />
      <Sk w="68%" h={38} r={10} />
      <Sk w="26%" h={12} />
      <div className="skrow">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skcol">
            <Sk w="70%" h={16} />
            <Sk w="50%" h={10} />
          </div>
        ))}
      </div>
    </div>
  );
}

// The Earnings screen before its first data.
export function SkDash() {
  return (
    <>
      <SkHero />
      <SkCard lines={2} heading={false} />
      <div className="pair">
        <SkCard lines={2} />
        <SkCard lines={2} />
      </div>
    </>
  );
}
