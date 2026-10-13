import assert from 'node:assert/strict';
import { loadConfig } from '../src/core/config.mjs';
import { network } from '../src/core/network.mjs';
import { Profiles } from '../src/gateway/profiles.mjs';
import { modelUrl } from '../src/gateway/model-proxy.mjs';
import { toOpenAI, fromOpenAI } from '../src/protocol/messages.mjs';

// Explicitly invoked, short paid inference; no tools execute and no state changes.
// Reproduce original background extraction's forced-tool, non-thinking contract.
const config = await loadConfig(process.argv[2]);
const profile = await new Profiles(config.home).active();
assert.equal(profile.provider, 'deepseek', 'This acceptance case targets the authorized DeepSeek profile.');
const input = { max_tokens: 256, messages: [{ role: 'user', content: 'Code: data = read_csv("input.csv"). Report the only input file using the provided tool.' }],
  tools: [{ name: 'report_input_files', description: 'Report the files read by the code.', input_schema: {
    type: 'object', properties: { input_files: { type: 'array', items: { type: 'object', properties: { artifact_ref: { type: 'string' } }, required: ['artifact_ref'], additionalProperties: false } } },
    required: ['input_files'], additionalProperties: false } }], tool_choice: { type: 'tool', name: 'report_input_files' } };
const net = network(config);
try {
  const body = toOpenAI(input, profile);
  const response = await net.fetch(modelUrl(profile), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${profile.apiKey}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
  const result = await response.json();
  console.log(JSON.stringify({ status: response.status, model: profile.model, thinking: body.thinking || 'provider default',
    errorMentionsThinking: !response.ok && /thinking/i.test(result.error?.message || ''),
    errorMentionsToolChoice: !response.ok && /tool_choice/i.test(result.error?.message || '') }));
  assert.equal(response.status, 200, 'Forced-tool request must succeed. Provider bodies/credentials are intentionally not logged.');
  const message = fromOpenAI(result, profile.model);
  const call = message.content.find(block => block.type === 'tool_use');
  assert.equal(call?.name, 'report_input_files');
  assert.deepEqual(call.input.input_files, [{ artifact_ref: 'input.csv' }]);
  console.log(JSON.stringify({ forcedTool: call.name, inputFiles: call.input.input_files, passed: true }));
} finally { await net.close(); }
