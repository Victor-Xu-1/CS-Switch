import { mkdir, readFile, rename, open, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { invariant } from './errors.mjs';

export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function inside(root, relative) {
  invariant(typeof relative === 'string' && relative.length > 0, 'invalid_path', 'Relative file path required.');
  const target = resolve(root, relative);
  invariant(target.startsWith(resolve(root) + sep), 'invalid_path', 'Path leaves its managed directory.');
  return target;
}

export async function regularInside(root, relative) {
  const path = inside(root, relative);
  const stat = await lstat(path);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'invalid_file', 'Expected a regular file.');
  const resolved = await realpath(path);
  invariant(resolved.startsWith(await realpath(root) + sep), 'invalid_file', 'File resolves outside the release.');
  return path;
}

export function serial() {
  let tail = Promise.resolve();
  return (action) => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
}
