// The Vertexhash mark: a gold wedge V sliced by two slanted cuts (a hash / scan line) on near-black.
// One source for the PNG app icons and, kept in step by hand, public/logo.svg.
// The mark is drawn on an 87 x 78 grid (wedge V from 0,0 to 87,0 down to the tip at 43.5,78, notch tip at 43.5,44) and scaled to sit centred in the 512 icon.
const MARK_SCALE = 3.7;

export function logoSvg({ rx = 0, scale = 1 } = {}) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f6dc9a"/><stop offset="0.55" stop-color="#e9c46a"/><stop offset="1" stop-color="#c99a3a"/>' +
    '</linearGradient></defs>' +
    `<rect width="512" height="512" rx="${rx}" fill="#12110d"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<g transform="translate(256 256) scale(${MARK_SCALE}) translate(-43.5 -39)">` +
    '<path d="M0 0H28.5L43.5 44L58.5 0H87L43.5 78Z" fill="url(#g)"/>' +
    '<path d="M-6 47.1L96 5.6" stroke="#12110d" stroke-width="4" fill="none"/>' +
    '<path d="M-6 65.1L96 23.5" stroke="#12110d" stroke-width="4" fill="none"/>' +
    '</g></g></svg>'
  );
}
