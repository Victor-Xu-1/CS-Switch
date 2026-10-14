import { invariant, BridgeError } from '../core/errors.mjs';
import { toOpenAI, fromOpenAI, stopReason } from '../protocol/messages.mjs';
import { translateStream } from '../protocol/openai-stream.mjs';
import { prepareDocuments } from '../protocol/documents.mjs';
import { taskHistory } from '../protocol/task-history.mjs';
import { structuredOutput } from '../protocol/structured-output.mjs';
import { MessageOutput } from '../protocol/message-output.mjs';
import { prepareServerTools, ServerTools } from './server-tools.mjs';
import { WebEvidence } from './web-evidence.mjs';

const totalUsage = (total, current) => { for (const [key, value] of Object.entries(current || {})) if (Number.isFinite(value)) total[key] = (total[key] || 0) + value; };
async function boundedJson(response, signal) {
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    signal.throwIfAborted(); size += chunk.length;
    invariant(size <= 4 * 1024 * 1024, 'upstream_protocol', 'Provider response exceeds its limit.', 502); chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new BridgeError('upstream_protocol', 'Provider returned invalid JSON.', 502); }
}

export async function taskConversation({ input, profile, request, response, fetch, web, evidence = new WebEvidence(), url, headers, signal }) {
  input = await evidence.restore(input);
  const native = profile.protocol === 'anthropic';
  const prepared = prepareServerTools(await prepareDocuments(input, { web, signal }));
  const format = structuredOutput(input, profile);
  const server = new ServerTools(fetch, { web, signal, messages: input.messages });
  const messages = taskHistory(prepared.input.messages), output = new MessageOutput(response, profile.model, input.stream), usage = {};
  for (let round = 0; round < 12; round++) {
    signal.throwIfAborted();
    // Structured output is held until complete validation. Native web emulation
    // buffers each provider turn, while ordinary native SSE still passes through.
    const live = !native && input.stream && !format;
    const converted = native ? { ...prepared.input, model: profile.model, messages: taskHistory(messages, true), stream: false }
      : toOpenAI({ ...prepared.input, messages, stream: Boolean(live) }, profile, format);
    if (native && format) {
      delete converted.output_format;
      if (converted.output_config) { converted.output_config = { ...converted.output_config }; delete converted.output_config.format; }
      converted.system = [...(typeof converted.system === 'string' ? [{ type: 'text', text: converted.system }] : converted.system || []), { type: 'text', text: format.instruction }];
    }
    if (prepared.serverTools.size && !native) converted.parallel_tool_calls = false;
    if (round > 0 && prepared.serverTools.has(input.tool_choice?.name)) converted.tool_choice = native ? { type: 'auto' } : 'auto';
    const upstream = await fetch(url, { method: 'POST', headers: { ...headers, accept: live ? 'text/event-stream' : 'application/json' }, body: JSON.stringify(converted), signal, redirect: 'error' });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      if (!response.headersSent && upstream.headers.has('retry-after')) response.setHeader('retry-after', upstream.headers.get('retry-after'));
      throw new BridgeError('provider_http_error', `Provider returned HTTP ${upstream.status}. Verify its endpoint, model and supported task parameters.`, upstream.status);
    }
    let result;
    if (live) {
      invariant(upstream.headers.get('content-type')?.includes('text/event-stream'), 'upstream_protocol', 'Provider did not return SSE.', 502);
      if (!output.started) response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const streamed = await translateStream(upstream.body, response, profile.model, { continuation: output.started, startIndex: output.index, serverTools: prepared.serverTools, deferFinish: true });
      result = { content: streamed.content, usage: streamed.usage, stop_reason: stopReason(streamed.finish) };
      output.index = streamed.nextIndex; output.started = true;
    } else {
      const json = await boundedJson(upstream, signal);
      result = native ? json : fromOpenAI(json, profile.model);
      invariant(Array.isArray(result.content) && result.content.length && ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'refusal'].includes(result.stop_reason), 'upstream_protocol', 'Provider returned an incomplete message.', 502);
      result.content = result.content.map(block => block.type === 'tool_use' && prepared.serverTools.has(block.name) ? { ...block, type: 'server_tool_use' } : block);
    }
    format?.validate(result); totalUsage(usage, result.usage);
    if (live) output.content.push(...result.content); else await output.append(result.content);
    const local = result.content.filter(block => block.type === 'server_tool_use');
    const client = result.content.some(block => block.type === 'tool_use');
    if (!local.length) { await output.finish(result.stop_reason, usage); return; }
    invariant(local.every(call => prepared.serverTools.has(call.name)), 'invalid_tool', 'Unknown server tool requested.', 502);
    const results = [];
    for (const call of local) results.push(await server.execute(call, prepared.serverTools.get(call.name)));
    await output.append(results);
    for (const result of results) { const link = await evidence.remember(result); if (link) await output.append([link]); }
    // Return client calls with completed web receipts. The original application
    // executes its own tools/approvals, and sends all results in the next turn.
    if (client) { await output.finish('tool_use', usage); return; }
    messages.push({ role: 'assistant', content: result.content }, { role: 'user', content: results });
  }
  throw new BridgeError('search_limit', 'Maximum web-tool rounds reached. No final result was fabricated.', 429);
}
