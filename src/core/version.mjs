import { invariant } from './errors.mjs';

export function nextVersion(version) {
  invariant(/^(0|[1-9]\d*)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/.test(version), 'invalid_version', 'Expected N.0-99.0-99 without leading zeroes.');
  let [major, minor, patch] = version.split('.').map(Number);
  invariant(Number.isSafeInteger(major), 'invalid_version', 'Version number is too large.');
  patch++;
  if (patch > 99) { patch = 0; minor++; }
  if (minor > 99) { minor = 0; major++; }
  return `${major}.${minor}.${patch}`;
}
