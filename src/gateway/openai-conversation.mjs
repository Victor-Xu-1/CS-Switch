import { randomUUID } from 'node:crypto';
import { invariant, BridgeError } from '../core/errors.mjs';
import { toOpenAI, fromOpenAI } from '../protocol/messages.mjs';
import { translateStream, finishStream } from '../protocol/openai-stream.mjs';
import { sendEvent } from '../protocol/sse.mjs';
import { prepareServerTools, ServerTools } from './server-tools.mjs';

const totalUsage = (total, current) => { for (const [key, value] of Object.entries(current || {})) total[key] = (total[key] || 0) + value; };
export async function openAIConversation({ input, profile, request, response, fetch, url, headers, signal }) {
  const prepared = prepareServerTools(input), server = new ServerTools(fetch);
  const messages = [...input.messages], visible = [], usage = {};
  let index = 0, continuation = false, searchCount = 0;
  for (let round = 0; round < 6; round++) {
    const converted = toOpenAI({ ...prepared.input, messages }, profile);
    if (prepared.serverTools.size) converted.parallel_tool_calls = false;
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(converted), signal, redirect: 'error' });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      if (!response.headersSent && upstream.headers.has('retry-after')) response.setHeader('retry-after', upstream.headers.get('retry-after'));
      throw new BridgeError('provider_http_error', `Provider returned HTTP ${upstream.status}. Verify its endpoint, model, credentials and quota.`, upstream.status);
    }
    let result;
    if (input.stream) {
      invariant(upstream.headers.get('content-type')?.includes('text/event-stream'), 'upstream_protocol', 'Provider did not return an SSE stream.', 502);
      if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      result = await translateStream(upstream.body, response, profile.model, { continuation, startIndex: index, serverTools: prepared.serverTools, deferFinish: true });
      index = result.nextIndex; continuation = true;
    } else {
      const mapped = fromOpenAI(await upstream.json(), profile.model);
      result = { content: mapped.content.map(c => c.type === 'tool_use' && prepared.serverTools.has(c.name) ? { ...c, type: 'server_tool_use' } : c), usage: mapped.usage, finish: mapped.stop_reason === 'tool_use' ? 'tool_calls' : mapped.stop_reason === 'max_tokens' ? 'length' : 'stop' };
    }
    totalUsage(usage, result.usage); visible.push(...result.content);
    const local = result.content.filter(c => c.type === 'server_tool_use');
    if (!local.length) {
      if (input.stream) await finishStream(response, result.finish, usage);
      else { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify({ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: profile.model, content: visible, stop_reason: result.finish === 'tool_calls' ? 'tool_use' : result.finish === 'length' ? 'max_tokens' : 'end_turn', stop_sequence: null, usage })); }
      return;
    }
    invariant(!result.content.some(c => c.type === 'tool_use'), 'mixed_server_tools', 'Provider mixed a native search with a local execution tool in one response. Disable parallel tool use for this provider.', 502);
    messages.push({ role: 'assistant', content: result.content });
    const results = [];
    for (const call of local) {
      searchCount++;
      invariant(searchCount <= prepared.serverTools.get(call.name).maxUses, 'search_limit', 'Maximum web searches for this model turn reached.', 429);
      const resultBlock = await server.execute(call, prepared.serverTools.get(call.name)); results.push(resultBlock); visible.push(resultBlock);
      if (input.stream) {
        await sendEvent(response, 'content_block_start', { index, content_block: resultBlock });
        await sendEvent(response, 'content_block_stop', { index }); index++;
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw new BridgeError('search_limit', 'Maximum server-tool rounds reached.', 429);
}
