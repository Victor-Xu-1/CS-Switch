import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.mjs';
import { readJson } from '../src/core/files.mjs';
import { RuntimeProcess } from '../src/runtime/process.mjs';

// Read-only deployed baseline: no model calls, tasks, approvals or state writes.
const config = await loadConfig(process.argv[2]);
const origin = `http://127.0.0.1:${config.port}`;
const response = await fetch(`${origin}/_bridge/api/status`);
assert.equal(response.status, 200);
const status = await response.json();
const manifest = await readJson(join(config.home, 'releases', status.state.active.releaseId, 'release.json'));
assert.equal(status.runtime.version, manifest.version);
const runtime = new RuntimeProcess(config, '');
runtime.port = config.appPort;
runtime.release = manifest;
const checks = await runtime.smoke({ requireEnvironments: true });
for (const path of ['/_bridge/', '/_bridge/app.js', '/_bridge/i18n.js', '/_bridge/ui.js', '/_bridge/settings.js', '/_bridge/application.js', '/_bridge/latest.js', '/_bridge/style.css']) {
  const result = await fetch(origin + path);
  assert.equal(result.status, 200, path);
  await result.body.cancel();
}
let revision = 'uncommitted';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* bootstrap checkout */ }
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), revision, origin, bridgeVersion: status.bridgeVersion,
  runningRevision: status.bridgeRevision, sourceDirty: status.sourceDirty, releaseId: status.state.active.releaseId, checks }, null, 2));
if (process.argv.includes('--require-clean')) {
  assert.equal(status.bridgeRevision, revision, 'Service must run the checkout revision.');
  assert.equal(status.sourceDirty, false, 'Release service must start from clean source.');
}
