import { lookup } from 'node:dns/promises';
import { ProxyAgent, fetch } from 'undici';
import { isIP } from 'node:net';
import { invariant } from '../core/errors.mjs';

// Proxy software can replace system DNS with non-routable synthetic addresses.
// Resolve through a fixed HTTPS DNS endpoint when a proxy is configured, then
// still validate/pin every returned destination in PublicWeb. No private-IP
// exception or unvalidated proxy-side hostname resolution is permitted.
export async function publicDns(host, { proxy, signal } = {}) {
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  if (!proxy) return lookup(host, { all: true });
  const dispatcher = new ProxyAgent(proxy);
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      dispatcher, signal, redirect: 'error', headers: { accept: 'application/dns-json' },
    });
    invariant(response.ok, 'url_not_accessible', 'Public DNS resolver is unavailable.');
    let text = '';
    for await (const chunk of response.body) { text += Buffer.from(chunk).toString('utf8'); invariant(text.length < 65536, 'url_not_accessible', 'DNS response exceeds its limit.'); }
    const result = JSON.parse(text);
    invariant(result.Status === 0, 'url_not_accessible', 'Public DNS could not resolve this hostname.');
    const addresses = (result.Answer || []).filter(item => item.type === 1 && isIP(item.data) === 4).map(item => ({ address: item.data, family: 4 }));
    invariant(addresses.length, 'url_not_accessible', 'No public IPv4 record was returned by the configured-proxy resolver.');
    return addresses;
  } finally { await dispatcher.destroy(); }
}
