import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson, serial } from '../core/files.mjs';
import { invariant, BridgeError } from '../core/errors.mjs';

export const templates = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'qwen', name: 'Qwen / DashScope', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', name: 'Ollama / local', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' },
  { id: 'openai-compatible', name: 'OpenAI compatible', protocol: 'openai', baseUrl: '' },
  { id: 'anthropic-compatible', name: 'Anthropic compatible', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
];

export function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new BridgeError('invalid_endpoint', 'Enter a valid API base URL.'); }
  invariant(!url.username && !url.password && !url.search && !url.hash, 'invalid_endpoint', 'Endpoint cannot contain credentials, query parameters or fragments.');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  invariant(url.protocol === 'https:' || (local && url.protocol === 'http:'), 'invalid_endpoint', 'Use HTTPS, or HTTP on loopback for a local model.');
  return url.href.replace(/\/+$/, '');
}

export class Profiles {
  #mutate = serial();
  constructor(home) { this.home = home; this.path = join(home, 'providers.json'); }
  async store() {
    const value = await readJson(this.path, { schema: 1, activeId: null, profiles: [] });
    invariant(value.schema === 1 && Array.isArray(value.profiles), 'profile_schema', 'Unsupported provider store.');
    return value;
  }
  async key(create = false) {
    const path = join(this.home, 'providers.key');
    try {
      const key = await readFile(path);
      invariant(key.length === 32, 'key_invalid', 'Provider encryption key is invalid.', 500);
      return key;
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await mkdir(this.home, { recursive: true, mode: 0o700 });
      try { await writeFile(path, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
      return this.key();
    }
  }
  async encrypt(value) {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(true), iv);
    return { iv: iv.toString('base64'), value: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }
  async decrypt(secret) {
    if (!secret) return '';
    try {
      const cipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(secret.iv, 'base64'));
      cipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(secret.value, 'base64')), cipher.final()]).toString('utf8');
    } catch { throw new BridgeError('key_unavailable', 'Cannot decrypt provider key. Restore the matching providers.key or enter the API key again.', 503); }
  }
  safe(profile) {
    const { secret, ...safe } = profile;
    return { ...safe, hasApiKey: Boolean(secret || profile.apiKeyEnv), keySource: profile.apiKeyEnv ? 'environment' : secret ? 'encrypted-local' : 'none' };
  }
  async list() {
    const data = await this.store();
    return { templates, activeId: data.activeId, profiles: data.profiles.map(p => this.safe(p)) };
  }
  async draft(input) {
      invariant(input && typeof input === 'object' && !Array.isArray(input), 'invalid_profile', 'A provider profile object is required.');
      const data = await this.store();
      const existing = input.id ? data.profiles.find(p => p.id === input.id) : undefined;
      invariant(!input.id || existing, 'profile_missing', 'Provider profile not found.', 404);
      const template = templates.find(t => t.id === input.provider);
      const protocol = input.protocol || template?.protocol;
      invariant(['openai', 'anthropic'].includes(protocol), 'invalid_protocol', 'Select OpenAI Chat Completions or Anthropic Messages.');
      invariant(typeof input.model === 'string' && input.model.trim().length > 0 && input.model.length <= 256, 'invalid_model', 'A model identifier is required.');
      invariant(input.apiKey === undefined || (typeof input.apiKey === 'string' && input.apiKey.length < 8192 && !/[\r\n]/.test(input.apiKey)), 'invalid_key', 'Invalid API key.');
      const apiKeyEnv = input.apiKey ? '' : input.apiKeyEnv || '';
      invariant(!apiKeyEnv || /^[A-Z_][A-Z0-9_]{0,127}$/.test(apiKeyEnv), 'invalid_env', 'Invalid API key environment variable.');
      const baseUrl = endpoint(input.baseUrl);
      invariant(!existing || existing.baseUrl === baseUrl || (!existing.secret && !existing.apiKeyEnv) ||
        (!apiKeyEnv && (Boolean(input.apiKey) || input.clearKey)), 'credential_endpoint_changed',
      'Re-enter a credential for the new endpoint. Saved credentials cannot be forwarded to a different address.');
      const profile = { id: existing?.id || randomUUID(), name: String(input.name || input.provider || protocol).slice(0, 128),
        provider: template?.id || `${protocol}-compatible`, protocol, model: input.model.trim(), baseUrl,
        apiKeyEnv, secret: input.clearKey ? null : existing?.secret || null, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (input.apiKey) profile.secret = await this.encrypt(input.apiKey);
      if (apiKeyEnv) profile.secret = null;
      return profile;
  }
  async resolve(profile) {
    const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : await this.decrypt(profile.secret);
    invariant(!profile.apiKeyEnv || apiKey, 'key_unavailable', 'The configured API key environment variable is not set in the service.', 503);
    return { ...profile, apiKey: apiKey || '' };
  }
  save(input) {
    return this.commitDraft(() => this.draft(input), input.activate);
  }
  commitDraft(makeDraft, activate = true, verification = null) {
    return this.#mutate(async () => {
      const profile = await makeDraft();
      const data = await this.store();
      if (verification) profile.connectionTest = verification;
      data.profiles = [...data.profiles.filter(p => p.id !== profile.id), profile];
      if (activate || (!data.activeId && activate !== false)) data.activeId = profile.id;
      await atomicJson(this.path, data);
      return this.safe(profile);
    });
  }
  activate(id) {
    return this.#mutate(async () => {
      const data = await this.store();
      invariant(data.profiles.some(p => p.id === id), 'profile_missing', 'Provider profile not found.', 404);
      data.activeId = id; await atomicJson(this.path, data);
    });
  }
  remove(id) {
    return this.#mutate(async () => {
      const data = await this.store();
      invariant(data.profiles.some(p => p.id === id), 'profile_missing', 'Provider profile not found.', 404);
      data.profiles = data.profiles.filter(p => p.id !== id);
      if (data.activeId === id) data.activeId = null;
      await atomicJson(this.path, data);
    });
  }
  async active() {
    const data = await this.store();
    const profile = data.profiles.find(p => p.id === data.activeId);
    invariant(profile, 'provider_unconfigured', 'Configure and activate an LLM provider in CS-Switch.', 503);
    return this.resolve(profile);
  }
}
