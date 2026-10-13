import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { json, body, checkOrigin } from './http.mjs';
import { readJson } from '../core/files.mjs';
import { invariant } from '../core/errors.mjs';
import { listReleases } from '../runtime/releases.mjs';
import { discoverInstallations } from '../runtime/installations.mjs';

const webRoot = fileURLToPath(new URL('../../web/', import.meta.url));
const assets = new Map([
  ['/_bridge/', ['index.html', 'text/html; charset=utf-8']],
  ['/_bridge/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/_bridge/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/_bridge/ui.js', ['ui.js', 'text/javascript; charset=utf-8']],
  ['/_bridge/settings.js', ['settings.js', 'text/javascript; charset=utf-8']],
  ['/_bridge/application.js', ['application.js', 'text/javascript; charset=utf-8']],
  ['/_bridge/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/provider-settings.html', ['index.html', 'text/html; charset=utf-8']],
]);

export async function admin(request, response, context) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const asset = assets.get(path);
  if (asset && request.method === 'GET') {
    response.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
    response.end(await readFile(join(webRoot, asset[0]))); return true;
  }
  if (!path.startsWith('/_bridge/api/')) return false;
  const { config, profiles, manager, discovery, model } = context;
  checkOrigin(request, config.port, request.method !== 'GET');
  if (path === '/_bridge/api/status' && request.method === 'GET') {
    let runtime = null;
    try { if (manager.runtime.child) runtime = await manager.runtime.status(); } catch { /* explicit null means unavailable */ }
    let environments = null;
    try { if (runtime) environments = await manager.runtime.environments(); } catch { /* unavailable is shown, never ready */ }
    json(response, 200, { bridgeVersion: context.version, bridgeRevision: context.build.revision, sourceDirty: context.build.dirty, environments, application: context.application.job, state: await manager.state(), discovery: await readJson(join(config.home, 'discovery.json'), null),
      policy: config.update, runtime: runtime ? { version: runtime.version, activeFrames: runtime.active_frames, sandbox: runtime.sandbox_active, boot: runtime.boot } : null,
      inFlight: model.active, releases: await listReleases(config.home) });
  } else if (path === '/_bridge/api/providers' && request.method === 'GET') json(response, 200, await profiles.list());
  else if (path === '/_bridge/api/installations' && request.method === 'GET') json(response, 200, { installations: await discoverInstallations() });
  else if (path === '/_bridge/api/application/attach' && request.method === 'POST') json(response, 202, await context.application.attach(await body(request, 8192)));
  else if (path === '/_bridge/api/application/start' && request.method === 'POST') json(response, 200, await context.application.launch());
  else if (path === '/_bridge/api/application/stop' && request.method === 'POST') json(response, 200, await context.application.stop());
  else if (path === '/_bridge/api/connect' && request.method === 'POST') json(response, 200, { profile: await context.connection.connect(await body(request, 65536)) });
  else if (path === '/_bridge/api/check' && request.method === 'POST') json(response, 200, await discovery.check());
  else if (path === '/_bridge/api/apply' && request.method === 'POST') {
    const { id } = await body(request, 4096);
    invariant(typeof id === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(id) && !id.startsWith('.'), 'invalid_release', 'Invalid release ID.');
    json(response, 200, await manager.apply(id));
  } else if (path === '/_bridge/api/rollback' && request.method === 'POST') json(response, 200, await manager.rollback());
  else json(response, 404, { error: { code: 'not_found', message: 'Unknown bridge operation.' } });
  return true;
}
