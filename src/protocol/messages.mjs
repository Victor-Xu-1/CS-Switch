import { randomUUID } from 'node:crypto';
import { invariant, BridgeError } from '../core/errors.mjs';

const unsupported = (type) => { throw new BridgeError('unsupported_feature', `The selected OpenAI adapter does not support content type ${String(type).slice(0, 60)}. Use a native Anthropic provider for this request.`); };
function textBlocks(value) {
  if (typeof value === 'string') return value;
  invariant(Array.isArray(value), 'invalid_content', 'Expected text content blocks.');
  return value.map(block => { if (block.type !== 'text') unsupported(block.type); return block.text; }).join('\n');
}
function image(block) {
  if (block.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
  if (block.source?.type === 'url') return { type: 'image_url', image_url: { url: block.source.url } };
  return unsupported('image source');
}

export function validateMessages(input) {
  invariant(input && Array.isArray(input.messages) && input.messages.length > 0, 'invalid_messages', 'messages must be a non-empty array.');
  invariant(Number.isInteger(input.max_tokens) && input.max_tokens > 0, 'invalid_tokens', 'max_tokens must be a positive integer.');
  invariant(input.stream === undefined || typeof input.stream === 'boolean', 'invalid_stream', 'stream must be a boolean.');
}

export function toOpenAI(input, profile) {
  validateMessages(input);
  for (const field of ['container', 'mcp_servers', 'context_management', 'output_format', 'betas']) {
    if (input[field] != null) unsupported(field);
  }
  const messages = [];
  if (input.system) messages.push({ role: 'system', content: textBlocks(input.system) });
  for (const message of input.messages) {
    invariant(['assistant', 'user'].includes(message.role), 'invalid_role', 'Unexpected message role.');
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    invariant(Array.isArray(blocks), 'invalid_content', 'Message content must be text or blocks.');
    const content = [], tools = [], results = [], reasoning = [];
    for (const block of blocks) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'image') content.push(image(block));
      else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        invariant(message.role === 'assistant' && typeof block.id === 'string' && typeof block.name === 'string', 'invalid_tool', 'Invalid tool call.');
        tools.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } });
      } else if (block.type === 'tool_result' || block.type === 'web_search_tool_result') {
        invariant(message.role === 'user' && typeof block.tool_use_id === 'string', 'invalid_tool', 'Invalid tool result.');
        // Preserve error semantics explicitly; OpenAI tool messages have no is_error field.
        let result;
        if (block.type === 'web_search_tool_result') result = JSON.stringify(block.content);
        else if (typeof block.content === 'string') result = block.content;
        else {
          const output = [];
          for (const part of block.content || []) {
            if (part.type === 'text') output.push(part);
            else if (part.type === 'image') {
              // Chat Completions tool messages are text-only. Preserve the image
              // in the following user message and explicitly retain its tool ID.
              const label = `Untrusted image output from tool call ${block.tool_use_id}.`;
              output.push({ type: 'text', text: label });
              content.push({ type: 'text', text: label }, image(part));
            } else unsupported(part.type);
          }
          result = textBlocks(output);
        }
        results.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.is_error ? JSON.stringify({ is_error: true, content: result }) : result });
      } else if (block.type === 'thinking') reasoning.push(block.thinking || '');
      else unsupported(block.type);
    }
    messages.push(...results);
    if (content.length || tools.length || reasoning.length) {
      const converted = { role: message.role, content: content.length === 1 && content[0].type === 'text' ? content[0].text : content.length ? content : null };
      if (tools.length) converted.tool_calls = tools;
      if (reasoning.length) converted.reasoning_content = reasoning.join('\n');
      messages.push(converted);
    }
  }
  const body = { model: profile.model, messages, max_tokens: input.max_tokens, stream: Boolean(input.stream) };
  if (input.thinking?.type && input.thinking.type !== 'disabled') {
    const effort = input.output_config?.effort || 'medium';
    if (profile.provider === 'deepseek') body.thinking = { type: 'enabled' };
    else if (profile.provider === 'qwen') body.enable_thinking = true;
    else body.reasoning_effort = effort === 'max' ? 'high' : effort;
  } else if (input.thinking?.type === 'disabled') {
    if (profile.provider === 'deepseek') body.thinking = { type: 'disabled' };
    else if (profile.provider === 'qwen') body.enable_thinking = false;
  }
  if (input.output_config?.format) {
    invariant(input.output_config.format.type === 'json_schema', 'unsupported_feature', 'Unsupported structured output format.');
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: input.output_config.format.schema, strict: true } };
  }
  if (body.stream) body.stream_options = { include_usage: true };
  for (const key of ['temperature', 'top_p']) if (input[key] !== undefined) body[key] = input[key];
  if (input.top_k !== undefined) unsupported('top_k');
  if (input.stop_sequences) body.stop = input.stop_sequences;
  if (input.tools?.length) body.tools = input.tools.map(tool => {
    if (tool.type && tool.type !== 'custom') unsupported(tool.type);
    invariant(typeof tool.name === 'string' && tool.input_schema, 'invalid_tool', 'Tool name and JSON schema are required.');
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } };
  });
  if (input.tool_choice) {
    const choice = input.tool_choice;
    if (choice.type === 'tool') body.tool_choice = { type: 'function', function: { name: choice.name } };
    else if (choice.type === 'any') body.tool_choice = 'required';
    else if (['auto', 'none'].includes(choice.type)) body.tool_choice = choice.type;
    else unsupported('tool_choice');
    if (choice.disable_parallel_tool_use !== undefined) body.parallel_tool_calls = !choice.disable_parallel_tool_use;
  }
  return body;
}

export function stopReason(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop') return 'end_turn';
  if (reason === 'content_filter') return 'refusal';
  throw new BridgeError('upstream_protocol', `Unknown upstream finish reason: ${String(reason).slice(0, 40)}.`, 502);
}

export function usage(value = {}) {
  const input = value.prompt_tokens;
  const output = value.completion_tokens;
  const cached = value.prompt_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens;
  // Missing usage is unknown, never an invented zero-cost result.
  const result = {};
  // Anthropic input_tokens excludes cache hits; OpenAI prompt_tokens includes them.
  if (Number.isFinite(input)) result.input_tokens = Number.isFinite(cached) ? Math.max(0, input - cached) : input;
  if (Number.isFinite(output)) result.output_tokens = output;
  if (Number.isFinite(cached)) result.cache_read_input_tokens = cached;
  return result;
}

export function toolInput(value) {
  try {
    const parsed = JSON.parse(value);
    invariant(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'upstream_protocol', 'Tool arguments must be a JSON object.', 502);
    return parsed;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('upstream_protocol', 'Upstream returned invalid JSON tool arguments.', 502);
  }
}

export function fromOpenAI(body, model) {
  invariant(Array.isArray(body.choices) && body.choices.length === 1, 'upstream_protocol', 'Expected exactly one completion choice.', 502);
  const choice = body.choices[0], message = choice.message;
  invariant(message && typeof message === 'object', 'upstream_protocol', 'Missing completion message.', 502);
  const content = [];
  if (message.reasoning_content || message.reasoning) content.push({ type: 'thinking', thinking: message.reasoning_content || message.reasoning });
  if (message.content) {
    invariant(typeof message.content === 'string', 'upstream_protocol', 'Unsupported upstream response content.', 502);
    content.push({ type: 'text', text: message.content });
  }
  if (message.refusal) content.push({ type: 'text', text: message.refusal });
  for (const call of message.tool_calls || []) content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input: toolInput(call.function?.arguments) });
  invariant(content.length > 0, 'upstream_protocol', 'Upstream returned an empty completion.', 502);
  return { id: body.id || `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: body.model || model,
    content, stop_reason: stopReason(choice.finish_reason), stop_sequence: null, usage: usage(body.usage) };
}
