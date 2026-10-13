import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { invariant } from '../core/errors.mjs';

// Exercise the same transport as scientific requests before activating a draft.
class ProbeResponse extends Writable {
  chunks = [];
  bytes = 0;
  headersSent = false;
  setHeader() {}
  writeHead(status) { this.statusCode = status; this.headersSent = true; }
  _write(chunk, encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > 1024 * 1024) return callback(new Error('Probe response too large.'));
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  message() { return JSON.parse(Buffer.concat(this.chunks).toString('utf8')); }
}

export class Connection {
  busy = false;
  constructor(profiles, model, manager) { Object.assign(this, { profiles, model, manager }); }
  async idle() {
    invariant(!this.manager.busy && !this.manager.maintenance && this.model.active === 0,
      'runtime_busy', 'Wait for the current task or update to finish before changing models.', 409);
    invariant(await this.manager.runtime.idle(), 'runtime_busy', 'Wait for the current task to finish before changing models.', 409);
  }
  async connect(input, { signal } = {}) {
    signal?.throwIfAborted();
    invariant(!this.busy, 'connection_busy', 'A connection test is already running.', 409);
    this.busy = true;
    const output = new ProbeResponse();
    // A malformed/oversized native response can emit an error before dispatch returns.
    output.on('error', () => {});
    try {
      await this.idle();
      const draft = await this.profiles.draft(input);
      const profile = await this.profiles.resolve(draft);
      signal?.throwIfAborted();
      await this.model.dispatch({ model: 'connection-test', max_tokens: 64,
        thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Reply with OK.' }], stream: false },
      { headers: {} }, output, profile, signal);
      await finished(output);
      signal?.throwIfAborted();
      const result = output.message();
      invariant(result.type === 'message' && result.stop_reason === 'end_turn' &&
        Array.isArray(result.content) && result.content.some(block => block.type === 'text' && block.text?.trim()),
      'connection_invalid', 'The provider did not return a complete text response.', 502);
      // Reserve synchronously before the awaited final idle check. Application
      // start/stop and update operations use this same lock.
      invariant(!this.manager.busy && !this.manager.maintenance && this.model.active === 0,
        'runtime_busy', 'An application operation began during the test. Retry after it completes.', 409);
      this.manager.busy = true;
      this.manager.maintenance = true;
      try {
        invariant(await this.manager.runtime.idle(), 'runtime_busy', 'A task started during the test. Retry after it completes.', 409);
        signal?.throwIfAborted();
        return await this.profiles.commitDraft(() => draft, true, { at: new Date().toISOString(), model: profile.model });
      } finally { this.manager.maintenance = false; this.manager.busy = false; }
    } finally { output.destroy(); this.busy = false; }
  }
}
