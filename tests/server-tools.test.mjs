import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerTools, prepareServerTools } from '../src/gateway/server-tools.mjs';
import { taskConversation } from '../src/gateway/task-conversation.mjs';
import { Writable } from 'node:stream';

const html = '<div class="result"><a class="result__a" href="https://example.org/paper">Paper</a><div class="result__snippet">An excerpt.</div></div>';
test('server search exposes a bounded tool and returns actual source URLs', async () => {
  const prepared = prepareServerTools({ tools: [{ name: 'web_search', type: 'web_search_20250305', max_uses: 99 }] });
  assert.equal(prepared.serverTools.get('web_search').maxUses, 5);
  const server = new ServerTools(async () => new Response(html));
  const results = await server.webSearch('science');
  assert.equal(results[0].url, 'https://example.org/paper');
  assert.equal(results[0].snippet, 'An excerpt.');
});
test('search challenges and HTTP failures remain explicit tool errors', async () => {
  for (const response of [new Response('CAPTCHA'), new Response('unavailable', { status: 503 })]) {
    const server = new ServerTools(async () => response);
    const result = await server.execute({ id: 'search-1', input: { query: 'science' } }, {});
    assert.equal(result.content.type, 'web_search_tool_result_error');
  }
});
test('server search continuation uses one tool per round and returns a model answer', async () => {
  let rounds = 0, transmitted;
  const chunks = [];
  const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
  response.writeHead = () => {};
  await taskConversation({ input: { model: 'alias', max_tokens: 50, messages: [{ role: 'user', content: 'search' }], tools: [{ name: 'web_search', type: 'web_search_20250305' }] },
    profile: { model: 'test-model' }, request: { headers: {} }, response, url: 'https://provider.test/v1/chat/completions', headers: {}, signal: new AbortController().signal,
    fetch: async (url, options) => {
      if (url.startsWith('https://html.duckduckgo.com')) return new Response(html);
      transmitted = JSON.parse(options.body);
      assert.equal(transmitted.parallel_tool_calls, false);
      rounds++;
      return Response.json({ choices: [{ finish_reason: rounds === 1 ? 'tool_calls' : 'stop', message: rounds === 1
        ? { tool_calls: [{ id: 'search-1', function: { name: 'web_search', arguments: '{"query":"science"}' } }] }
        : { content: 'Found a paper.' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
    } });
  const message = JSON.parse(Buffer.concat(chunks));
  assert.equal(rounds, 2);
  assert.ok(transmitted.messages.some(item => item.role === 'tool' && item.content.includes('https://example.org/paper')));
  assert.equal(message.stop_reason, 'end_turn');
  assert.equal(message.content.at(-1).text, 'Found a paper.');
});
