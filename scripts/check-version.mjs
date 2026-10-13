import { execFileSync } from 'node:child_process';
import { readJson } from '../src/core/files.mjs';
import { invariant } from '../src/core/errors.mjs';
import { nextVersion } from '../src/core/version.mjs';

const pkg = await readJson(new URL('../package.json', import.meta.url));
const lock = await readJson(new URL('../package-lock.json', import.meta.url));
nextVersion(pkg.version); // Validate the current version without changing it.
invariant(pkg.version === lock.version && pkg.version === lock.packages[''].version,
  'version_mismatch', 'package.json and package-lock.json versions must match.');
const baseIndex = process.argv.indexOf('--base');
if (baseIndex >= 0) {
  const base = process.argv[baseIndex + 1];
  invariant(/^[a-f0-9]{40}$/.test(base || ''), 'invalid_base', 'Use the exact 40-character base commit SHA.');
  const exists = execFileSync('git', ['ls-tree', '--name-only', base, 'package.json']).toString().trim();
  const previous = exists ? JSON.parse(execFileSync('git', ['show', `${base}:package.json`]).toString()).version : '0.0.0';
  invariant(pkg.version === nextVersion(previous), 'version_sequence', `This PR must be v${nextVersion(previous)} (base: v${previous}). One increment per PR; never skip or reuse a number.`);
}
console.log(`Version verified: v${pkg.version}`);
