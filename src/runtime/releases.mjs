import { readFile, readdir, mkdir, cp, rename, lstat, readlink, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJson, hashFile, readJson, regularInside } from '../core/files.mjs';
import { invariant } from '../core/errors.mjs';

// Immutable output of the reviewed semantic adapter, or a local prepared runtime.
export const adapterId = 'operon-prepared-v1';
const roots = ['app_bundle_raw', 'assets'];

async function inventory(root, prefix = '', result = { files: {}, links: {} }) {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await realpath(join(root, path));
      invariant(resolved.startsWith(await realpath(root) + sep), 'release_symlink', `Release symlink leaves its root: ${path}`);
      result.links[path.replaceAll('\\', '/')] = await readlink(join(root, path));
    }
    else if (entry.isDirectory()) await inventory(root, path, result);
    else {
      invariant(entry.isFile(), 'release_file', `Unsupported release entry: ${path}`);
      result.files[path.replaceAll('\\', '/')] = await hashFile(join(root, path));
    }
  }
  return result;
}

export async function inspectPrepared(root) {
  const build = await readJson(join(root, 'assets/BUILD.json'));
  invariant(build.platform === 'linux-x64' && typeof build.version === 'string', 'runtime_platform', 'Expected a Linux x64 prepared Operon runtime.');
  const bundle = await readFile(await regularInside(root, 'app_bundle_raw/claude-science.bundle.js'), 'utf8');
  invariant(bundle.includes('OPERON_LOCAL_PROVIDER_MODE') && bundle.includes('ANTHROPIC_BASE_URL'), 'adapter_required', 'This runtime has no reviewed local-provider entry. A new upstream adapter is required; no speculative patch was applied.');
  invariant(bundle.includes('/daemon/status') && bundle.includes('active_frames'), 'adapter_required', 'Runtime lacks the required idle/health contract.');
  const html = await readFile(await regularInside(root, 'assets/web-dist/index.html'), 'utf8');
  invariant(/<html[\s>]/i.test(html) && /<script\s/i.test(html), 'invalid_web', 'Runtime web entry is missing.');
  return { version: build.version, builtAt: build.built_at, platform: build.platform };
}

export async function importRelease(home, source, upstreamId = null, expectedTreeHash = null) {
  const identity = await inspectPrepared(source);
  const releaseHome = join(home, 'releases');
  await mkdir(releaseHome, { recursive: true, mode: 0o700 });
  const staging = join(releaseHome, `.staging-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  for (const name of roots) await cp(join(source, name), join(staging, name), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true });
  for (const receipt of ['adaptation.json', 'extraction.json']) {
    try { await cp(join(source, receipt), join(staging, receipt)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // The original native binary is kept only as provenance and official update checker.
  const original = join(source, 'operon');
  try { if ((await lstat(original)).isFile()) await cp(original, join(staging, 'operon')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const contents = await inventory(staging);
  const digest = createHash('sha256').update(JSON.stringify(contents)).digest('hex');
  invariant(!expectedTreeHash || digest === expectedTreeHash, 'release_integrity', 'Prepared runtime differs from the reviewed catalog digest.', 409);
  const id = `${identity.version.replace(/[^A-Za-z0-9._-]/g, '_')}-${digest.slice(0, 12)}`;
  const manifest = { schema: 1, id, adapter: adapterId, ...identity, upstreamId,
    createdAt: new Date().toISOString(), provenance: 'user-owned-prepared-runtime', treeHash: digest, ...contents };
  await atomicJson(join(staging, 'release.json'), manifest);
  const final = join(releaseHome, id);
  try { await rename(staging, final); }
  catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    // Keep a recoverable staging copy; never overwrite an existing immutable release.
    await verifyRelease(final);
  }
  return { ...manifest, path: final };
}

export async function verifyRelease(root) {
  const manifest = await readJson(join(root, 'release.json'));
  invariant(manifest.schema === 1 && manifest.adapter === adapterId, 'adapter_required', 'Unsupported release manifest/adapter.');
  const expected = manifest.files;
  invariant(expected && Object.keys(expected).length > 0, 'release_integrity', 'Release has no integrity manifest.');
  for (const [path, digest] of Object.entries(expected)) {
    invariant(/^[a-f0-9]{64}$/.test(digest), 'release_integrity', 'Invalid file digest.');
    invariant(await hashFile(await regularInside(root, path)) === digest, 'release_integrity', `Release file changed: ${path}`, 409);
  }
  for (const [path, target] of Object.entries(manifest.links || {})) {
    invariant((await lstat(join(root, path))).isSymbolicLink() && await readlink(join(root, path)) === target, 'release_integrity', `Release symlink changed: ${path}`);
    invariant((await realpath(join(root, path))).startsWith(await realpath(root) + sep), 'release_integrity', 'Release symlink escapes root.');
  }
  const identity = await inspectPrepared(root);
  invariant(identity.version === manifest.version, 'release_integrity', 'Build and manifest versions differ.');
  return { ...manifest, path: await realpath(root) };
}

export async function listReleases(home) {
  const root = join(home, 'releases');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const releases = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifest = await readJson(join(root, entry.name, 'release.json'));
    invariant(manifest.id === entry.name, 'release_integrity', 'Release directory identity mismatch.');
    releases.push({ id: manifest.id, version: manifest.version, upstreamId: manifest.upstreamId, adapter: manifest.adapter, createdAt: manifest.createdAt });
  }
  return releases;
}
