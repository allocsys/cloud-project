// The Vertexhash mark: a gold V whose right arm is also the left stem of an H (a VH monogram) on near-black.
// One source for the PNG app icons and, kept in step by hand, public/logo.svg.
// The mark is drawn on a 120 grid (V from 20,22 down to 58,98 and up the shared stem, crossbar at y 60, right stem at x 98) and scaled to sit centred in the 512 icon.
const MARK_SCALE = 3.45;

export function logoSvg({ rx = 0, scale = 1 } = {}) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f6dc9a"/><stop offset="0.55" stop-color="#e9c46a"/><stop offset="1" stop-color="#c99a3a"/>' +
    '</linearGradient></defs>' +
    `<rect width="512" height="512" rx="${rx}" fill="#12110d"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<g transform="translate(256 256) scale(${MARK_SCALE}) translate(-59 -60)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    '<path d="M98 22V98" stroke="#c99a3a" stroke-width="14"/>' +
    '<path d="M58 60H98" stroke="#c99a3a" stroke-width="12"/>' +
    '<path d="M20 22L58 98V22" stroke="url(#g)" stroke-width="14"/>' +
    '</g></g></svg>'
  );
}
