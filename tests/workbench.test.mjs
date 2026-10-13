import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages, readLanguage, translate } from '../web/i18n.js';

test('English is the fresh/invalid default; an explicit Chinese choice persists', () => {
  for (const value of [null, 'invalid', 'en']) assert.equal(readLanguage({ getItem: () => value }), 'en');
  assert.equal(readLanguage({ getItem: () => 'zh' }), 'zh');
  assert.equal(readLanguage({ getItem: () => { throw Error('storage denied'); } }), 'en');
});
test('Chinese and English have identical keys and parameter contracts', () => {
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.en)) {
    assert.deepEqual(messages.en[key].match(/\{\w+\}/g), messages.zh[key].match(/\{\w+\}/g));
  }
  assert.equal(translate('zh', 'proof', { date: '2026-10-13' }), '已于 2026-10-13 收到真实模型回复。');
});
test('all static interface labels have translations and the page has one connection action', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) assert.ok(messages.en[key] && messages.zh[key], key);
  assert.equal((html.match(/id="connect"/g) || []).length, 1);
  assert.match(html, /<details id="advanced"/);
  assert.ok(!html.includes('environments.css'));
});
