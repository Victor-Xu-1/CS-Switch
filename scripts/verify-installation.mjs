import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initialize } from '../src/core/config.mjs';
import { serve } from '../src/server.mjs';
import { hashFile, atomicJson } from '../src/core/files.mjs';

const [binary, home] = process.argv.slice(2);
if (!binary || !home) throw Error('Usage: verify-installation.mjs ORIGINAL_BINARY NEW_ISOLATED_HOME');
const beforeHash = await hashFile(binary);
const config = await initialize(home, { port: 19970, appPort: 19971, modelPort: 19972, sandboxPort: 19973,
  network: { proxy: process.env.HTTPS_PROXY || null } });
config.update.autoApply = false;
const service = await serve(config);
const origin = `http://127.0.0.1:${config.port}`;
const request = async (path, input) => {
  const response = await fetch(origin + '/_bridge/api/' + path, input === undefined ? {} : { method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-cs-switch': '1' }, body: JSON.stringify(input) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
};
try {
  assert.equal((await fetch(origin + '/_bridge/')).status, 200);
  assert.equal((await request('status')).runtime, null);
  console.log(JSON.stringify({ workbenchBeforeRuntime: true }));
  await request('application/attach', { binary, dataPath: '' });
  const deadline = Date.now() + 300000;
  let status, phase;
  do {
    status = await request('status');
    if (phase !== status.application.phase) { phase = status.application.phase; console.log(JSON.stringify({ phase, error: status.application.error })); }
    if (['ready', 'failed'].includes(phase)) break;
    await delay(1000);
  } while (Date.now() < deadline);
  assert.equal(phase, 'ready', JSON.stringify(status.application));
  assert.equal(status.runtime.sandbox, true);
  const version = status.runtime.version;
  await request('application/stop', {});
  assert.equal((await request('status')).runtime, null);
  assert.equal((await fetch(origin + '/_bridge/')).status, 200);
  await request('application/start', {});
  assert.equal((await request('status')).runtime.version, version);
  assert.match(await (await fetch(origin + '/')).text(), /<html[\s>]/i);
  assert.equal(await hashFile(binary), beforeHash);
  const evidence = { version, sourceHash: beforeHash, workbenchBeforeRuntime: true, attached: true, stopped: true,
    restarted: true, frontend: true, originalUnchanged: true, capabilities: status.state.lastValidation.capabilities };
  await atomicJson(join(home, 'installation-evidence.json'), evidence);
  console.log(JSON.stringify(evidence, null, 2));
} finally { await service.close(); }
