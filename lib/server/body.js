// Reads a request body into a Buffer but gives up as soon as it grows past `max` bytes. The Content-Length header is only a hint
// (a chunked request has none, and a client can lie), so the real size is counted while reading. Returns null when it is too big.
export async function readCapped(req, max) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
