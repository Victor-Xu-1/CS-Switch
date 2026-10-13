import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from '../src/core/version.mjs';

test('one PR advances the smallest version field, carrying at 99', () => {
  assert.equal(nextVersion('0.0.0'), '0.0.1');
  assert.equal(nextVersion('0.0.1'), '0.0.2');
  assert.equal(nextVersion('0.0.99'), '0.1.0');
  assert.equal(nextVersion('0.99.99'), '1.0.0');
});
test('invalid or inconsistent version formats are rejected', () => {
  for (const value of ['v0.0.1', '0.100.0', '0.0.100', '00.0.1', '0.0', '-1.0.1', '0.0.1-beta']) assert.throws(() => nextVersion(value));
});
