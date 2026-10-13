import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Application } from '../src/runtime/application.mjs';
import { discoverInstallations, inspectInstallation, stoppedDataSource } from '../src/runtime/installations.mjs';

function managerFixture() {
  let state = { active: { releaseId: 'installed-version', dataPath: '/kept-data' }, runtimeDesired: 'stopped' };
  return { busy: false, maintenance: false, runtime: { child: null, idle: async () => true, async stop() { this.child = null; } },
    isGatewayIdle: () => true, quiesce: async () => {}, state: async () => state, save: async value => { state = value; },
    async start() { this.runtime.child = { pid: 123 }; } };
}
test('start and stop retain registration/data and persist the requested state', async () => {
  const manager = managerFixture(), app = new Application({}, manager);
  await app.launch(); assert.ok(manager.runtime.child); assert.equal((await manager.state()).runtimeDesired, 'running');
  await app.stop(); assert.equal(manager.runtime.child, null); assert.equal((await manager.state()).runtimeDesired, 'stopped');
  assert.equal((await manager.state()).active.dataPath, '/kept-data'); assert.equal(manager.busy, false);
});
test('active tasks refuse stop without terminating the managed runtime', async () => {
  const manager = managerFixture(), app = new Application({}, manager);
  await app.launch(); manager.runtime.idle = async () => false;
  await assert.rejects(app.stop(), /current task/);
  assert.ok(manager.runtime.child); assert.equal(manager.maintenance, false);
});
test('failed startup retains a visible error and releases the operation lock', async () => {
  const manager = managerFixture(), app = new Application({}, manager);
  manager.start = async () => { throw Error('fixture startup failed'); };
  await assert.rejects(app.launch(), /startup failed/);
  assert.equal(app.job.phase, 'failed'); assert.equal(manager.busy, false);
});
test('a second attach cannot replace registered data with an unrelated install', async () => {
  const manager = managerFixture(), app = new Application({}, manager);
  await assert.rejects(app.attach({ binary: '/other' }), /already attached/);
  assert.equal((await manager.state()).active.dataPath, '/kept-data'); assert.equal(manager.busy, false);
});
test('discovery accepts arbitrary installed version numbers without executing binaries', async t => {
  const home = await mkdtemp(join(tmpdir(), 'cs-installations-')); t.after(() => rm(home, { recursive: true }));
  const root = join(home, 'apps/operon-custom'); await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'operon'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  await writeFile(join(root, 'assets/BUILD.json'), JSON.stringify({ version: '99.42.123' }));
  const result = await discoverInstallations(home);
  assert.ok(result.some(item => item.version === '99.42.123' && item.compatibility === 'not_checked'));
  await writeFile(join(root, 'windows.exe'), 'MZ fixture');
  await assert.rejects(inspectInstallation(join(root, 'windows.exe')), /platform adapter/);
});
test('data import rejects an open source and accepts it only after closing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cs-data-import-')); t.after(() => rm(root, { recursive: true }));
  const home = join(root, 'state'), source = join(root, 'source'), proc = join(root, 'proc');
  await mkdir(home); await mkdir(source); await mkdir(join(proc, '999999/fd'), { recursive: true });
  await symlink(join(source, 'science.db'), join(proc, '999999/fd/10'));
  await assert.rejects(stoppedDataSource(source, home, proc), /in use/);
  await rm(join(proc, '999999/fd/10'));
  assert.equal(await stoppedDataSource(source, home, proc), source);
  await assert.rejects(stoppedDataSource(root, home, proc), /parent or state root/);
});
