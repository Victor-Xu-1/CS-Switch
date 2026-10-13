import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/core/config.mjs';

if (process.platform !== 'linux') throw new Error('Install from Linux/WSL.');
const config = await loadConfig(process.argv[2]);
const root = fileURLToPath(new URL('../', import.meta.url));
const unitDir = join(homedir(), '.config/systemd/user');
const unitPath = join(unitDir, 'cs-switch.service');
const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
if (/[\r\n]/.test(root) || /[\r\n]/.test(config.home)) throw new Error('Service paths cannot contain newlines.');
await mkdir(unitDir, { recursive: true });
try { await readFile(unitPath); throw new Error('Service unit already exists; inspect it before replacement.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(unitPath, `[Unit]\nDescription=CS-Switch managed scientific workspace\nAfter=network.target\nStartLimitIntervalSec=60\nStartLimitBurst=3\n\n[Service]\nType=simple\nWorkingDirectory=${root.replaceAll('%', '%%')}\nExecStart=/usr/bin/flock --exclusive --nonblock --no-fork ${quote(join(config.home, 'service.lock'))} ${quote(process.execPath)} ${quote(join(root, 'src/cli.mjs'))} serve --home ${quote(config.home)}\nRestart=on-failure\nRestartSec=5\nKillMode=control-group\nTimeoutStopSec=30\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`, { flag: 'wx', mode: 0o600 });
execFileSync('systemd-analyze', ['--user', 'verify', unitPath], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'daemon-reload']);
execFileSync('systemctl', ['--user', 'enable', '--now', 'cs-switch.service'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'is-active', '--quiet', 'cs-switch.service']);
console.log(`Installed ${unitPath}`);
