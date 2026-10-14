import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { buildIdentity } from './core/build.mjs';
import { Profiles } from './gateway/profiles.mjs';
import { ModelProxy } from './gateway/model-proxy.mjs';
import { Connection } from './gateway/connection.mjs';
import { RuntimeProcess } from './runtime/process.mjs';
import { Application } from './runtime/application.mjs';
import { ReadinessCache } from './runtime/readiness.mjs';
import { UpdateManager } from './update/manager.mjs';
import { Discovery } from './update/discovery.mjs';
import { ReverseProxy } from './gateway/reverse-proxy.mjs';
import { admin } from './gateway/admin.mjs';
import { checkHost, checkOrigin, json, body } from './gateway/http.mjs';
import { publicError, invariant } from './core/errors.mjs';
import { network } from './core/network.mjs';

export async function serve(config) {
  invariant(process.platform === 'linux', 'platform', 'Run the service inside Linux/WSL.');
  const token = randomBytes(32).toString('hex');
  const net = network(config);
  const profiles = new Profiles(config.home), model = new ModelProxy(profiles, { fetch: net.fetch, proxy: config.network?.proxy, home: config.home });
  const runtime = new RuntimeProcess(config, token);
  let reverse;
  const manager = new UpdateManager(config, runtime, { isGatewayIdle: () => model.active === 0 && (!reverse || reverse.requests === 0), quiesce: () => reverse?.disconnect() });
  const discovery = new Discovery(config, manager, { fetch: net.fetch });
  reverse = new ReverseProxy(config, manager);
  const build = await buildIdentity(), { version } = build;
  const connection = new Connection(profiles, model, manager);
  const application = new Application(config, manager);
  const readiness = new ReadinessCache(() => runtime.environments());
  const context = { config, profiles, model, runtime, manager, discovery, connection, application, readiness, version, build };
  const fail = (response, error) => {
    if (!response.headersSent && !response.destroyed) json(response, error.status || 500, { error: publicError(error) });
    else response.destroy();
    console.error(JSON.stringify({ code: publicError(error).code, type: error.name }));
  };
  const modelServer = createServer(async (request, response) => {
    try {
      checkHost(request, config.modelPort);
      if (request.url === '/health' && request.method === 'GET') return json(response, 200, { ok: true, bridgeVersion: version });
      const presented = request.headers['x-api-key'] || request.headers.authorization?.replace(/^Bearer /, '') || '';
      invariant(presented.length === token.length && timingSafeEqual(Buffer.from(presented), Buffer.from(token)), 'unauthorized', 'Invalid internal model credential.', 401);
      if (request.url?.split('?')[0] === '/v1/models' && request.method === 'GET') {
        const profile = await profiles.active();
        json(response, 200, { data: [{ id: profile.model, type: 'model', display_name: `${profile.name} · ${profile.model}`, created_at: profile.createdAt }], has_more: false, first_id: profile.model, last_id: profile.model });
      } else if (request.url === '/v1/messages' && request.method === 'POST') await model.dispatch(await body(request), request, response);
      else json(response, 404, { error: { code: 'not_found', message: 'Unknown model route.' } });
    } catch (error) { fail(response, error); }
  });
  const server = createServer(async (request, response) => {
    try {
      checkHost(request, config.port); checkOrigin(request, config.port);
      if (await admin(request, response, context)) return;
      reverse.forward(request, response);
    } catch (error) { fail(response, error); }
  });
  server.on('upgrade', (request, socket, head) => {
    try { checkHost(request, config.port); checkOrigin(request, config.port, false); reverse.upgrade(request, socket, head); }
    catch { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  for (const service of [server, modelServer]) { service.requestTimeout = 125000; service.headersTimeout = 10000; service.maxHeadersCount = 64; }
  const listen = (service, port) => new Promise((resolve, reject) => { service.once('error', reject); service.listen(port, '127.0.0.1', resolve); });
  try {
    await listen(modelServer, config.modelPort);
    await listen(server, config.port);
    const state = await manager.state();
    if (state.active && state.runtimeDesired !== 'stopped') {
      try { await application.launch(); }
      catch (error) { console.error(JSON.stringify({ code: publicError(error).code, phase: 'application_start' })); }
    }
    discovery.start();
    // First discovery is asynchronous and cannot block a usable current runtime.
    void discovery.check().catch(error => console.error(JSON.stringify({ code: 'update_check_failed', type: error.name })));
  } catch (error) { await runtime.stop(); server.close(); modelServer.close(); await net.close(); throw error; }
  console.log(JSON.stringify({ ready: true, bridgeVersion: version, url: `http://127.0.0.1:${config.port}/`, settings: `http://127.0.0.1:${config.port}/_bridge/` }));
  let closing = false;
  return { ...context, async close() {
    if (closing) return; closing = true;
    discovery.stop(); manager.maintenance = true; reverse.disconnect();
    server.closeAllConnections(); modelServer.closeAllConnections(); server.close(); modelServer.close();
    await runtime.stop(); await net.close();
  } };
}
