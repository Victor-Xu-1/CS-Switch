import { randomUUID } from 'node:crypto';
import { invariant } from '../core/errors.mjs';
import { events, sendEvent } from './sse.mjs';
import { usage, stopReason, toolInput } from './messages.mjs';

export async function translateStream(body, response, model, options = {}) {
  let nextIndex = options.startIndex || 0, finish = null, finalUsage = {}, seenContent = false;
  const content = [];
  let current = null;
  const tools = new Map();
  if (!options.continuation) await sendEvent(response, 'message_start', { message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: {} } });
  const closeCurrent = async () => {
    if (current) await sendEvent(response, 'content_block_stop', { index: current.index });
    current = null;
  };
  const append = async (type, value) => {
    if (!value) return;
    seenContent = true;
    if (current?.type !== type) {
      await closeCurrent();
      current = { type, index: nextIndex++ };
      current.value = type === 'thinking' ? { type, thinking: '' } : { type, text: '' };
      content.push(current.value);
      await sendEvent(response, 'content_block_start', { index: current.index, content_block: type === 'thinking' ? { type, thinking: '' } : { type, text: '' } });
    }
    if (type === 'thinking') current.value.thinking += value; else current.value.text += value;
    await sendEvent(response, 'content_block_delta', { index: current.index, delta: type === 'thinking' ? { type: 'thinking_delta', thinking: value } : { type: 'text_delta', text: value } });
  };
  for await (const event of events(body)) {
    if (event.data === '[DONE]') break;
    let value;
    try { value = JSON.parse(event.data); } catch { invariant(false, 'upstream_protocol', 'Malformed JSON in provider stream.', 502); }
    invariant(!value.error, 'upstream_protocol', 'Provider emitted an error during streaming.', 502);
    if (value.usage) finalUsage = usage(value.usage);
    const choice = value.choices?.[0];
    if (!choice) continue;
    invariant(!value.choices?.[1], 'upstream_protocol', 'Multiple streamed choices are unsupported.', 502);
    const delta = choice.delta || {};
    await append('thinking', delta.reasoning_content || delta.reasoning);
    await append('text', delta.content || delta.refusal);
    for (const call of delta.tool_calls || []) {
      await closeCurrent();
      const index = call.index ?? 0;
      let tool = tools.get(index);
      if (!tool) { tool = { index: nextIndex++, id: '', name: '', arguments: '', emitted: false, pending: '' }; tools.set(index, tool); }
      if (call.id) tool.id += call.id;
      if (call.function?.name) tool.name += call.function.name;
      if (call.function?.arguments) { tool.arguments += call.function.arguments; tool.pending += call.function.arguments; }
      invariant(tool.arguments.length < 4 * 1024 * 1024, 'upstream_protocol', 'Tool arguments exceed limit.', 502);
      if (!tool.emitted && tool.id && tool.name) {
        tool.emitted = true; seenContent = true;
        tool.type = options.serverTools?.has(tool.name) ? 'server_tool_use' : 'tool_use';
        await sendEvent(response, 'content_block_start', { index: tool.index, content_block: { type: tool.type, id: tool.id, name: tool.name, input: {} } });
      }
      if (tool.emitted && tool.pending) {
        await sendEvent(response, 'content_block_delta', { index: tool.index, delta: { type: 'input_json_delta', partial_json: tool.pending } });
        tool.pending = '';
      }
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  invariant(finish && seenContent, 'upstream_truncated', 'Provider stream ended before a complete response.', 502);
  await closeCurrent();
  for (const tool of tools.values()) {
    invariant(tool.emitted, 'upstream_protocol', 'Incomplete streamed tool identity.', 502);
    const parsed = toolInput(tool.arguments);
    content.push({ type: tool.type, id: tool.id, name: tool.name, input: parsed });
    await sendEvent(response, 'content_block_stop', { index: tool.index });
  }
  const result = { content, finish, usage: finalUsage, nextIndex };
  if (options.deferFinish) return result;
  await finishStream(response, finish, finalUsage);
  return result;
}

export async function finishStream(response, reason, usage) {
  await sendEvent(response, 'message_delta', { delta: { stop_reason: stopReason(reason), stop_sequence: null }, usage });
  await sendEvent(response, 'message_stop', {}); response.end();
}
