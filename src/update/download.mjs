import { mkdir, open, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile, atomicJson } from '../core/files.mjs';
import { invariant } from '../core/errors.mjs';
import { verifyBinarySignature, verifyOrdering } from './trust.mjs';

async function readBounded(response, limit) {
  invariant(response.ok, 'download_http', `Release server returned HTTP ${response.status}.`, 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    invariant(size <= limit, 'download_size', 'Release metadata exceeds its size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function downloadOfficial(config, id, request, floor = 0) {
  invariant(/^[a-f0-9]{8}$/.test(id), 'release_identity', 'Expected an upstream SHA8 release ID.');
  const base = config.update.feed.replace(/\/$/, '');
  invariant(base === 'https://storage.googleapis.com/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59/operon-releases', 'release_origin', 'Automatic binary downloads are limited to the pinned official release origin.');
  const filename = 'operon-linux-x64';
  const get = async (name, limit) => readBounded(await request(`${base}/${id}/${name}`, { signal: AbortSignal.timeout(30000), redirect: 'error' }), limit);
  const [manifestBytes, signature, orderingBytes, orderingSignature] = await Promise.all([
    get('manifest.json', 1024 * 1024), get(`${filename}.sig`, 4096), get('ordering.json', 16384), get('ordering.sig', 4096),
  ]);
  const manifest = JSON.parse(manifestBytes), ordering = JSON.parse(orderingBytes);
  invariant(manifest.sha8 === id, 'release_identity', 'Release manifest identity mismatch.');
  const digest = manifest.sha256?.['linux-x64'];
  verifyBinarySignature(id, filename, digest, signature);
  const epoch = verifyOrdering(id, ordering, orderingSignature, floor);
  const directory = join(config.home, 'downloads', `${id}-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const partial = join(directory, 'operon.partial'), final = join(directory, 'operon');
  const response = await request(`${base}/${id}/${filename}`, { signal: AbortSignal.timeout(600000), redirect: 'error' });
  invariant(response.ok, 'download_http', `Binary download returned HTTP ${response.status}.`, 502);
  const file = await open(partial, 'wx', 0o600); let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length; invariant(bytes < 1024 * 1024 * 1024, 'download_size', 'Binary download exceeds 1 GiB.');
      await file.write(chunk);
    }
    await file.sync();
  } finally { await file.close(); }
  invariant(await hashFile(partial) === digest, 'release_integrity', 'Downloaded binary SHA-256 does not match its verified signature.', 409);
  await rename(partial, final); await chmod(final, 0o500);
  const receipt = { id, version: manifest.version, digest, epoch, bytes, officialSignatureVerified: true, url: `${base}/${id}/${filename}`, downloadedAt: new Date().toISOString() };
  await atomicJson(join(directory, 'provenance.json'), receipt);
  return { ...receipt, binary: final, directory };
}
