import { join } from 'node:path';
import { readJson } from '../src/core/files.mjs';
import { RuntimeProcess } from '../src/runtime/process.mjs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

const [root, home, portText = '19800'] = process.argv.slice(2);
if (!root || !home) throw new Error('Usage: verify-runtime.mjs PREPARED_RUNTIME ISOLATED_STATE [PORT]');
const port = Number(portText), build = await readJson(join(root, 'assets/BUILD.json'));
const config = { home, bun: process.env.BUN_BIN || join(homedir(), '.bun/bin/bun'), port, appPort: port, sandboxPort: port + 1, modelPort: port + 2, network: { proxy: process.env.HTTPS_PROXY || null } };
const runtime = new RuntimeProcess(config, randomBytes(32).toString('hex'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => runtime.stop().finally(() => process.exit(0)));
try {
  await runtime.start({ path: root, version: build.version }, join(home, 'data'));
  console.log(JSON.stringify({ ready: true, ...await runtime.smoke(), environments: await runtime.environments(), port }));
} catch (error) { console.error(error); await runtime.stop(); process.exitCode = 1; }
