import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';
import { t as listTar, x as extractTar } from 'tar';
import { invariant } from '../core/errors.mjs';
import { inside, atomicJson } from '../core/files.mjs';

// Reads Bun's serialized module graph, not machine code. Format reference:
// https://github.com/can1357/unbun (MIT), Bun StandaloneModuleGraph.
export function readModules(bytes) {
  const trailer = bytes.lastIndexOf(Buffer.from('\n---- Bun! ----\n'));
  invariant(trailer > 32, 'binary_layout', 'Unsupported Bun executable: graph trailer missing.');
  const offsets = trailer - 32, count = Number(bytes.readBigUInt64LE(offsets));
  invariant(Number.isSafeInteger(count) && count > 0 && count <= offsets, 'binary_layout', 'Invalid Bun module graph size.');
  const graph = bytes.subarray(offsets - count, offsets);
  const tableStart = bytes.readUInt32LE(offsets + 8), tableSize = bytes.readUInt32LE(offsets + 12);
  const entry = bytes.readUInt32LE(offsets + 16);
  invariant(tableStart + tableSize <= graph.length && tableSize > 0, 'binary_layout', 'Bun module table out of range.');
  const recordSize = [52, 36].find(size => tableSize % size === 0);
  invariant(recordSize && entry < tableSize / recordSize, 'binary_layout', 'Unsupported Bun module record format.');
  const slice = (offset, length) => { invariant(offset + length <= graph.length, 'binary_layout', 'Bun module points outside graph.'); return graph.subarray(offset, offset + length); };
  const modules = [];
  for (let i = 0; i < tableSize / recordSize; i++) {
    const row = tableStart + i * recordSize;
    const name = slice(graph.readUInt32LE(row), graph.readUInt32LE(row + 4)).toString('utf8').replace(/\0$/, '');
    const content = slice(graph.readUInt32LE(row + 8), graph.readUInt32LE(row + 12));
    const encoding = graph[row + recordSize - 4];
    const bytecodeSize = graph.readUInt32LE(row + 28);
    invariant(!bytecodeSize, 'bytecode_unsupported', 'This release embeds bytecode. It needs a reviewed loader adapter.');
    modules.push({ name, content: encoding && content.at(-1) === 0 ? content.subarray(0, -1) : content, entry: i === entry });
  }
  return modules;
}

export async function unpack(binary, destination) {
  const modules = readModules(await readFile(binary));
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const raw = join(destination, 'app_bundle_raw');
  await mkdir(raw, { recursive: true });
  let archive = null, entry = null;
  for (const module of modules) {
    invariant(module.name.startsWith('/$bunfs/root/'), 'binary_layout', 'Unsupported embedded module root.');
    const relative = module.name.slice('/$bunfs/root/'.length);
    invariant(relative && !relative.split('/').includes('..') && !relative.includes('\\'), 'binary_path', 'Invalid embedded module name.');
    const name = module.entry ? 'claude-science.bundle.js' : relative;
    const target = inside(raw, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, module.content, { flag: 'wx', mode: 0o600 });
    if (module.entry) entry = target;
    if (/^assets\.tar[^/]*\.gz$/.test(relative)) { invariant(!archive, 'binary_layout', 'Multiple assets archives require review.'); archive = target; }
    if (/(?:Worker|Watchdog)(?:Entry)?\.js$/.test(name)) await copyFile(target, target.replace(/\.js$/, '.ts'));
  }
  invariant(entry && archive, 'binary_layout', 'Missing runtime entry or assets archive.');
  let expanded = 0, entries = 0;
  const archivePaths = [], links = new Set();
  const safe = path => !posix.isAbsolute(path) && !path.split('/').includes('..') && !path.includes('\\');
  await listTar({ file: archive, strict: true, onReadEntry(item) {
    invariant(safe(item.path) && ['File', 'Directory', 'SymbolicLink'].includes(item.type), 'archive_path', 'Unsupported or unsafe asset archive entry.');
    const normalized = posix.normalize(item.path).replace(/^\.\//, '');
    archivePaths.push(normalized);
    if (item.type === 'SymbolicLink') {
      invariant(!posix.isAbsolute(item.linkpath) && !item.linkpath.includes('\\'), 'archive_path', 'Unsafe asset symlink.');
      const target = posix.normalize(posix.join(posix.dirname(normalized), item.linkpath));
      invariant(safe(target), 'archive_path', 'Asset symlink leaves the extraction root.');
      links.add(normalized);
    }
    expanded += item.size; entries++;
    invariant(expanded < 4 * 1024 ** 3 && entries < 100000, 'archive_size', 'Asset archive exceeds extraction limits.');
  } });
  for (const path of archivePaths) for (const link of links) invariant(!path.startsWith(`${link}/`), 'archive_path', 'Archive writes through a symlink.');
  const assets = join(destination, 'assets'); await mkdir(assets);
  await extractTar({ file: archive, cwd: assets, strict: true, preservePaths: false, noChmod: true, filter: path => safe(path) });
  await copyFile(binary, join(destination, 'operon'));
  await atomicJson(join(destination, 'extraction.json'), { modules: modules.map(m => ({ name: m.name, bytes: m.content.length, entry: m.entry })), entries, expanded });
  return { root: destination, entry, assets };
}
