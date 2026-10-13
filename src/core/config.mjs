import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readJson, atomicJson } from './files.mjs';
import { invariant } from './errors.mjs';

export const defaultHome = () => process.env.CS_SWITCH_HOME || join(homedir(), '.local/share/cs-switch');
export const initialState = () => ({ schema: 1, active: null, previous: null, candidate: null, update: { phase: 'idle' } });

export async function loadConfig(home = defaultHome()) {
  const config = await readJson(join(home, 'config.json'));
  invariant(config.schema === 1, 'config_schema', 'Unsupported configuration schema.');
  for (const key of ['port', 'modelPort', 'appPort', 'sandboxPort']) {
    invariant(Number.isInteger(config[key]) && config[key] > 1024 && config[key] < 65536, 'invalid_port', `Invalid ${key}.`);
  }
  invariant(new Set([config.port, config.modelPort, config.appPort, config.sandboxPort]).size === 4, 'port_collision', 'Service ports must differ.');
  invariant(config.update.intervalMs >= 60000, 'invalid_interval', 'Update interval must be at least one minute.');
  return { ...config, home: resolve(home) };
}

export async function initialize(home, options = {}) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const existing = await readJson(join(home, 'config.json'), null);
  if (existing) return loadConfig(home);
  const config = {
    schema: 1, port: 8000, modelPort: 17990, appPort: 18000, sandboxPort: 8001,
    bun: process.env.BUN_BIN || join(homedir(), '.bun/bin/bun'),
    network: { proxy: null },
    update: { autoApply: true, intervalMs: 6 * 60 * 60 * 1000, channel: 'latest',
      feed: 'https://storage.googleapis.com/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59/operon-releases',
      catalogDirectory: join(resolve(home), 'inbox') },
    ...options,
  };
  await atomicJson(join(home, 'config.json'), config);
  await atomicJson(join(home, 'state.json'), initialState());
  await mkdir(config.update.catalogDirectory, { recursive: true, mode: 0o700 });
  return loadConfig(home);
}
