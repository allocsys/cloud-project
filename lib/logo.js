// The Vertexhash mark: a gold wedge V sliced by two slanted cuts (a hash / scan line) on near-black.
// One source for the PNG app icons and, kept in step by hand, public/logo.svg.
// The mark is drawn on a 120 grid (wedge V from 8,22 to 112,22 down to the tip at 60,100) and scaled to sit centred in the 512 icon.
const MARK_SCALE = 3.1;

export function logoSvg({ rx = 0, scale = 1 } = {}) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f6dc9a"/><stop offset="0.55" stop-color="#e9c46a"/><stop offset="1" stop-color="#c99a3a"/>' +
    '</linearGradient></defs>' +
    `<rect width="512" height="512" rx="${rx}" fill="#12110d"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<g transform="translate(256 256) scale(${MARK_SCALE}) translate(-60 -61)">` +
    '<path d="M8 22H38L60 64L82 22H112L60 100Z" fill="url(#g)"/>' +
    '<path d="M26 63L100 33" stroke="#12110d" stroke-width="4.5" fill="none"/>' +
    '<path d="M24 84L96 55" stroke="#12110d" stroke-width="4.5" fill="none"/>' +
    '</g></g></svg>'
  );
}
