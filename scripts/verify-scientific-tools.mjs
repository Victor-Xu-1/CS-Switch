import { createServer } from 'node:http';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initialize } from '../src/core/config.mjs';
import { atomicJson } from '../src/core/files.mjs';
import { Profiles } from '../src/gateway/profiles.mjs';
import { body, json } from '../src/gateway/http.mjs';
import { serve } from '../src/server.mjs';

// Deterministic model-wire fixture drives the REAL application tool runtime.
// This verifies execution/protocol integration, never external model quality.
const [home, releaseHome, releaseId, protocol = 'openai'] = process.argv.slice(2);
if (!home || !releaseHome || !releaseId) throw Error('Usage: verify-scientific-tools.mjs ISOLATED_HOME RELEASES_DIRECTORY RELEASE_ID [openai|anthropic]');
const config = await initialize(home, { port: 19990, appPort: 19991, sandboxPort: 19993, modelPort: 19992, network: { proxy: process.env.HTTPS_PROXY || null },
  update: { autoApply: false, intervalMs: 21600000, feed: 'https://storage.googleapis.com/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59/operon-releases', channel: 'latest', catalogDirectory: join(home, 'inbox') } });
await mkdir(join(home, 'data'), { recursive: true });
try { await symlink(releaseHome, join(home, 'releases')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await atomicJson(join(home, 'state.json'), { schema: 1, active: { releaseId, dataPath: join(home, 'data') }, previous: null, candidate: null, update: { phase: 'ready' } });
const profiles = new Profiles(home);
const saved = (await profiles.list()).profiles[0];
await profiles.save({ id: saved?.id, protocol, provider: `${protocol}-compatible`, model: 'controlled-protocol-fixture', baseUrl: 'http://127.0.0.1:19994' + (protocol === 'openai' ? '/v1' : ''), name: 'LOCAL TEST FIXTURE ONLY', activate: true });
const receipts = [], approvedCalls = new Map();
const fixture = createServer(async (request, response) => {
  const input = await body(request), names = (input.tools || []).map(t => t.function?.name || t.name);
  const history = JSON.stringify(input.messages);
  let call = null;
  if (names.includes('create_work_item')) call = { name: 'create_work_item', id: 'fixture-title', input: { title: 'CS-Switch integration check', task_summary: 'Verify local tool execution.' } };
  else if (names.includes('submit_output') && !names.includes('python')) call = { name: 'submit_output', id: 'fixture-review', input: { human_description: 'Checking integration test receipts', findings: [], _completion_bullets: ['Reviewed controlled tool execution receipts'] } };
  else if (names.includes('python') && !history.includes('fixture-python')) call = { name: 'python', id: 'fixture-python', input: { human_description: 'Computing a small Python result', environment: 'python', code: 'import csv\nwith open("cs-switch-probe.csv", "w") as f:\n    f.write("value\\n6\\n")\nprint("CS_SWITCH_PYTHON", sum([1,2,3]))' } };
  else if (names.includes('r') && !history.includes('fixture-r"')) call = { name: 'r', id: 'fixture-r', input: { human_description: 'Computing a small R result', environment: 'r', code: 'cat("CS_SWITCH_R", sum(c(1,2,3)), "\\n")' } };
  else if (names.includes('repl') && !history.includes('fixture-repl')) call = { name: 'repl', id: 'fixture-repl', input: { human_description: 'Looking up ethanol through PubChem', code: 'print("CS_SWITCH_MCP_RESULT")\nprint(host.mcp("chemistry", "pubchem_search_compounds", query="ethanol", max_cids=1, with_properties=False))' } };
  else if (names.includes('save_artifacts') && !history.includes('fixture-save')) call = { name: 'save_artifacts', id: 'fixture-save', input: { human_description: 'Saving the integration result table', files: ['cs-switch-probe.csv'] } };
  if (call?.input.code) approvedCalls.set(call.id, call.input.code);
  const outputs = input.messages?.filter(m => m.role === 'tool').map(m => ({ id: m.tool_call_id, text: m.content }));
  if (outputs?.length) receipts.push(...outputs);
  if (protocol === 'anthropic') for (const message of input.messages || []) for (const block of Array.isArray(message.content) ? message.content : []) if (block.type === 'tool_result') receipts.push({ id: block.tool_use_id, text: block.content, isError: block.is_error });
  const text = 'Controlled protocol fixture finished. This is not a real-model acceptance test.';
  if (protocol === 'openai') {
    const result = call ? { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } }] } : { role: 'assistant', content: text };
    if (!input.stream) return json(response, 200, { id: 'fixture-response', model: input.model, choices: [{ message: result, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = call ? { tool_calls: [{ index: 0, ...result.tool_calls[0] }] } : { content: text };
    response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  } else {
    const content = call ? [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] : [{ type: 'text', text }];
    const message = { id: 'fixture-response', type: 'message', role: 'assistant', model: input.model, content, stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } };
    if (!input.stream) return json(response, 200, message);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text };
    const startBlock = call ? { type: 'tool_use', id: call.id, name: call.name, input: {} } : { type: 'text', text: '' };
    for (const [event, value] of [['message_start', { message: { ...message, content: [], stop_reason: null } }], ['content_block_start', { index: 0, content_block: startBlock }], ['content_block_delta', { index: 0, delta }], ['content_block_stop', { index: 0 }], ['message_delta', { delta: { stop_reason: message.stop_reason }, usage: message.usage }], ['message_stop', {}]]) response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...value })}\n\n`);
    response.end();
  }
});
await new Promise(resolve => fixture.listen(19994, '127.0.0.1', resolve));
let service;
try {
  service = await serve(config);
  const origin = `http://127.0.0.1:${config.port}`;
  const csrf = await fetch(`${origin}/api/csrf`, { headers: { origin } });
  const cookie = csrf.headers.getSetCookie().find(c => c.startsWith('operon_csrf='));
  const token = decodeURIComponent(cookie.split(';')[0].slice('operon_csrf='.length));
  const call = async (path, data) => {
    const response = await fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', 'x-operon-csrf': token }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw Error(JSON.stringify(result)); return result;
  };
  const project = await call('/api/projects', { name: `CS-Switch ${protocol} execution verification`, find_or_create: true });
  const task = await call(`/api/projects/${project.project_id}/request`, { input_data: { request: 'Verify Python and R execution and save a tiny CSV artifact. This is an isolated software test.' }, plan_mode: false });
  console.log(JSON.stringify({ task, protocol }));
  const deadline = Date.now() + 120000;
  let final;
  while (Date.now() < deadline) {
    final = await call(`/api/frames/${task.root_frame_id}`);
    const pending = final.output_data?.pending_input_requests || [];
    const permitted = pending.filter(p => p.kind === 'local_exec' && approvedCalls.get(p.tool_id) === p.code);
    if (permitted.length) {
      await call(`/api/frames/${task.root_frame_id}/resolve-input`, { responses: permitted.map(p => ({ requestId: p.requestId, tool_id: p.tool_id, approved: true, action: 'allow' })) });
    }
    if (['completed', 'failed', 'awaiting_input', 'paused'].includes(final.status)) break;
    await delay(1000);
  }
  const unique = [...new Map(receipts.map(r => [r.id, r])).values()];
  const evidence = { protocol, model: 'controlled fixture, not external inference', task, status: final?.status, frameKeys: Object.keys(final || {}), receipts: unique };
  await atomicJson(join(home, 'tool-evidence.json'), evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (final?.status !== 'completed' || !unique.some(r => JSON.stringify(r.text).includes('CS_SWITCH_PYTHON 6')) || !unique.some(r => JSON.stringify(r.text).includes('CS_SWITCH_R 6'))) process.exitCode = 1;
} finally { await service?.close(); fixture.closeAllConnections(); fixture.close(); }
