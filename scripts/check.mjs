import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
let count = 0;
async function walk(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.m?js$/.test(entry.name)) { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); count++; }
  }
}
for (const root of ['src', 'web', 'scripts']) await walk(root);
console.log(`Syntax checked ${count} first-party source files (syntax only, not a global test run).`);
