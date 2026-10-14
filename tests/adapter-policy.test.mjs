import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptBackend } from '../src/runtime/adapter.mjs';

// First-party semantic fixture, not redistributed upstream source.
const fixture = `
function gate(key, token) { if (!key && !token) throw Error('This build requires signing in with your Claude account. API keys are not supported.'); }
class Resolver { resolve() { throw Error('No credentials available for Anthropic API. Please sign in with your Claude account.'); } }
function entry(config) { if (!config.require_token) throw Error('disabling login auth (require_token = false) is not available in this build'); }
router.get('/api/auth/status', () => { return { authenticated: false }; });
function account(path) { if (!path) throw Error('caFetch: path must start with slash'); }
function processIdentity(value) { return new RegExp('(operon|claude-bioscience|claude-science)').test(value); }
function renamedPolicy(callback, options = {}) {
  const keys = options.flagKeys, request = options.caFetch, interval = options.pollIntervalMs;
  return { stop() {}, refreshNow: async () => null, whenReady: async () => {}, rearmHold() {}, forgetKeptUseCases() {} };
}
`;
test('semantic policy boundary works when the upstream exported alias disappears', () => {
  const result = adaptBackend(fixture);
  assert.equal(result.changes.length, 7);
  assert.match(result.output, /forgetKeptUseCases:\(\)=>\{\}/);
});
test('ambiguous or incomplete policy shapes still fail before patching', () => {
  assert.throws(() => adaptBackend(fixture + fixture.slice(fixture.indexOf('function renamedPolicy')).replace('renamedPolicy', 'duplicatePolicy')), { code: 'adapter_required' });
  assert.throws(() => adaptBackend(fixture.replace('options.caFetch', 'options.unrelated')), { code: 'adapter_required' });
});
