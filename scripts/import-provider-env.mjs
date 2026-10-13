import { readFile } from 'node:fs/promises';
import { Profiles } from '../src/gateway/profiles.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { network } from '../src/core/network.mjs';

// Explicit migration of a known application credential. Never executes a shell
// file, enumerates other secret stores, or prints the key.
const [home, file, variable, provider, requestedModel] = process.argv.slice(2);
if (!home || !file || !requestedModel || !/^[A-Z_][A-Z0-9_]*$/.test(variable || '')) throw Error('Usage: import-provider-env.mjs STATE_HOME KNOWN_ENV_FILE VARIABLE deepseek MODEL');
if (provider !== 'deepseek') throw Error('This migration command currently supports the explicit DeepSeek endpoint only.');
const text = await readFile(file, 'utf8');
const line = text.split(/\r?\n/).find(value => value.startsWith(`${variable}=`));
if (!line) throw Error('The selected named credential is absent. Enter it in the workbench.');
const apiKey = line.slice(variable.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
if (!apiKey || /\s/.test(apiKey)) throw Error('The selected credential is empty or invalid.');
const config = await loadConfig(home), net = network(config);
try {
  const response = await net.fetch('https://api.deepseek.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw Error(`DeepSeek credential check returned HTTP ${response.status}; no profile was saved.`);
  const models = (await response.json()).data.map(m => m.id);
  if (!models.includes(requestedModel)) throw Error(`Requested model is unavailable. Available model IDs: ${models.join(', ')}`);
  const profiles = new Profiles(home), existing = (await profiles.list()).profiles.find(p => p.provider === provider);
  const result = await profiles.save({ id: existing?.id, name: 'DeepSeek', provider, protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: requestedModel, apiKey, activate: true });
  console.log(JSON.stringify({ imported: true, provider, model: result.model, credentialValidated: true, plaintextKeyPrinted: false }));
} finally { await net.close(); }
