import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Profiles } from '../src/gateway/profiles.mjs';
import { ModelProxy } from '../src/gateway/model-proxy.mjs';
import { Connection } from '../src/gateway/connection.mjs';

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
  await assert.rejects(connection.connect(draft), /current task/);
  assert.equal(calls, 0);
});
test('a task starting during the test leaves the original model selected', async t => {
  const { profiles, connection, manager } = await setup(t, async () => { manager.runtime.idle = async () => false; return reply(); });
  await assert.rejects(connection.connect(draft), /current task/);
  assert.equal((await profiles.active()).model, 'model-old');
  assert.equal(manager.maintenance, false);
});
