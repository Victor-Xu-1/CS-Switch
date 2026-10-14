import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

// Non-import relationships: HTTP routes, rendered assets, and shared lifecycle
// locks. Keep these explicit; imported dependencies are followed automatically.
const contracts = [
  [/^web\//, ['workbench', 'quality']],
  [/^web\/application\.js$/, ['application']],
  [/^src\/(server\.mjs|gateway\/(admin|reverse-proxy)\.mjs)$/, ['gateway', 'connection', 'application', 'readiness']],
  [/^src\/gateway\/connection\.mjs$/, ['application', 'update']],
  [/^src\/protocol\/pdf-worker\.mjs$/, ['task-input']],
  [/^scripts\/(bump-version|check-version)\.mjs$|^package(?:-lock)?\.json$/, ['version']],
  [/^scripts\/test-scope\.mjs$|^\.github\/workflows\//, ['test-scope']],
];

export function selectTests(changed, graph, tests) {
  const affected = new Set(changed), selected = new Set();
  for (const path of changed) for (const [pattern, names] of contracts) {
    if (pattern.test(path)) for (const name of names) selected.add(`tests/${name}.test.mjs`);
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const [path, dependencies] of graph) if (!affected.has(path) && dependencies.some(dependency => affected.has(dependency))) {
      affected.add(path); progress = true;
    }
  }
  for (const path of tests) if (affected.has(path)) selected.add(path);
  return [...selected].filter(path => tests.includes(path)).sort();
}

function run() {
  const base = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(base || '')) throw Error('Usage: test-scope.mjs BASE_COMMIT_SHA [--list]. An explicit comparison base is required.');
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  // Includes staged/unstaged changes for local use; CI has a clean checkout.
  const changed = [...new Set([...git(['diff', '--name-only', base, '--']).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n')])].filter(Boolean);
  const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n'))].filter(path => /^(src|web|scripts|tests)\/.*\.m?js$/.test(path) && existsSync(path));
  const graph = new Map(files.map(path => {
    const tree = parse(readFileSync(path, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const dependencies = tree.body.filter(node => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source).map(node => {
      const source = node.source.value;
      return source.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path), source)) : `npm:${source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0]}`;
    });
    return [path, dependencies];
  }));
  if (changed.includes('package.json')) {
    const previous = JSON.parse(git(['show', `${base}:package.json`]));
    const current = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const group of ['dependencies', 'devDependencies']) for (const name of new Set([...Object.keys(previous[group] || {}), ...Object.keys(current[group] || {})])) {
      if (previous[group]?.[name] !== current[group]?.[name]) changed.push(`npm:${name}`);
    }
  }
  const selected = selectTests(changed, graph, files.filter(path => /^tests\/.*\.test\.mjs$/.test(path)));
  console.log(JSON.stringify({ base, changed, selected }, null, 2));
  if (!process.argv.includes('--list') && selected.length) execFileSync(process.execPath, ['--test', '--test-concurrency=2', ...selected], { stdio: 'inherit' });
  else if (!selected.length) console.log('No affected automated contracts. Browser/runtime acceptance remains separate.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
