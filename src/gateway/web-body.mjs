import { Readable, Transform, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import { invariant, BridgeError } from '../core/errors.mjs';

export async function readWebBody(response, maxBytes, signal) {
  const encoding = response.headers.get('content-encoding')?.toLowerCase() || 'identity';
  const makeDecoder = { identity: () => new PassThrough(), gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate }[encoding];
  invariant(makeDecoder, 'unsupported_content_type', 'Unsupported web content encoding.');
  invariant(Number(response.headers.get('content-length') || 0) <= maxBytes, 'content_too_large', 'Web resource exceeds its byte limit.');
  if (!response.body) return Buffer.alloc(0);
  const raw = Readable.fromWeb(response.body), decoded = makeDecoder(); let received = 0, expanded = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    received += chunk.length;
    done(received > maxBytes ? new BridgeError('content_too_large', 'Compressed web resource exceeds its byte limit.') : null, chunk);
  } });
  const flow = pipeline(raw, limit, decoded, { signal });
  flow.catch(() => {}); // Consumed below; prevent a detached rejection on abort.
  try {
    const chunks = [];
    for await (const chunk of decoded) {
      signal.throwIfAborted(); expanded += chunk.length;
      invariant(expanded <= maxBytes, 'content_too_large', 'Expanded web resource exceeds its byte limit.'); chunks.push(chunk);
    }
    await flow; return Buffer.concat(chunks);
  } finally { raw.destroy(); limit.destroy(); decoded.destroy(); await flow.catch(() => {}); }
}
