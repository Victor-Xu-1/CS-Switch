import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BridgeError, invariant, publicError } from '../core/errors.mjs';
import { validateMessages } from '../protocol/messages.mjs';
import { taskConversation } from './task-conversation.mjs';
import { PublicWeb } from './public-web.mjs';
import { hasDocuments } from '../protocol/documents.mjs';
import { WebEvidence } from './web-evidence.mjs';
import { sendEvent } from '../protocol/sse.mjs';

export function modelUrl(profile) {
  const base = profile.baseUrl.replace(/\/+$/, '');
  if (profile.protocol === 'anthropic') return `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`;
  return `${base}/chat/completions`;
}

export class ModelProxy {
  active = 0;
  constructor(profiles, options = {}) {
    this.profiles = profiles; this.timeoutMs = options.timeoutMs || 300000; this.limit = options.limit || 8;
    this.fetch = options.fetch || fetch; this.web = options.web || new PublicWeb({ proxy: options.proxy });
    this.evidence = options.evidence || new WebEvidence(options.home);
  }
  async dispatch(input, request, response, selectedProfile = null, externalSignal = null) {
    invariant(this.active < this.limit, 'busy', 'Model gateway concurrency limit reached. Retry when a request completes.', 429);
    const profile = selectedProfile || await this.profiles.active();
    validateMessages(input);
    const headers = { 'content-type': 'application/json', accept: input.stream ? 'text/event-stream' : 'application/json' };
    if (profile.protocol === 'anthropic') {
      headers['anthropic-version'] = request.headers['anthropic-version'] || '2023-06-01';
      if (request.headers['anthropic-beta']) headers['anthropic-beta'] = request.headers['anthropic-beta'];
      if (profile.apiKey) headers['x-api-key'] = profile.apiKey;
    } else if (profile.apiKey) headers.authorization = `Bearer ${profile.apiKey}`;
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableEnded) controller.abort(); };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs), ...(externalSignal ? [externalSignal] : [])]);
    signal.throwIfAborted();
    invariant(this.active < this.limit, 'busy', 'Model gateway concurrency limit reached.', 429);
    response.on('close', disconnected);
    this.active++;
    try {
      if (profile.protocol === 'openai' || hasDocuments(input) || input.tools?.some(tool => /^web_(search|fetch)_/.test(tool.type)) || input.output_config?.format || input.output_format) {
        await taskConversation({ input, profile, request, response, fetch: this.fetch, web: this.web, evidence: this.evidence, url: modelUrl(profile), headers, signal });
        return;
      }
      const body = { ...await this.evidence.restore(input), model: profile.model };
      const upstream = await this.fetch(modelUrl(profile), { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        if (upstream.headers.has('retry-after')) response.setHeader('retry-after', upstream.headers.get('retry-after'));
        throw new BridgeError('provider_http_error', `Provider returned HTTP ${upstream.status}. Verify its endpoint, model, credentials and quota.`, upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502);
      }
      // Native Messages payloads and SSE are forwarded without waiting for EOF.
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      await pipeline(Readable.fromWeb(upstream.body), response, { signal });
    } catch (error) {
      if (response.headersSent && !response.destroyed && !response.writableEnded) {
        if (input.stream) await sendEvent(response, 'error', { error: { type: publicError(error).code, message: publicError(error).message } }).catch(() => {});
        response.end();
      } else if (!response.destroyed) throw error;
    } finally { this.active--; response.off('close', disconnected); }
  }
}
