import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Profiles } from '../src/gateway/profiles.mjs';
import { ModelProxy } from '../src/gateway/model-proxy.mjs';
import { body, json, checkHost, checkOrigin } from '../src/gateway/http.mjs';
import { publicError } from '../src/core/errors.mjs';

async function listen(handler, t) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function gateway(t, protocol, handler, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'cs-switch-gateway-')); t.after(() => rm(home, { recursive: true }));
  const upstream = await listen(handler, t), profiles = new Profiles(home);
  await profiles.save({ provider: `${protocol}-compatible`, protocol, name: 'Controlled test service', model: 'test-model', baseUrl: upstream + (protocol === 'openai' ? '/v1' : ''), apiKey: 'test-only-credential', activate: true });
  const proxy = new ModelProxy(profiles, options);
  const url = await listen(async (request, response) => {
    try { await proxy.dispatch(await body(request), request, response); }
    catch (error) { if (!response.headersSent) json(response, error.status || 500, { error: publicError(error) }); }
  }, t);
  return { url, profiles, home, proxy };
}
const input = (stream = false) => ({ model: 'upstream-alias', max_tokens: 20, messages: [{ role: 'user', content: 'test' }], stream });
const post = (url, value) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

test('encrypted provider store persists activation without returning a credential', async t => {
  const { profiles, home } = await gateway(t, 'openai', (_req, res) => res.end());
  const serialized = await readFile(join(home, 'providers.json'), 'utf8');
  assert.ok(!serialized.includes('test-only-credential'));
  assert.ok(!JSON.stringify(await profiles.list()).includes('test-only-credential'));
  assert.equal((await new Profiles(home).active()).apiKey, 'test-only-credential');
  await writeFile(join(home, 'providers.key'), Buffer.alloc(32, 3));
  await assert.rejects(profiles.active(), /Cannot decrypt/);
});
test('OpenAI gateway calls the real HTTP protocol and returns validated tool arguments', async t => {
  let received;
  const { url } = await gateway(t, 'openai', async (req, res) => {
    received = { path: req.url, headers: req.headers, body: await body(req) };
    json(res, 200, { id: 'x', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'call-1', function: { name: 'python', arguments: '{"code":"print(2)"}' } }] } }], usage: { prompt_tokens: 4, completion_tokens: 7 } });
  });
  const response = await post(url, input()); const result = await response.json();
  assert.equal(received.path, '/v1/chat/completions'); assert.equal(received.body.model, 'test-model');
  assert.equal(received.headers.authorization, 'Bearer test-only-credential');
  assert.equal(result.content[0].name, 'python'); assert.equal(result.usage.output_tokens, 7);
});
test('OpenAI streaming preserves text, tool JSON and usage', async t => {
  const { url } = await gateway(t, 'openai', async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunks = [
      { choices: [{ delta: { content: 'hello' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'r', arguments: '{"x":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '2}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 30, completion_tokens: 8 } },
    ];
    for (const chunk of chunks) { res.write(`data: ${JSON.stringify(chunk)}\n\n`); await delay(5); }
    res.end('data: [DONE]\n\n');
  });
  const result = await (await post(url, input(true))).text();
  assert.match(result, /text_delta/); assert.match(result, /input_json_delta/);
  assert.match(result, /"output_tokens":8/); assert.match(result, /message_stop/);
});
test('Anthropic SSE arrives before the upstream response is finished', async t => {
  let released; const gate = new Promise(resolve => { released = resolve; });
  t.after(() => released());
  let received;
  const { url } = await gateway(t, 'anthropic', async (req, res) => {
    received = { headers: req.headers, body: await body(req), path: req.url };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
    await gate; res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
  const response = await post(url, input(true)); const reader = response.body.getReader();
  const first = await Promise.race([reader.read(), delay(1000).then(() => { throw Error('Buffered native SSE'); })]);
  assert.match(new TextDecoder().decode(first.value), /message_start/);
  assert.equal(received.path, '/v1/messages'); assert.equal(received.headers['x-api-key'], 'test-only-credential');
  assert.equal(received.body.model, 'test-model'); released(); await reader.cancel();
});
test('provider errors preserve status without exposing upstream credential echoes', async t => {
  const { url } = await gateway(t, 'openai', (_req, res) => { res.writeHead(429, { 'retry-after': '2' }); res.end('echo: test-only-credential'); });
  const response = await post(url, input()); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '2');
  assert.ok(!(await response.text()).includes('test-only-credential'));
});
test('a truncated stream emits error and never a successful message_stop', async t => {
  const { url } = await gateway(t, 'openai', (_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); });
  const result = await (await post(url, input(true))).text();
  assert.match(result, /upstream_truncated/); assert.ok(!result.includes('event: message_stop'));
});
test('host and mutation-origin checks reject cross-site requests', () => {
  assert.throws(() => checkHost({ headers: { host: 'evil.test:8000' } }, 8000), /Unrecognized/);
  assert.throws(() => checkOrigin({ headers: { origin: 'https://evil.test', 'x-cs-switch': '1' } }, 8000, true), /Cross-origin/);
  assert.throws(() => checkOrigin({ headers: {} }, 8000, true), /local CS-Switch/);
});
