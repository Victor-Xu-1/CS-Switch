import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicWeb, publicUrl } from '../src/gateway/public-web.mjs';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import { readWebBody } from '../src/gateway/web-body.mjs';

test('public web rejects private, credentialed and non-HTTP targets', async () => {
  for (const url of ['http://127.0.0.1/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/', 'https://user:pass@example.com/', 'file:///etc/passwd']) {
    assert.throws(() => publicUrl(url), { code: 'url_not_allowed' });
  }
  const web = new PublicWeb({ lookup: async () => [{ address: '10.0.0.1', family: 4 }], fetch: () => { throw Error('must not connect'); } });
  await assert.rejects(web.get('https://example.com'), { code: 'url_not_allowed' });
});

test('public web pins a validated address and rechecks redirects', async () => {
  let calls = 0;
  const web = new PublicWeb({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetch: async (url, options) => {
    calls++; assert.equal(new URL(url).hostname, '93.184.216.34'); assert.equal(options.headers.host, 'example.com');
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } });
  await assert.rejects(web.get('https://example.com'), { code: 'url_not_allowed' });
  assert.equal(calls, 1);
});

test('public web bounds bytes and stops cancelled reads', async () => {
  const web = new PublicWeb({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetch: async () => new Response('12345') });
  await assert.rejects(web.get('https://example.com', { maxBytes: 4 }), { code: 'content_too_large' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(web.get('https://example.com', { signal: controller.signal }), { name: 'AbortError' });
});

test('common HTTP compression is decoded with an independent expansion limit', async () => {
  for (const [encoding, compress] of [['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]]) {
    const response = new Response(compress(Buffer.from('public page')), { headers: { 'content-encoding': encoding } });
    assert.equal((await readWebBody(response, 100, new AbortController().signal)).toString(), 'public page');
  }
  const bomb = new Response(gzipSync(Buffer.alloc(10000, 65)), { headers: { 'content-encoding': 'gzip' } });
  await assert.rejects(readWebBody(bomb, 100, new AbortController().signal), { code: 'content_too_large' });
});
