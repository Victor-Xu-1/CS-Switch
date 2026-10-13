import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTests } from '../scripts/test-scope.mjs';

test('test selection follows transitive imports without adding unrelated suites', () => {
  const graph = new Map([['src/client.mjs', ['src/changed.mjs']], ['tests/one.test.mjs', ['src/client.mjs']], ['tests/two.test.mjs', ['src/unrelated.mjs']]]);
  const tests = ['tests/one.test.mjs', 'tests/two.test.mjs'];
  assert.deepEqual(selectTests(['src/changed.mjs'], graph, tests), ['tests/one.test.mjs']);
  assert.deepEqual(selectTests(['README.md'], graph, tests), []);
  assert.deepEqual(selectTests(['tests/two.test.mjs'], graph, tests), ['tests/two.test.mjs']);
});

test('rendered assets and lifecycle locks explicitly select their direct contracts', () => {
  const tests = ['tests/quality.test.mjs', 'tests/workbench.test.mjs', 'tests/application.test.mjs', 'tests/update.test.mjs'];
  assert.deepEqual(selectTests(['web/style.css'], new Map(), tests), tests.slice(0, 2));
  assert.deepEqual(selectTests(['src/gateway/connection.mjs'], new Map(), tests), tests.slice(2));
});
