import { publicError } from '../core/errors.mjs';

// Expensive scientific environment checks never block basic workspace controls.
// Results are scoped to a process identity; old completions cannot cross restarts.
export class ReadinessCache {
  constructor(load, { now = Date.now, ttlMs = 15000 } = {}) {
    this.load = load; this.now = now; this.ttlMs = ttlMs; this.key = null;
    this.state = { phase: 'unavailable', value: null, checkedAt: null, error: null };
  }
  snapshot(key) {
    if (key !== this.key) {
      this.key = key; this.pending = null; this.nextCheck = 0;
      this.state = { phase: key ? 'idle' : 'unavailable', value: null, checkedAt: null, error: null };
    }
    if (key && !this.pending && this.now() >= this.nextCheck) {
      this.state = { ...this.state, phase: 'checking', error: null };
      const pending = Promise.resolve().then(this.load).then(value => {
        if (this.key === key) this.state = { phase: 'ready', value, checkedAt: new Date(this.now()).toISOString(), error: null };
      }).catch(error => {
        if (this.key === key) this.state = { phase: 'failed', value: null, checkedAt: new Date(this.now()).toISOString(), error: publicError(error) };
      }).finally(() => {
        if (this.pending === pending) { this.pending = null; this.nextCheck = this.now() + this.ttlMs; }
      });
      this.pending = pending;
    }
    return { ...this.state };
  }
}
