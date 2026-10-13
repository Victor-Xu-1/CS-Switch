import { EnvHttpProxyAgent, fetch as request } from 'undici';
import { invariant } from './errors.mjs';

export function network(config) {
  const proxy = config.network?.proxy;
  if (proxy) {
    const url = new URL(proxy);
    invariant(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'invalid_proxy', 'Use an HTTP(S) proxy without embedded credentials.');
  }
  const dispatcher = new EnvHttpProxyAgent({ ...(proxy ? { httpProxy: proxy, httpsProxy: proxy } : {}), noProxy: '127.0.0.1,localhost,::1' });
  return { fetch: (url, options = {}) => request(url, { ...options, dispatcher }), close: () => dispatcher.close() };
}

export function networkEnvironment(config) {
  const proxy = config.network?.proxy;
  if (!proxy) return {};
  return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
    NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' };
}
