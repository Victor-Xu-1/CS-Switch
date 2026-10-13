import { execFileSync } from 'node:child_process';
import { readJson } from '../src/core/files.mjs';
import { nextVersion } from '../src/core/version.mjs';

const current = (await readJson(new URL('../package.json', import.meta.url))).version;
// npm updates the single package authority and its lockfile together.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', nextVersion(current), '--no-git-tag-version', '--ignore-scripts'], { stdio: 'inherit' });
