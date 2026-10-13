import { invariant } from '../core/errors.mjs';
import { once } from 'node:events';

export async function* events(body) {
  const decoder = new TextDecoder();
  let buffer = '', data = [], event = '';
  const line = (value) => {
    if (value === '') {
      const result = data.length ? { event, data: data.join('\n') } : null;
      data = []; event = ''; return result;
    }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    else if (value.startsWith('event:')) event = value.slice(6).trim();
    return null;
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    invariant(buffer.length < 4 * 1024 * 1024, 'upstream_protocol', 'SSE event exceeds the configured limit.', 502);
    let position;
    while ((position = buffer.indexOf('\n')) >= 0) {
      const result = line(buffer.slice(0, position).replace(/\r$/, ''));
      buffer = buffer.slice(position + 1);
      if (result) yield result;
    }
  }
  buffer += decoder.decode();
  if (buffer) { const result = line(buffer.replace(/\r$/, '')); if (result) yield result; }
  const final = line(''); if (final) yield final;
}

export async function sendEvent(response, type, body) {
  if (response.destroyed) throw new DOMException('Client disconnected', 'AbortError');
  if (!response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`)) {
    await once(response, 'drain', { signal: AbortSignal.timeout(30000) });
  }
}
