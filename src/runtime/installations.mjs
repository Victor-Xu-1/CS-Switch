import { readdir, stat, realpath, open, readlink } from 'node:fs/promises';
import { join, dirname, resolve, sep, parse } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readJson } from '../core/files.mjs';
import { invariant } from '../core/errors.mjs';

export async function inspectInstallation(path) {
  invariant(typeof path === 'string' && path.trim() && path.length < 4096, 'installation_path', 'Select the original Claude Science / Operon executable.');
  const binary = await realpath(resolve(path));
  const info = await stat(binary);
  invariant(info.isFile() && info.size < 1024 ** 3, 'installation_path', 'Expected an executable file smaller than 1 GiB.');
  const handle = await open(binary, 'r');
  const magic = Buffer.alloc(4);
  try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
  invariant(magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'installation_platform', 'This service runs Linux/WSL executables. A native Windows or macOS installation needs a platform adapter.');
  let build = null;
  try { build = await readJson(join(dirname(binary), 'assets/BUILD.json'), null); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  const nearbyData = join(dirname(binary), 'data');
  let dataPath = '';
  try { if ((await stat(nearbyData)).isDirectory()) dataPath = nearbyData; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { id: createHash('sha256').update(binary).digest('hex').slice(0, 16), binary,
    version: build?.version || null, dataPath, compatibility: 'not_checked' };
}

export async function discoverInstallations(userHome = homedir()) {
  const candidates = new Set([
    join(userHome, '.local/bin/operon'), join(userHome, '.local/bin/claude-science'),
    join(userHome, '.local/share/operon/operon'), '/usr/local/bin/operon', '/usr/bin/operon',
  ]);
  const apps = join(userHome, 'apps');
  try {
    const entries = await readdir(apps, { withFileTypes: true });
    for (const entry of entries.filter(item => item.isDirectory() && /^(operon|claude-science)(-|$)/i.test(item.name)).slice(0, 40)) {
      candidates.add(join(apps, entry.name, 'operon'));
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const found = new Map();
  for (const path of candidates) {
    try { const item = await inspectInstallation(path); found.set(item.binary, item); }
    catch (error) { if (!['ENOENT', 'ENOTDIR', 'installation_platform', 'installation_path'].includes(error.code)) throw error; }
  }
  return [...found.values()];
}

export async function stoppedDataSource(source, stateHome, procRoot = '/proc') {
  const path = await realpath(resolve(source));
  const home = await realpath(stateHome);
  invariant((await stat(path)).isDirectory() && path !== parse(path).root && path !== homedir() &&
    path !== home && !home.startsWith(path + sep), 'data_source', 'Choose a specific stopped application data directory, not a parent or state root.');
  // Inspect only same-user process descriptors. Never kill a discovered process.
  for (const entry of await readdir(procRoot, { withFileTypes: true })) {
    if (!/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
    const processRoot = join(procRoot, entry.name);
    let owner;
    try { owner = await stat(processRoot); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (owner.uid !== process.getuid()) continue;
    let descriptors;
    try { descriptors = await readdir(join(processRoot, 'fd')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const fd of descriptors) {
      let target;
      try { target = await readlink(join(processRoot, 'fd', fd)); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'EINVAL') continue; throw error; }
      invariant(target !== path && !target.startsWith(path + sep), 'source_running', 'The selected data directory is in use. Close that original application before importing its data.', 409);
    }
  }
  return path;
}
