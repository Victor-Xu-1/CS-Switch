const serverResult = block => ['web_search_tool_result', 'web_fetch_tool_result'].includes(block.type);

// Server results are assistant-visible in Anthropic responses, but must become
// user/tool receipts before the next provider turn. Keep client tools untouched.
export function taskHistory(messages, native = false) {
  const output = [];
  const append = (role, content) => {
    if (!content.length) return;
    const previous = output.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else output.push({ role, content });
  };
  const convert = block => {
    if (!native) return block;
    if (block.type === 'server_tool_use') return { ...block, type: 'tool_use' };
    if (serverResult(block)) return { type: 'tool_result', tool_use_id: block.tool_use_id, content: JSON.stringify(block.content),
      ...(block.content?.type?.endsWith('_error') ? { is_error: true } : {}) };
    return block;
  };
  for (const message of messages) {
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (message.role === 'assistant') {
      append('assistant', content.filter(block => !serverResult(block)).map(convert));
      append('user', content.filter(serverResult).map(convert));
    } else append(message.role, content.map(convert));
  }
  return output;
}
