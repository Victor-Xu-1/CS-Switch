import { Agent, ProxyAgent, request } from 'undici';
import { Readable } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { invariant, BridgeError } from '../core/errors.mjs';
import { publicDns } from './public-dns.mjs';
import { readWebBody } from './web-body.mjs';

const publicAddress = address => {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
};
async function pinnedRequest(url, options) {
  const result = await request(url, { ...options, method: 'GET', maxRedirections: 0 });
  const headers = {};
  for (const key of ['content-type', 'content-length', 'content-encoding', 'location']) if (result.headers[key] !== undefined) headers[key] = String(result.headers[key]);
  if ([204, 304].includes(result.statusCode)) { result.body.resume(); return new Response(null, { status: result.statusCode, headers }); }
  return new Response(Readable.toWeb(result.body), { status: result.statusCode, headers });
}
export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new BridgeError('invalid_tool_input', 'A valid public HTTP(S) URL is required.'); }
  url.hostname = url.hostname.replace(/\.$/, '');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  invariant(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    (!url.port || [80, 443].includes(Number(url.port))) && (host.includes('.') || ipaddr.isValid(host)) &&
    !['localhost', 'local', 'internal', 'home', 'test', 'invalid', 'onion'].some(suffix => host === suffix || host.endsWith(`.${suffix}`)) &&
    (!ipaddr.isValid(host) || publicAddress(host)), 'url_not_allowed', 'Only public HTTP(S) destinations on standard ports are allowed.');
  invariant(url.href.length <= 8192, 'url_too_long', 'Web URL exceeds 8192 characters.');
  url.hash = ''; return url;
}

export function domainAllowed(url, definition = {}) {
  const match = rule => {
    const target = new URL(`https://${rule}`);
    return (url.hostname === target.hostname || url.hostname.endsWith(`.${target.hostname}`)) &&
      (target.pathname === '/' || url.pathname.startsWith(target.pathname));
  };
  return (!definition.allowed_domains?.length || definition.allowed_domains.some(match)) && !definition.blocked_domains?.some(match);
}

// Pin the checked IP in the request URL (including proxy CONNECT) while keeping
// the original HTTP Host and TLS SNI/certificate identity. DNS rebinding cannot
// change the destination between the policy check and connection establishment.
export class PublicWeb {
  constructor(options = {}) { this.fetch = options.fetch || pinnedRequest; this.lookup = options.lookup || publicDns; this.proxy = options.proxy || null; }
  async get(value, { signal, maxBytes = 8 * 1024 * 1024, definition = {} } = {}) {
    const abort = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    let url = publicUrl(value);
    for (let redirect = 0; redirect <= 4; redirect++) {
      abort.throwIfAborted();
      invariant(domainAllowed(url, definition), 'url_not_allowed', 'URL is outside the tool domain policy.');
      const addresses = await this.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, proxy: this.proxy, signal: abort });
      abort.throwIfAborted();
      invariant(addresses.length && addresses.every(item => publicAddress(item.address)), 'url_not_allowed', 'URL resolves to a non-public address.');
      const pinned = new URL(url); pinned.hostname = addresses[0].family === 6 ? `[${addresses[0].address}]` : addresses[0].address;
      const tls = { servername: url.hostname };
      const dispatcher = this.proxy ? new ProxyAgent({ uri: this.proxy, requestTls: tls }) : new Agent({ connect: tls });
      try {
        const response = await this.fetch(pinned.href, { dispatcher, signal: abort, redirect: 'manual',
          headers: { host: url.host, 'accept-encoding': 'gzip, br, deflate', accept: 'text/html,application/pdf,text/plain,application/json', 'user-agent': 'CS-Switch public document reader' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          invariant(redirect < 4 && response.headers.get('location'), 'url_not_accessible', 'Redirect chain exceeds its limit.');
          url = publicUrl(new URL(response.headers.get('location'), url).href); continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new BridgeError('url_not_accessible', `Web resource returned HTTP ${response.status}.`, 502); }
        const data = await readWebBody(response, maxBytes, abort);
        return { url: url.href, mediaType: response.headers.get('content-type')?.split(';')[0].trim() || '', data, retrievedAt: new Date().toISOString() };
      } finally { await dispatcher.destroy(); }
    }
  }
}
