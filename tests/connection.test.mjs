import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Profiles } from '../src/gateway/profiles.mjs';
import { ModelProxy } from '../src/gateway/model-proxy.mjs';
import { Connection } from '../src/gateway/connection.mjs';
import { Application } from '../src/runtime/application.mjs';

async function setup(t, handler) {
  const home = await mkdtemp(join(tmpdir(), 'cs-switch-connection-'));
  t.after(() => rm(home, { recursive: true }));
  const profiles = new Profiles(home);
  const original = await profiles.save({ provider: 'deepseek', name: 'Original', model: 'model-old', baseUrl: 'https://example.test/v1', apiKey: 'old-test-key' });
  const model = new ModelProxy(profiles, { fetch: handler });
  const manager = { busy: false, maintenance: false, runtime: { idle: async () => true } };
  const connection = new Connection(profiles, model, manager);
  return { profiles, original, connection, manager };
}
const reply = () => Response.json({ id: 'test', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
const draft = { provider: 'deepseek', model: 'new-model', baseUrl: 'https://example.test/v1', apiKey: 'new-test-key' };

test('one action tests an unsaved draft then activates it with a durable receipt', async t => {
  let transmitted;
  const { profiles, connection } = await setup(t, async (url, options) => { transmitted = JSON.parse(options.body); return reply(); });
  const result = await connection.connect(draft);
  assert.equal(transmitted.model, 'new-model');
  assert.deepEqual(transmitted.thinking, { type: 'disabled' });
  assert.equal((await profiles.active()).model, 'new-model');
  assert.ok(result.connectionTest.at);
  assert.ok(!JSON.stringify(await profiles.list()).includes('new-test-key'));
});
test('failed connection leaves the active profile and its credentials unchanged', async t => {
  const { profiles, original, connection } = await setup(t, async () => new Response('private upstream text', { status: 401 }));
  await assert.rejects(connection.connect({ ...draft, id: original.id }), /HTTP 401/);
  assert.equal((await profiles.active()).model, 'model-old');
  assert.equal((await profiles.active()).apiKey, 'old-test-key');
  assert.equal((await profiles.list()).profiles.length, 1);
  assert.equal(connection.busy, false);
});
test('empty or truncated replies never produce a verified profile', async t => {
  let text = '';
  const { profiles, connection } = await setup(t, async () => Response.json({ choices: [{ message: { content: text }, finish_reason: 'length' }] }));
  await assert.rejects(connection.connect(draft), /empty completion/);
  text = 'unfinished';
  await assert.rejects(connection.connect(draft), /complete text/);
  assert.equal((await profiles.active()).model, 'model-old');
});
test('blank key preserves the encrypted key when testing an existing profile', async t => {
  const { profiles, original, connection } = await setup(t, async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer old-test-key'); return reply();
  });
  await connection.connect({ ...draft, id: original.id, apiKey: '' });
  assert.equal((await profiles.active()).apiKey, 'old-test-key');
});
test('an active task blocks a model change before any paid request', async t => {
  let calls = 0;
  const { connection, manager } = await setup(t, async () => { calls++; return reply(); });
  manager.runtime.idle = async () => false;
  await assert.rejects(connection.connect(draft), { code: 'runtime_busy' });
  assert.equal(calls, 0);
});
test('a task starting during the test leaves the original model selected', async t => {
  const { profiles, connection, manager } = await setup(t, async () => { manager.runtime.idle = async () => false; return reply(); });
  await assert.rejects(connection.connect(draft), { code: 'runtime_busy' });
  assert.equal((await profiles.active()).model, 'model-old');
  assert.equal(manager.maintenance, false);
});
test('a changed endpoint cannot receive a saved key without explicit re-entry', async t => {
  let sent = 0;
  const { profiles, original, connection } = await setup(t, async () => { sent++; return reply(); });
  await assert.rejects(connection.connect({ ...draft, id: original.id, apiKey: '', baseUrl: 'https://different.test/v1' }),
    { code: 'credential_endpoint_changed' });
  assert.equal(sent, 0);
  assert.equal((await profiles.active()).baseUrl, 'https://example.test/v1');
});
test('a cancelled connection never activates a draft or sends a request', async t => {
  let sent = 0;
  const { profiles, connection } = await setup(t, async () => { sent++; return reply(); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(connection.connect(draft, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(sent, 0); assert.equal((await profiles.active()).model, 'model-old');
});
test('connection commit reserves the shared operation lock before waiting for idle', async t => {
  const { connection, manager } = await setup(t, async () => reply());
  let calls = 0, blocked = false;
  manager.runtime.idle = async () => {
    if (++calls === 2) {
      try { new Application({}, manager).lock(); }
      catch (error) { blocked = error.code === 'update_busy'; }
    }
    return true;
  };
  await connection.connect(draft);
  assert.equal(blocked, true); assert.equal(manager.busy, false);
});
test('cancelling an in-flight probe aborts the transport and preserves the profile', async t => {
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const { profiles, connection } = await setup(t, async (_url, { signal }) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const running = connection.connect(draft, { signal: controller.signal });
  await waiting; controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal((await profiles.active()).model, 'model-old');
  assert.equal(connection.busy, false);
});

test('environment credentials cannot follow an address change; explicit replacement is accepted', async t => {
  const { profiles, original } = await setup(t, async () => reply());
  await profiles.save({ ...draft, id: original.id, apiKey: '', apiKeyEnv: 'CS_SWITCH_TEST_KEY' });
  await assert.rejects(profiles.draft({ ...draft, id: original.id, apiKey: '', apiKeyEnv: 'CS_SWITCH_TEST_KEY', baseUrl: 'https://different.test/v1' }), { code: 'credential_endpoint_changed' });
  const replacement = await profiles.resolve(await profiles.draft({ ...draft, id: original.id, apiKeyEnv: 'CS_SWITCH_TEST_KEY', baseUrl: 'https://different.test/v1' }));
  assert.equal(replacement.apiKeyEnv, ''); assert.equal(replacement.apiKey, 'new-test-key');
  for (const invalid of [null, [], 'profile']) await assert.rejects(profiles.draft(invalid), { code: 'invalid_profile' });
});

test('native Anthropic body cancellation terminates the probe and preserves the active model', async t => {
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  const { profiles, connection } = await setup(t, async () => new Response(new ReadableStream({
    pull() { started(); },
  }), { headers: { 'content-type': 'application/json' } }));
  const controller = new AbortController();
  const running = connection.connect({ ...draft, provider: 'anthropic-compatible', protocol: 'anthropic' }, { signal: controller.signal });
  await reading; controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal((await profiles.active()).model, 'model-old');
  assert.equal(connection.busy, false);
});
