#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { defaultHome, initialize, loadConfig } from './core/config.mjs';
import { importRelease, listReleases } from './runtime/releases.mjs';
import { UpdateManager } from './update/manager.mjs';
import { readJson } from './core/files.mjs';
import { invariant, publicError } from './core/errors.mjs';
import { unpack } from './runtime/extract.mjs';
import { adaptPrepared } from './runtime/adapter.mjs';
import { stoppedDataSource } from './runtime/installations.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'help';
const option = name => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; };
const home = resolve(option('home') || defaultHome());
const print = value => console.log(JSON.stringify(value, null, 2));

try {
  if (command === 'init') print(await initialize(home));
  else if (command === 'import') {
    const source = option('runtime');
    invariant(source, 'arguments', 'Use import --runtime /path/to/prepared-runtime.');
    await loadConfig(home);
    const result = await importRelease(home, resolve(source), option('upstream-id') || null);
    print({ id: result.id, version: result.version, treeHash: result.treeHash, path: result.path });
  } else if (command === 'adopt') {
    const binary = option('binary');
    invariant(binary, 'arguments', 'Use adopt --binary /path/to/installed/operon.');
    await loadConfig(home);
    const destination = join(home, 'adopted', randomUUID());
    await unpack(resolve(binary), destination);
    await adaptPrepared(destination);
    const result = await importRelease(home, destination, option('upstream-id') || null);
    print({ id: result.id, version: result.version, path: result.path, originalBinaryPreserved: resolve(binary) });
  } else if (command === 'bootstrap') {
    const config = await loadConfig(home), releaseId = option('release'), source = option('data');
    invariant(releaseId && source, 'arguments', 'Use bootstrap --release ID --data /path/to/stopped-data.');
    invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(releaseId), 'arguments', 'Invalid release ID.');
    const manager = new UpdateManager(config, null);
    invariant(!(await manager.state()).active, 'already_initialized', 'An active data generation is already registered.', 409);
    const dataPath = join(home, 'd', randomUUID().slice(0, 8));
    await mkdir(join(home, 'd'), { recursive: true, mode: 0o700 });
    const stoppedSource = await stoppedDataSource(source, home);
    await cp(stoppedSource, dataPath, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
    await stoppedDataSource(stoppedSource, home);
    await manager.bootstrap(releaseId, dataPath);
    print({ registered: true, releaseId, dataPath, originalPreserved: resolve(source) });
  } else if (command === 'serve') {
    const config = await loadConfig(home);
    const { serve } = await import('./server.mjs');
    const service = await serve(config);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { service.close().then(() => process.exit(0)).catch(() => process.exit(1)); });
  } else if (command === 'status') {
    print({ config: await loadConfig(home), state: await readJson(join(home, 'state.json')), releases: await listReleases(home), discovery: await readJson(join(home, 'discovery.json'), null) });
  } else if (['check', 'rollback', 'apply'].includes(command)) {
    const config = await loadConfig(home);
    const response = await fetch(`http://127.0.0.1:${config.port}/_bridge/api/${command}`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${config.port}`, 'x-cs-switch': '1' },
      body: JSON.stringify(command === 'apply' ? { id: option('release') } : {}) });
    print(await response.json()); if (!response.ok) process.exitCode = 1;
  } else {
    console.log(`CS-Switch\n\n  init [--home PATH]\n  adopt --binary PATH [--upstream-id SHA8]\n  import --runtime PATH [--upstream-id SHA8]\n  bootstrap --release ID --data STOPPED_DATA_PATH\n  serve\n  status\n  check\n  apply --release ID\n  rollback\n\nAll commands accept --home PATH. Use scripts/install-service.mjs for a persistent user service.\nOfficial updates require signatures, a matching semantic adapter and runtime validation. Unknown layouts fail closed.`);
    if (command !== 'help' && command !== '--help') process.exitCode = 2;
  }
} catch (error) { print({ error: publicError(error), detail: error.code || error.name }); process.exitCode = 1; }
