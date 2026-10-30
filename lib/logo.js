// The Vertexhash mark: a gold V between two stems (a VH monogram) on near-black.
// One source for the PNG app icons and, kept in step by hand, public/logo.svg.
// The mark is drawn on a 120 grid (stems x 18..32 and 88..102, V from 44,22 down to 60,94) and scaled to sit centred in the 512 icon.
const MARK_SCALE = 3.78;

export function logoSvg({ rx = 0, scale = 1 } = {}) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f6dc9a"/><stop offset="0.55" stop-color="#e9c46a"/><stop offset="1" stop-color="#c99a3a"/>' +
    '</linearGradient></defs>' +
    `<rect width="512" height="512" rx="${rx}" fill="#12110d"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<g transform="translate(256 256) scale(${MARK_SCALE}) translate(-60 -58)">` +
    '<rect x="18" y="20" width="14" height="80" rx="3" fill="#c99a3a"/>' +
    '<rect x="88" y="20" width="14" height="80" rx="3" fill="#c99a3a"/>' +
    '<path d="M44 22L60 94L76 22" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</g></g></svg>'
  );
}
