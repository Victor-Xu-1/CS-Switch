import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { taskConversation } from '../src/gateway/task-conversation.mjs';
import { prepareServerTools, ServerTools } from '../src/gateway/server-tools.mjs';
import { taskHistory } from '../src/protocol/task-history.mjs';
import { toOpenAI } from '../src/protocol/messages.mjs';
import { translateStream } from '../src/protocol/openai-stream.mjs';

const searchHtml = '<div class="result"><a class="result__a" href="https://example.org/paper">Paper</a><div class="result__snippet">Public evidence.</div></div>';
const definition = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1, max_content_tokens: 4000 };
const web = { get: async url => ({ url, mediaType: 'text/html', retrievedAt: '2026-10-14T00:00:00Z', data: Buffer.from('<title>Paper</title><main><p>Observed number: 37.</p><script>doBadThings()</script></main>') }) };
function sink() {
  const chunks = [], response = new Writable({ write(chunk, _enc, done) { chunks.push(chunk); done(); } });
  response.writeHead = () => { response.headersSent = true; }; response.setHeader = () => {};
  return { response, text: () => Buffer.concat(chunks).toString() };
}
const tool = (name, id, input) => ({ type: 'tool_use', name, id, input });
const completion = (protocol, content) => protocol === 'anthropic'
  ? Response.json({ type: 'message', role: 'assistant', content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })
  : Response.json({ choices: [{ message: { content: content.find(b => b.type === 'text')?.text || null, tool_calls: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })) }, finish_reason: content.some(b => b.type === 'tool_use') ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } });

test('fetch exposes the original tool and enforces prior URL, domain and per-tool budgets', async () => {
  const prepared = prepareServerTools({ tools: [definition] });
  assert.deepEqual(prepared.input.tools[0].input_schema.required, ['url']);
  const server = new ServerTools(fetch, { web, messages: [{ role: 'user', content: 'Read https://example.org/paper' }] });
  const call = tool('web_fetch', 'f', { url: 'https://example.org/paper' });
  const result = await server.execute(call, prepared.serverTools.get('web_fetch'));
  assert.equal(result.type, 'web_fetch_tool_result'); assert.match(result.content.content.source.data, /37/); assert.doesNotMatch(result.content.content.source.data, /doBadThings/);
  assert.equal((await server.execute(call, prepared.serverTools.get('web_fetch'))).content.error_code, 'max_uses_exceeded');
  const unknown = new ServerTools(fetch, { web, messages: [{ role: 'assistant', content: 'https://example.org/paper' }] });
  assert.equal((await unknown.execute(call, { kind: 'web_fetch' })).content.error_code, 'url_not_in_prior_context');
  assert.equal((await server.execute(call, { kind: 'web_fetch', maxUses: 0 })).content.error_code, 'max_uses_exceeded');
});

test('search-enabled original agents get a bridge reader without replacing client tools', () => {
  const search = { name: 'web_search', type: 'web_search_20250305' };
  assert.equal(prepareServerTools({ tools: [search] }).serverTools.get('web_fetch').kind, 'web_fetch');
  assert.equal(prepareServerTools({ tools: [] }).serverTools.size, 0);
  assert.equal(prepareServerTools({ tools: [{ ...search, max_uses: 0 }] }).serverTools.has('web_fetch'), false);
  const client = { name: 'web_fetch', input_schema: { type: 'object' } };
  assert.equal(prepareServerTools({ tools: [search, client] }).input.tools.filter(t => t.name === 'web_fetch').length, 1);
  assert.equal(prepareServerTools({ tools: [search, client] }).serverTools.has('web_fetch'), false);
});

for (const protocol of ['openai', 'anthropic']) test(`${protocol} completes search then fetch with real content receipts and source URLs`, async () => {
  const output = sink(); let calls = 0, last;
  await taskConversation({ input: { max_tokens: 300, messages: [{ role: 'user', content: 'Find and read the paper.' }], tools: [{ type: 'web_search_20250305', name: 'web_search' }, definition] }, profile: { model: 'fixture', protocol }, response: output.response, request: { headers: {} }, web,
    url: 'https://provider.test', headers: {}, signal: new AbortController().signal,
    fetch: async (url, options) => {
      if (url.startsWith('https://html.duckduckgo.com')) return new Response(searchHtml);
      last = JSON.parse(options.body); calls++;
      return completion(protocol, calls === 1 ? [tool('web_search', 's', { query: 'paper' })] : calls === 2 ? [tool('web_fetch', 'f', { url: 'https://example.org/paper' })] : [{ type: 'text', text: 'Observed number 37, source https://example.org/paper' }]);
    } });
  const result = JSON.parse(output.text());
  assert.equal(calls, 3); assert.match(JSON.stringify(last.messages), /Observed number: 37/);
  assert.equal(result.content.filter(b => b.type === 'web_fetch_tool_result').length, 1);
  assert.equal(result.stop_reason, 'end_turn');
});

test('mixed web and execution tools return completed web receipts without executing client code', async () => {
  const output = sink(); let modelCalls = 0;
  await taskConversation({ input: { max_tokens: 100, messages: [{ role: 'user', content: 'Read https://example.org/paper and calculate.' }], tools: [definition, { name: 'python', input_schema: { type: 'object' } }] }, profile: { model: 'fixture' }, response: output.response, request: { headers: {} }, web,
    url: 'https://provider.test', headers: {}, signal: new AbortController().signal,
    fetch: async () => { modelCalls++; return completion('openai', [tool('web_fetch', 'f', { url: 'https://example.org/paper' }), tool('python', 'p', { code: 'print(37)' })]); } });
  const result = JSON.parse(output.text()); assert.equal(result.stop_reason, 'tool_use'); assert.equal(modelCalls, 1);
  assert.ok(result.content.some(b => b.type === 'web_fetch_tool_result'));
  const history = taskHistory([{ role: 'assistant', content: result.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'p', content: '37' }] }]);
  const wire = toOpenAI({ max_tokens: 100, messages: history }, { model: 'fixture' });
  assert.deepEqual(wire.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['f', 'p']);
});

test('invalid structured streaming output never emits a successful message', async () => {
  const output = sink();
  await assert.rejects(taskConversation({ input: { max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'JSON please' }], output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } } } }, profile: { model: 'fixture', provider: 'deepseek' }, response: output.response, request: { headers: {} },
    url: 'https://provider.test', headers: {}, signal: new AbortController().signal, fetch: async () => completion('openai', [{ type: 'text', text: '{"value":"wrong"}' }]) }), { code: 'structured_output_invalid' });
  assert.equal(output.text(), '');
});

test('split streamed tool names are classified only after the complete identity arrives', async () => {
  const output = sink();
  const chunks = [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'f', function: { name: 'web_', arguments: '{"url":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'fetch', arguments: '"https://example.org"}' } }] }, finish_reason: 'tool_calls' }] }];
  const response = new Response(chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n');
  const result = await translateStream(response.body, output.response, 'fixture', { serverTools: new Map([['web_fetch', {}]]), deferFinish: true });
  assert.equal(result.content[0].type, 'server_tool_use'); assert.equal(result.content[0].name, 'web_fetch');
  assert.doesNotMatch(output.text(), /"name":"web_"/);
});

test('a cancelled web operation never starts another inference round', async () => {
  const controller = new AbortController(), output = sink(); let calls = 0;
  await assert.rejects(taskConversation({ input: { max_tokens: 100, messages: [{ role: 'user', content: 'Read https://example.org/paper' }], tools: [definition] },
    profile: { model: 'fixture' }, response: output.response, request: { headers: {} }, url: 'https://provider.test', headers: {}, signal: controller.signal,
    web: { get: async () => { controller.abort(); throw controller.signal.reason; } },
    fetch: async () => { calls++; return completion('openai', [tool('web_fetch', 'f', { url: 'https://example.org/paper' })]); } }), { name: 'AbortError' });
  assert.equal(calls, 1); assert.equal(output.text(), '');
});

test('native structured task requests receive document text and retain the validated contract', async () => {
  const output = sink(); let body;
  await taskConversation({ input: { max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Value 37' } }] }],
    output_format: { type: 'json_schema', schema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] } } }, profile: { model: 'fixture', protocol: 'anthropic' },
  response: output.response, request: { headers: {} }, url: 'https://provider.test', headers: {}, signal: new AbortController().signal,
  fetch: async (_url, options) => { body = JSON.parse(options.body); return completion('anthropic', [{ type: 'text', text: '{"value":37}' }]); } });
  assert.match(JSON.stringify(body.messages), /Value 37/); assert.equal(body.output_format, undefined);
  assert.match(JSON.stringify(body.system), /JSON Schema/);
  assert.equal(JSON.parse(JSON.parse(output.text()).content[0].text).value, 37);
});
