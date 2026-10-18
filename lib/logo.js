// The Opus mark: a gold hexagon (a mining chip) with three rising hashrate bars.
// One source for the PNG app icons and, kept in step by hand, public/logo.svg.
export function logoSvg({ rx = 0, scale = 1 } = {}) {
  const hex = (r) => {
    const w = Math.round(r * 0.866);
    const h = Math.round(r / 2);
    return `M256 ${256 - r}L${256 + w} ${256 - h}L${256 + w} ${256 + h}L256 ${256 + r}L${256 - w} ${256 + h}L${256 - w} ${256 - h}Z`;
  };
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f6dc9a"/><stop offset="0.55" stop-color="#e9c46a"/><stop offset="1" stop-color="#c99a3a"/>' +
    '</linearGradient></defs>' +
    `<rect width="512" height="512" rx="${rx}" fill="#12110d"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">` +
    `<path d="${hex(200)}" fill="none" stroke="url(#g)" stroke-width="5" stroke-linejoin="round" opacity="0.4"/>` +
    `<path d="${hex(160)}" fill="url(#g)" stroke="url(#g)" stroke-width="28" stroke-linejoin="round"/>` +
    '<g fill="#12110d"><rect x="196" y="272" width="28" height="56" rx="8"/><rect x="242" y="232" width="28" height="96" rx="8"/><rect x="288" y="192" width="28" height="136" rx="8"/></g>' +
    '</g></svg>'
  );
}
