import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebEvidence } from '../src/gateway/web-evidence.mjs';
const receipt = { type: 'web_fetch_tool_result', tool_use_id: 'fetch-1', content: { type: 'web_fetch_result', url: 'https://example.org/paper', retrieved_at: '2026-10-14T00:00:00Z',
  content: { type: 'document', title: 'Paper', source: { type: 'text', data: 'Measured value 37.' } } } };

test('source evidence survives original hosted-block stripping and bridge restart', async t => {
  const home = await mkdtemp(join(tmpdir(), 'cs-web-evidence-')); t.after(() => rm(home, { recursive: true, force: true }));
  const link = await new WebEvidence(home).remember(receipt);
  const resumed = await new WebEvidence(home).restore({ messages: [{ role: 'assistant', content: [link, { type: 'tool_use', id: 'py', name: 'python', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'py', content: 'saved' }] }] });
  assert.match(JSON.stringify(resumed), /Previously executed web_fetch/);
  assert.match(JSON.stringify(resumed), /Measured value 37/);
});

test('evidence is URL-bound, bounded, and explicit when unavailable; rich receipts are not duplicated', async () => {
  const store = new WebEvidence(null, { limit: 1 }), link = await store.remember(receipt);
  const rich = await store.restore({ messages: [{ role: 'assistant', content: [receipt, link] }] });
  assert.equal(rich.messages[0].content.length, 2);
  const forged = { ...link, text: link.text.replace('example.org/paper', 'example.org/other') };
  assert.doesNotMatch(JSON.stringify(await store.restore({ messages: [{ role: 'user', content: [forged] }] })), /Measured value/);
  await store.remember(receipt);
  assert.match(JSON.stringify(await store.restore({ messages: [{ role: 'assistant', content: [link] }] })), /unavailable or expired/);
});
