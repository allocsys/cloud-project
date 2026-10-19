// Small HTTP helpers shared by the server and the API routes.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Reads a JSON object body of at most `max` bytes.
export async function readJson(req, max = 10_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new ApiError(413, 'Body too large.');
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Body must be a JSON object.');
  return body;
}
