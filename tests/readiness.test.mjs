import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadinessCache } from '../src/runtime/readiness.mjs';

test('readiness checks are non-blocking and coalesced within the freshness window', async () => {
  let calls = 0, release, now = 100;
  const cache = new ReadinessCache(() => { calls++; return new Promise(resolve => { release = resolve; }); }, { now: () => now, ttlMs: 100 });
  assert.equal(cache.snapshot('pid-1').phase, 'checking');
  cache.snapshot('pid-1'); await Promise.resolve(); assert.equal(calls, 1);
  release({ environments: [] }); await cache.pending;
  assert.equal(cache.snapshot('pid-1').phase, 'ready'); assert.equal(calls, 1);
  now = 201; assert.equal(cache.snapshot('pid-1').phase, 'checking');
});
test('a previous process cannot overwrite a new process readiness result', async () => {
  const releases = [];
  const cache = new ReadinessCache(() => new Promise(resolve => releases.push(resolve)));
  cache.snapshot('old'); const old = cache.pending; await Promise.resolve();
  cache.snapshot('new'); const current = cache.pending; await Promise.resolve();
  releases[1]({ process: 'new' }); await current;
  releases[0]({ process: 'old' }); await old;
  assert.equal(cache.snapshot('new').value.process, 'new');
  assert.equal(cache.snapshot(null).phase, 'unavailable');
});
test('failed checks never retain stale ready evidence', async () => {
  let now = 10, failed = false;
  const cache = new ReadinessCache(async () => { if (failed) throw Error('offline'); return { ready: true }; }, { now: () => now, ttlMs: 100 });
  cache.snapshot('one'); await cache.pending; failed = true; now = 111;
  cache.snapshot('one'); await cache.pending;
  assert.equal(cache.snapshot('one').phase, 'failed'); assert.equal(cache.snapshot('one').value, null);
});
