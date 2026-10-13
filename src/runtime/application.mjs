import { join } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { invariant, publicError } from '../core/errors.mjs';
import { unpack } from './extract.mjs';
import { adaptPrepared } from './adapter.mjs';
import { importRelease, verifyRelease } from './releases.mjs';
import { inspectInstallation, stoppedDataSource } from './installations.mjs';

export class Application {
  job = { phase: 'idle', error: null };
  constructor(config, manager, options = {}) {
    this.config = config; this.manager = manager;
    this.inspect = options.inspect || inspectInstallation;
    this.unpack = options.unpack || unpack;
    this.adapt = options.adapt || adaptPrepared;
    this.importRelease = options.importRelease || importRelease;
    this.verify = options.verify || verifyRelease;
    this.source = options.source || stoppedDataSource;
  }
  lock() {
    invariant(!this.manager.busy && !this.manager.maintenance, 'update_busy', 'An application operation is already in progress.', 409);
    this.manager.busy = true;
  }
  unlock() { this.manager.busy = false; this.manager.maintenance = false; }
  async launch() {
    this.lock();
    try {
      const child = this.manager.runtime.child;
      if (child && (typeof child.exitCode === 'number' || child.signalCode)) await this.manager.runtime.stop();
      invariant(!this.manager.runtime.child, 'runtime_running', 'Claude Science is already running.', 409);
      this.job = { phase: 'starting', error: null };
      await this.manager.start();
      const state = await this.manager.state();
      state.runtimeDesired = 'running'; await this.manager.save(state);
      this.job = { phase: 'ready', error: null };
    } catch (error) {
      if (error.code !== 'runtime_running') await this.manager.runtime.stop();
      this.job = { phase: 'failed', error: publicError(error) }; throw error;
    }
    finally { this.unlock(); }
    return this.job;
  }
  async stop() {
    this.lock();
    try {
      invariant(this.manager.runtime.child, 'runtime_stopped', 'Claude Science is already stopped.', 409);
      invariant(this.manager.isGatewayIdle() && await this.manager.runtime.idle(), 'runtime_busy', 'Finish the current task before stopping Claude Science.', 409);
      this.manager.maintenance = true; await this.manager.quiesce();
      invariant(this.manager.isGatewayIdle() && await this.manager.runtime.idle(), 'runtime_busy', 'A task is active; the application was not stopped.', 409);
      await this.manager.runtime.stop();
      const state = await this.manager.state();
      state.runtimeDesired = 'stopped'; await this.manager.save(state);
      this.job = { phase: 'stopped', error: null };
    } finally { this.unlock(); }
    return this.job;
  }
  async attach(input) {
    this.lock();
    try {
      const state = await this.manager.state();
      invariant(!state.active, 'already_initialized', 'A managed application is already attached. Use updates or rollback to preserve its data lineage.', 409);
      invariant(typeof input.binary === 'string', 'installation_path', 'Select an installed executable.');
      this.job = { phase: 'checking', error: null };
      // Long preparation runs in the service; the workbench polls its real state.
      void this.prepare(input).catch(error => { this.job = { phase: 'failed', error: publicError(error) }; }).finally(() => this.unlock());
      return this.job;
    } catch (error) { this.unlock(); throw error; }
  }
  async prepare(input) {
    const installed = await this.inspect(input.binary);
    const source = input.dataPath ? await this.source(input.dataPath, this.config.home) : null;
    const destination = join(this.config.home, 'adopted', randomUUID());
    this.job = { phase: 'preparing', error: null };
    await this.unpack(installed.binary, destination);
    await this.adapt(destination);
    const release = await this.importRelease(this.config.home, destination);
    const dataPath = join(this.config.home, 'd', randomUUID().slice(0, 8));
    await mkdir(join(this.config.home, 'd'), { recursive: true, mode: 0o700 });
    this.job = { phase: 'copying', error: null };
    if (source) {
      await this.source(source, this.config.home);
      await cp(source, dataPath, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      await this.source(source, this.config.home);
    } else await mkdir(dataPath, { mode: 0o700 });
    this.job = { phase: 'starting', error: null };
    this.manager.maintenance = true;
    try {
      await this.manager.runtime.start(await this.verify(release.path), dataPath);
      const checks = await this.manager.runtime.smoke({ requireEnvironments: true });
      const state = await this.manager.state();
      state.active = { releaseId: release.id, dataPath };
      state.runtimeDesired = 'running';
      state.installation = { binary: installed.binary, version: release.version, sourceData: source, attachedAt: new Date().toISOString() };
      state.lastValidation = { ...checks, releaseId: release.id, at: new Date().toISOString() };
      await this.manager.phase(state, 'ready');
      this.job = { phase: 'ready', error: null };
    } catch (error) { await this.manager.runtime.stop(); throw error; }
  }
}
