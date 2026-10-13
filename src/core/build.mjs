import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function buildIdentity() {
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const options = { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 };
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], options).toString().trim();
    const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).toString().trim());
    return { version, revision, dirty };
  } catch { return { version, revision: null, dirty: null }; }
}
