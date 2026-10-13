import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicJson } from '../src/core/files.mjs';
import { initialState } from '../src/core/config.mjs';
import { UpdateManager } from '../src/update/manager.mjs';
import { Discovery } from '../src/update/discovery.mjs';

async function setup(t, fail = false) {
  const home = await mkdtemp(join(tmpdir(), 'cs-switch-update-')); t.after(() => rm(home, { recursive: true }));
  const original = join(home, 'original'); await mkdir(original); await writeFile(join(original, 'science-data'), 'original');
  const runtime = { child: { pid: 1 }, dataPath: original, release: { id: 'old' }, isIdle: true,
    async idle() { return this.isIdle; }, async stop() { this.child = null; },
    async start(release, path) { this.child = { pid: 2 }; this.dataPath = path; this.release = release;
      if (release.id === 'new') { await writeFile(join(path, 'science-data'), 'migrated'); if (fail) { this.child = null; throw Error('candidate failed'); } } },
    async smoke() { return { version: this.release.id, sandbox: true }; },
  };
  const config = { home, update: { autoApply: true, intervalMs: 60000, feed: 'https://example.test', channel: 'latest', catalogDirectory: join(home, 'inbox') } };
  const state = initialState(); state.active = { releaseId: 'old', dataPath: original }; await atomicJson(join(home, 'state.json'), state);
  const manager = new UpdateManager(config, runtime, { verify: async path => ({ id: basename(path), path }) });
  return { home, original, runtime, config, manager };
}
test('candidate migrations never mutate the previous data generation', async t => {
  const { manager, original } = await setup(t);
  const state = await manager.apply('new');
  assert.equal(await readFile(join(original, 'science-data'), 'utf8'), 'original');
  assert.equal(await readFile(join(state.active.dataPath, 'science-data'), 'utf8'), 'migrated');
  assert.equal(state.previous.dataPath, original); assert.equal(state.update.phase, 'ready');
});
test('failed upgrade restarts the original runtime and retains diagnostic candidate data', async t => {
  const { manager, original, runtime } = await setup(t, true);
  await assert.rejects(manager.apply('new'), /candidate failed/);
  const state = await manager.state();
  assert.equal(state.active.dataPath, original); assert.equal(runtime.release.id, 'old');
  assert.equal(state.update.phase, 'rejected'); assert.ok(state.candidate);
  assert.equal(await readFile(join(original, 'science-data'), 'utf8'), 'original');
});
test('busy scientific tasks defer update without stopping or copying the runtime', async t => {
  const { manager, runtime } = await setup(t); runtime.isIdle = false;
  await assert.rejects(manager.apply('new'), /deferred/);
  assert.equal(runtime.child.pid, 1); assert.equal((await manager.state()).active.releaseId, 'old');
});
test('rollback selects the matched snapshot and retains newer work separately', async t => {
  const { manager, runtime, original } = await setup(t);
  const applied = await manager.apply('new'), newer = applied.active.dataPath;
  await writeFile(join(newer, 'new-work'), 'retained');
  const rolledBack = await manager.rollback();
  assert.equal(runtime.dataPath, original); assert.equal(rolledBack.active.releaseId, 'old');
  assert.equal(await readFile(join(newer, 'new-work'), 'utf8'), 'retained');
});
test('interrupted validation recovers the committed generation on restart', async t => {
  const { manager, original } = await setup(t);
  const state = await manager.state(); state.update.phase = 'validating'; state.candidate = { releaseId: 'new', dataPath: 'unused' }; await manager.save(state);
  await manager.start(); const recovered = await manager.state();
  assert.equal(recovered.active.dataPath, original); assert.equal(recovered.update.phase, 'interrupted_update_recovered');
});
test('unreachable official feed is visible and leaves the runtime unchanged', async t => {
  const { config, manager } = await setup(t);
  const discovery = new Discovery(config, manager, { fetch: async () => { throw new TypeError('network'); } });
  const result = await discovery.check();
  assert.equal(result.phase, 'blocked'); assert.equal(result.error.code, 'update_network');
  assert.equal((await manager.state()).active.releaseId, 'old');
});
test('stopped applications do not auto-update or restart behind the user', async t => {
  const { config, manager } = await setup(t);
  const state = await manager.state(); state.runtimeDesired = 'stopped'; await manager.save(state);
  const discovery = new Discovery(config, manager, { fetch: async () => { throw Error('must not fetch'); } });
  assert.equal((await discovery.check()).phase, 'application_stopped');
});
test('a manual downgrade cannot open newer data with an older runtime', async t => {
  const { manager, runtime } = await setup(t);
  manager.verify = async path => ({ id: basename(path), path, builtAt: basename(path) === 'old' ? '2026-10-10' : '2026-01-01' });
  await assert.rejects(manager.apply('new'), /Use rollback/);
  assert.equal(runtime.child.pid, 1);
});
