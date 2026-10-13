import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LatestRequest } from '../web/latest.js';
import { api, errorKey } from '../web/ui.js';

test('a superseded status request cannot restore stale interface state', async () => {
  const gates = [], seen = [];
  const latest = new LatestRequest(() => new Promise(resolve => gates.push(resolve)), value => seen.push(value), error => { throw error; });
  const old = latest.run(); await Promise.resolve();
  assert.equal(latest.run(), old);
  const current = latest.run(true); await Promise.resolve();
  gates[1]('stopped'); await current; gates[0]('running'); await old;
  assert.deepEqual(seen, ['stopped']);
});
test('status failures remain visible instead of retaining a false healthy state', async () => {
  const seen = [];
  const latest = new LatestRequest(async () => { throw Error('offline'); }, () => seen.push('success'), error => seen.push(error.message));
  await assert.rejects(latest.run(), /offline/); assert.deepEqual(seen, ['offline']);
});
test('normal text design tokens meet the 4.5:1 contrast target', async () => {
  const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');
  const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, name, value]) => [name, value]));
  const luminance = hex => hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const [fg, bg] of [['ink', 'surface'], ['muted', 'surface'], ['muted', 'canvas'], ['positive', 'positive-bg'], ['danger', 'danger-bg'], ['surface', 'brand']]) {
    assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg}/${bg}`);
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
});
test('connection inputs expose help and the cancellation control remains outside disabled fields', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="api-key"[^>]*aria-describedby="key-help notice"/);
  assert.match(html, /id="base-url"[^>]*aria-describedby="endpoint-help notice"/);
  assert.match(html, /<\/fieldset>\s*<button id="cancel-test"/);
  assert.match(html, /id="notice"[^>]*tabindex="-1"/);
  assert.match(html, /<title>CS-Switch \(Claude science-Switch\)<\/title>/);
});

test('cancellation while reading a response body remains cancellation, not a generic failure', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => ({ json: async () => { controller.abort(); throw controller.signal.reason; } }));
  await assert.rejects(api('connect', {}, { signal: controller.signal }), { code: 'cancelled' });
});

test('malformed API responses fail explicitly and retain server error status when valid', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>offline</html>'));
  await assert.rejects(api('status'), { code: 'invalid_response' });
  mock.mock.mockImplementation(async () => Response.json({ error: { code: 'provider_http_error', message: 'Unauthorized' } }, { status: 401 }));
  await assert.rejects(api('connect', {}), { code: 'provider_http_error', status: 401 });
  assert.equal(errorKey({ code: 'data_path_too_long' }), 'errorDataPath');
});
