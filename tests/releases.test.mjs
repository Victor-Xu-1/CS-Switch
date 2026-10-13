import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { importRelease, verifyRelease, listReleases } from '../src/runtime/releases.mjs';
import { verifyBinarySignature, verifyOrdering } from '../src/update/trust.mjs';
import { adaptBackend } from '../src/runtime/adapter.mjs';

async function layout(t) {
  const root = await mkdtemp(join(tmpdir(), 'cs-switch-release-')); t.after(() => rm(root, { recursive: true }));
  const source = join(root, 'source'), home = join(root, 'home');
  await mkdir(join(source, 'app_bundle_raw'), { recursive: true }); await mkdir(join(source, 'assets/web-dist/assets'), { recursive: true });
  await writeFile(join(source, 'assets/BUILD.json'), JSON.stringify({ version: '1.0.0', platform: 'linux-x64', built_at: '2026-01-01T00:00:00Z' }));
  await writeFile(join(source, 'assets/web-dist/index.html'), '<html><script src="./assets/main.js"></script></html>');
  await writeFile(join(source, 'assets/web-dist/assets/main.js'), 'console.log("fixture")');
  await writeFile(join(source, 'app_bundle_raw/claude-science.bundle.js'), '/* OPERON_LOCAL_PROVIDER_MODE ANTHROPIC_BASE_URL /daemon/status active_frames */');
  return { source, home };
}
test('runtime import pins all files and detects later tampering', async t => {
  const { home, source } = await layout(t), release = await importRelease(home, source);
  assert.equal((await verifyRelease(release.path)).version, '1.0.0');
  await writeFile(join(release.path, 'assets/web-dist/assets/main.js'), 'tampered');
  await assert.rejects(verifyRelease(release.path), /changed/);
});
test('catalog digest mismatch is never registered as an installable release', async t => {
  const { home, source } = await layout(t);
  await assert.rejects(importRelease(home, source, '12345678', '0'.repeat(64)), /reviewed catalog digest/);
  assert.deepEqual(await listReleases(home), []);
});
test('internal asset symlinks survive import, external symlinks are rejected', async t => {
  const { home, source } = await layout(t);
  await symlink('web-dist', join(source, 'assets/linked-web'));
  const release = await importRelease(home, source); await verifyRelease(release.path);
  await symlink('/etc/passwd', join(source, 'assets/outside'));
  await assert.rejects(importRelease(home, source), /leaves its root/);
});
test('signed release statement binds binary hash, release ID and filename', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const id = '1234abcd', digest = 'a'.repeat(64), filename = 'operon-linux-x64';
  const message = Buffer.concat([Buffer.from(`operon-binary-sig-v2\n${id}\n${filename}\n`), Buffer.from(digest, 'hex')]);
  const signature = sign('RSA-SHA256', message, privateKey);
  verifyBinarySignature(id, filename, digest, signature, publicKey);
  assert.throws(() => verifyBinarySignature('abcd1234', filename, digest, signature, publicKey), /verification failed/);
  assert.throws(() => verifyBinarySignature(id, filename, 'b'.repeat(64), signature, publicKey), /verification failed/);
});
test('signed release ordering refuses downgrade and transplantation', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ordering = { sha8: '1234abcd', staged_at: '2026-10-01T00:00:00Z', run_attempt: 1 };
  const signature = sign('RSA-SHA256', Buffer.from(`operon-release-ordering-v1\n${ordering.sha8}\n${ordering.staged_at}\n1\n`), privateKey);
  assert.equal(verifyOrdering(ordering.sha8, ordering, signature, 0, publicKey), Date.parse(ordering.staged_at));
  assert.throws(() => verifyOrdering(ordering.sha8, ordering, signature, Date.parse('2026-10-02'), publicKey), /version floor/);
  assert.throws(() => verifyOrdering('abcd1234', ordering, signature, 0, publicKey), /ordering statement/);
});
test('unknown backend layouts fail before any partial adapter output', () => {
  assert.throws(() => adaptBackend('export const unknown = true;'), /boundary changed/);
});
