import { createServer } from 'node:http';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initialize } from '../src/core/config.mjs';
import { readJson, atomicJson } from '../src/core/files.mjs';
import { Profiles } from '../src/gateway/profiles.mjs';
import { body, json } from '../src/gateway/http.mjs';
import { serve } from '../src/server.mjs';

// UI acceptance only: real managed application, isolated empty data, and an
// explicitly named local model fixture. No external model request or user key.
const [home, releaseHome, releaseId] = process.argv.slice(2);
if (!home || !releaseHome || !releaseId) throw Error('Usage: preview-workbench.mjs NEW_HOME RELEASE_DIRECTORY RELEASE_ID');
if (await readJson(join(home, 'state.json'), null)) throw Error('Preview requires an unused state home.');
const config = await initialize(home, { port: 19960, appPort: 19961, modelPort: 19962, sandboxPort: 19963,
  network: { proxy: process.env.HTTPS_PROXY || null } });
config.update.autoApply = false;
await mkdir(join(home, 'd/preview'), { recursive: true });
await symlink(releaseHome, join(home, 'releases'));
await atomicJson(join(home, 'state.json'), { schema: 1, active: { releaseId, dataPath: join(home, 'd/preview') },
  previous: null, candidate: null, update: { phase: 'ready' }, runtimeDesired: 'running' });
const profiles = new Profiles(home);
await profiles.save({ provider: 'openai-compatible', model: 'fixture-model', name: 'Preview · local test service',
  baseUrl: 'http://127.0.0.1:19964/v1', apiKey: 'fixture-key-only', activate: true });
const fixture = createServer(async (request, response) => {
  try {
    const input = await body(request, 65536);
    if (input.model === 'unauthorized') return json(response, 401, { error: 'Controlled authentication failure' });
    await delay(input.model === 'slow-model' ? 5000 : 300);
    if (!response.destroyed) json(response, 200, { id: 'preview-reply', model: input.model,
      choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 1 } });
  } catch { if (!response.destroyed) json(response, 400, { error: 'Invalid fixture request' }); }
});
await new Promise(resolve => fixture.listen(19964, '127.0.0.1', resolve));
const service = await serve(config);
console.log('UI PREVIEW ONLY: http://127.0.0.1:19960/_bridge/');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await service.close(); fixture.closeAllConnections(); fixture.close(); process.exit(0);
});
