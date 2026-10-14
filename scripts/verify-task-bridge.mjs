import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/core/config.mjs';
import { network } from '../src/core/network.mjs';
import { Profiles } from '../src/gateway/profiles.mjs';
import { ModelProxy } from '../src/gateway/model-proxy.mjs';
import { readFile } from 'node:fs/promises';

// Explicit, bounded real-provider acceptance. No profile activation or user-task
// mutation. The optional provider name selects an existing authorized profile.
const [home, provider, pdfArgument] = process.argv.slice(2), pdfPath = pdfArgument?.startsWith('--') ? null : pdfArgument;
const config = await loadConfig(home), profiles = new Profiles(home), net = network(config);
let profile = provider ? await profiles.resolve((await profiles.store()).profiles.find(p => p.provider === provider)) : await profiles.active();
if (process.argv.includes('--anthropic')) {
  assert.equal(new URL(profile.baseUrl).origin, 'https://api.deepseek.com', 'This option only selects the same authorized DeepSeek host.');
  profile = { ...profile, protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' };
}
const proxy = new ModelProxy(profiles, { fetch: net.fetch, proxy: config.network?.proxy });
async function probe(input) {
  const chunks = [], output = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
  output.writeHead = () => { output.headersSent = true; }; output.setHeader = () => {};
  await proxy.dispatch({ model: 'task-verification', max_tokens: 700, thinking: { type: 'disabled' }, ...input }, { headers: {} }, output, profile);
  return JSON.parse(Buffer.concat(chunks));
}
try {
  const source = pdfPath ? { type: 'base64', media_type: 'application/pdf', data: (await readFile(pdfPath)).toString('base64') }
    : { type: 'text', media_type: 'text/plain', data: 'Acceptance sample. The measured value is 37.' };
  const structured = await probe({ messages: [{ role: 'user', content: [{ type: 'document', title: 'Acceptance sample', source },
    { type: 'text', text: 'Read the document and return the measured value as JSON.' }] }],
  output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } } } });
  const value = JSON.parse(structured.content.find(block => block.type === 'text').text);
  assert.equal(value.value, 37);
  console.log(JSON.stringify({ provider: profile.provider, protocol: profile.protocol, model: profile.model, document: pdfPath ? 'PDF' : 'plain text', structuredOutput: 'passed', observedValue: value.value }));
  if (process.argv.includes('--web')) {
    const page = 'https://pubmed.ncbi.nlm.nih.gov/about/';
    const result = await probe({ messages: [{ role: 'user', content: `Read ${page} using web_fetch. Return one short fact from its body with the URL.` }],
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1 }], tool_choice: { type: 'tool', name: 'web_fetch' } });
    const receipt = result.content.find(block => block.type === 'web_fetch_tool_result');
    assert.equal(receipt?.content.type, 'web_fetch_result');
    assert.match(receipt.content.content.source.data, /PubMed/);
    assert.ok(result.content.some(block => block.type === 'text' && block.text.trim()));
    console.log(JSON.stringify({ provider: profile.provider, protocol: profile.protocol, model: profile.model, webFetch: 'passed', source: receipt.content.url, receivedCharacters: receipt.content.content.source.data.length }));
  }
} finally { await net.close(); }
