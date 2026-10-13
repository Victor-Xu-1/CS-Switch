import { invariant } from '../core/errors.mjs';

export function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

export async function body(request, max = 16 * 1024 * 1024) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; invariant(bytes <= max, 'body_too_large', 'Request exceeds maximum body size.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) { invariant(false, 'invalid_json', 'Request body must be valid JSON.'); }
}

export function checkHost(request, port) {
  invariant([`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host), 'invalid_host', 'Unrecognized local host.', 403);
}

export function checkOrigin(request, port, mutation = false) {
  const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const origin = request.headers.origin;
  invariant(!origin || allowed.includes(origin), 'invalid_origin', 'Cross-origin access is not allowed.', 403);
  if (mutation) invariant(allowed.includes(origin) && request.headers['x-cs-switch'] === '1', 'csrf', 'Use the local CS-Switch interface for configuration changes.', 403);
}
