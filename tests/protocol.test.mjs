import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenAI, fromOpenAI, toolInput, usage } from '../src/protocol/messages.mjs';
import { events } from '../src/protocol/sse.mjs';

const profile = { model: 'test-model' };
test('plot images inside tool results preserve pixels and tool-call association', () => {
  const result = toOpenAI({ max_tokens: 100, messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plot-1', name: 'python', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plot-1', content: [
      { type: 'text', text: 'Plot generated' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } },
    ] }] },
  ] }, profile);
  assert.equal(result.messages[1].tool_call_id, 'plot-1');
  assert.match(result.messages[1].content, /Plot generated/);
  assert.equal(result.messages[2].role, 'user');
  assert.match(result.messages[2].content[0].text, /plot-1/);
  assert.equal(result.messages[2].content[1].image_url.url, 'data:image/png;base64,YQ==');
});
test('tool schemas, forced selection, tool results, images and roles survive mapping', () => {
  const schema = { type: 'object', required: ['code'], properties: { code: { type: 'string' } }, additionalProperties: false };
  const output = toOpenAI({ max_tokens: 100, system: [{ type: 'text', text: 'system rules' }], messages: [
    { role: 'user', content: [{ type: 'text', text: 'Run it' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'python', input: { code: '1+1' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'failure', is_error: true }] },
  ], tools: [{ name: 'python', input_schema: schema }], tool_choice: { type: 'tool', name: 'python', disable_parallel_tool_use: true } }, profile);
  assert.deepEqual(output.tools[0].function.parameters, schema);
  assert.equal(output.messages[0].role, 'system');
  assert.equal(output.messages[1].content[1].image_url.url, 'data:image/png;base64,YQ==');
  assert.equal(output.messages[2].tool_calls[0].function.arguments, '{"code":"1+1"}');
  assert.equal(JSON.parse(output.messages[3].content).is_error, true);
  assert.equal(output.tool_choice.function.name, 'python');
  assert.equal(output.parallel_tool_calls, false);
});
test('required/none tool choice and stop sequences are preserved', () => {
  for (const [source, expected] of [['any', 'required'], ['none', 'none']]) {
    const result = toOpenAI({ max_tokens: 10, messages: [{ role: 'user', content: 'x' }], stop_sequences: ['END'], tool_choice: { type: source } }, profile);
    assert.equal(result.tool_choice, expected); assert.deepEqual(result.stop, ['END']);
  }
});
test('invalid tool arguments fail explicitly and are never replaced by an empty object', () => {
  assert.throws(() => toolInput('{bad'), /invalid JSON/);
  assert.throws(() => toolInput('[]'), /JSON object/);
  assert.deepEqual(toolInput('{"x":2}'), { x: 2 });
});
test('usage and tool calls survive non-streaming response translation', () => {
  const result = fromOpenAI({ id: 'response-1', model: 'model-x', usage: { prompt_tokens: 40, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 10 } },
    choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'tool-1', function: { name: 'run_r', arguments: '{"code":"1+1"}' } }] } }] }, 'requested');
  assert.equal(result.stop_reason, 'tool_use');
  assert.deepEqual(result.content[0].input, { code: '1+1' });
  assert.equal(result.usage.output_tokens, 9); assert.equal(result.usage.cache_read_input_tokens, 10);
  assert.equal(result.usage.input_tokens, 30);
});
test('cache hits are not double-counted and absent usage stays unknown', () => {
  assert.deepEqual(usage({ prompt_tokens: 40, prompt_cache_hit_tokens: 30, completion_tokens: 5 }),
    { input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 5 });
  assert.deepEqual(usage(), {});
});
test('unsupported content and truncated response are not reported as success', () => {
  assert.throws(() => toOpenAI({ max_tokens: 10, messages: [{ role: 'user', content: [{ type: 'unknown-payload' }] }] }, profile), /does not support/);
  assert.throws(() => fromOpenAI({ choices: [{ message: { content: 'partial' } }] }, 'm'), /finish reason/);
});
test('SSE handles chunk-split UTF-8, CRLF, comments, multiple data lines and final event', async () => {
  const source = Buffer.from(': ping\r\nevent: sample\r\ndata: 你\r\ndata: 好\r\n\r\ndata: final');
  async function* bytes() { for (const value of source) yield Buffer.from([value]); }
  const parsed = []; for await (const item of events(bytes())) parsed.push(item);
  assert.deepEqual(parsed, [{ event: 'sample', data: '你\n好' }, { event: '', data: 'final' }]);
});
