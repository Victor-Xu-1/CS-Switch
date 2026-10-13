import { join } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJson, atomicJson } from '../core/files.mjs';
import { initialState } from '../core/config.mjs';
import { invariant, publicError } from '../core/errors.mjs';
import { verifyRelease } from '../runtime/releases.mjs';

export class UpdateManager {
  busy = false;
  maintenance = false;
  constructor(config, runtime, options = {}) {
    this.config = config; this.runtime = runtime;
    this.isGatewayIdle = options.isGatewayIdle || (() => true);
    this.quiesce = options.quiesce || (() => {});
    this.verify = options.verify || verifyRelease;
    this.statePath = join(config.home, 'state.json');
  }
  async state() { return readJson(this.statePath, initialState()); }
  async save(state) { await atomicJson(this.statePath, state); }
  async phase(state, phase, detail = null) {
    state.update = { phase, detail, at: new Date().toISOString() }; await this.save(state);
  }
  async bootstrap(releaseId, dataPath) {
    const state = await this.state();
    invariant(!state.active, 'already_initialized', 'An active runtime is already registered.', 409);
    const release = await this.verify(join(this.config.home, 'releases', releaseId));
    state.active = { releaseId: release.id, dataPath }; await this.phase(state, 'ready');
  }
  async start() {
    const state = await this.state();
    invariant(state.active, 'no_runtime', 'Import and register a prepared runtime first.', 503);
    // Recovery after an interrupted upgrade always starts the committed generation.
    const release = await this.verify(join(this.config.home, 'releases', state.active.releaseId));
    await this.runtime.start(release, state.active.dataPath);
    await this.runtime.smoke();
    if (['quiescing', 'snapshotting', 'validating', 'committing'].includes(state.update.phase)) {
      await this.phase(state, 'interrupted_update_recovered', 'Started the last committed runtime/data generation.');
    }
  }
  async apply(id) {
    invariant(!this.busy && !this.maintenance, 'update_busy', 'An update operation is already in progress.', 409);
    this.busy = true;
    let state, original, stopped = false;
    try {
      state = await this.state(); original = state.active;
      invariant(original, 'no_runtime', 'No active runtime.', 503);
      invariant(id !== original.releaseId, 'already_active', 'Release is already active.', 409);
      const candidate = await this.verify(join(this.config.home, 'releases', id));
      const previous = await this.verify(join(this.config.home, 'releases', original.releaseId));
      invariant(!candidate.builtAt || !previous.builtAt || Date.parse(candidate.builtAt) >= Date.parse(previous.builtAt),
        'downgrade_requires_rollback', 'Use rollback to restore an older runtime with its matching data snapshot.', 409);
      invariant(this.isGatewayIdle() && await this.runtime.idle(), 'runtime_busy', 'An analysis or model request is active; the update is deferred.', 409);
      this.maintenance = true;
      await this.quiesce();
      await this.phase(state, 'quiescing');
      // Recheck after blocking new ingress before stopping the process tree.
      invariant(this.isGatewayIdle() && await this.runtime.idle(), 'runtime_busy', 'Activity resumed; the update is deferred.', 409);
      await this.runtime.stop(); stopped = true;
      const dataPath = join(this.config.home, 'd', randomUUID().slice(0, 8));
      await this.phase(state, 'snapshotting');
      await mkdir(join(this.config.home, 'd'), { recursive: true, mode: 0o700 });
      await cp(original.dataPath, dataPath, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      state.candidate = { releaseId: candidate.id, dataPath };
      await this.phase(state, 'validating');
      try {
        await this.runtime.start(candidate, dataPath);
        const evidence = await this.runtime.smoke({ requireEnvironments: true });
        await this.phase(state, 'committing');
        state.previous = original; state.active = state.candidate; state.candidate = null;
        state.lastValidation = { ...evidence, at: new Date().toISOString(), releaseId: candidate.id };
        await this.phase(state, 'ready');
        return state;
      } catch (error) {
        await this.runtime.stop();
        await this.runtime.start(previous, original.dataPath);
        stopped = false;
        state.active = original;
        await this.phase(state, 'rejected', publicError(error));
        throw error;
      }
    } catch (error) {
      if (state && !stopped && state.update.phase === 'quiescing') await this.phase(state, 'deferred', publicError(error));
      if (stopped && this.runtime.child === null) {
        const previous = await this.verify(join(this.config.home, 'releases', original.releaseId));
        await this.runtime.start(previous, original.dataPath);
        state.active = original; await this.phase(state, 'rejected', publicError(error));
      }
      throw error;
    } finally { this.maintenance = false; this.busy = false; }
  }
  async rollback() {
    invariant(!this.busy && !this.maintenance, 'update_busy', 'An update operation is in progress.', 409);
    this.busy = true;
    try {
      const state = await this.state(), current = state.active, previous = state.previous;
      invariant(previous, 'no_rollback', 'No prior managed runtime/data generation.', 409);
      invariant(this.isGatewayIdle() && await this.runtime.idle(), 'runtime_busy', 'An analysis is active; rollback is deferred.', 409);
      const release = await this.verify(join(this.config.home, 'releases', previous.releaseId));
      this.maintenance = true;
      await this.quiesce();
      invariant(this.isGatewayIdle() && await this.runtime.idle(), 'runtime_busy', 'Activity resumed; rollback is deferred.', 409);
      await this.runtime.stop();
      try {
        await this.runtime.start(release, previous.dataPath); await this.runtime.smoke();
        state.active = previous; state.previous = current;
        await this.phase(state, 'rolled_back', 'The newer data generation remains retained; it was not opened by the older runtime.');
      } catch (error) {
        await this.runtime.stop();
        await this.runtime.start(await this.verify(join(this.config.home, 'releases', current.releaseId)), current.dataPath);
        throw error;
      }
      return state;
    } finally { this.maintenance = false; this.busy = false; }
  }
}
