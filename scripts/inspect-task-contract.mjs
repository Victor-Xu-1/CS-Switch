import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { body, json } from '../src/gateway/http.mjs';

// Controlled local protocol fixture, NOT evidence of real-model quality.
const app = process.argv[2] || 'http://127.0.0.1:19800';
const port = Number(process.argv[3] || 19802);
const captured = [];
const server = createServer(async (req, res) => {
  const input = await body(req);
  captured.push({ fields: Object.keys(input), thinking: input.thinking, output_config: input.output_config,
    model: input.model, tools: input.tools?.map(t => ({ name: t.name, type: t.type, schema: t.input_schema })) });
  const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: input.model, content: [{ type: 'text', text: 'Controlled CS-Switch protocol fixture completed.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
  if (!input.stream) return json(res, 200, message);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [event, data] of [
    ['message_start', { message: { ...message, content: [], stop_reason: null } }],
    ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: message.content[0].text } }],
    ['content_block_stop', { index: 0 }], ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }], ['message_stop', {}],
  ]) res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  res.end();
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const csrfResponse = await fetch(`${app}/api/csrf`, { headers: { origin: app } });
const csrfCookie = csrfResponse.headers.getSetCookie().find(value => value.startsWith('operon_csrf='));
if (!csrfCookie) throw new Error('Runtime did not issue its normal CSRF cookie.');
const csrfToken = decodeURIComponent(csrfCookie.split(';')[0].slice('operon_csrf='.length));
const call = async (path, data) => {
  const response = await fetch(`${app}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin: app, 'x-operon-csrf': csrfToken }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
};
try {
  const project = await call('/api/projects', { name: 'CS-Switch isolated protocol validation', find_or_create: true });
  console.log(JSON.stringify({ project }));
  const result = await call(`/api/projects/${project.project_id}/request`, { input_data: { request: 'This is a software integration check. Please say hello.' }, plan_mode: false });
  console.log(JSON.stringify({ request: result }));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (captured.some(c => c.tools?.length)) break;
    await delay(500);
  }
  console.log(JSON.stringify({ captured: captured.map(c => ({ ...c, tools: c.tools?.map(t => ({ name: t.name, type: t.type, required: t.schema?.required })) })) }, null, 2));
} finally { server.closeAllConnections(); server.close(); }
