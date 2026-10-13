import { join } from 'node:path';
import { readJson, atomicJson } from '../core/files.mjs';
import { invariant, publicError } from '../core/errors.mjs';
import { importRelease, listReleases } from '../runtime/releases.mjs';
import { downloadOfficial } from './download.mjs';
import { unpack } from '../runtime/extract.mjs';
import { adaptPrepared } from '../runtime/adapter.mjs';

export class Discovery {
  checking = false;
  constructor(config, manager, options = {}) { this.config = config; this.manager = manager; this.fetch = options.fetch || fetch; }
  async check({ apply = this.config.update.autoApply } = {}) {
    invariant(!this.checking, 'check_busy', 'An update check is in progress.', 409);
    this.checking = true;
    const result = { checkedAt: new Date().toISOString(), phase: 'checking', available: null, applied: false };
    try {
      const savedState = await this.manager.state();
      if (!savedState.active || savedState.runtimeDesired === 'stopped' || this.manager.maintenance) {
        result.phase = savedState.active ? 'application_stopped' : 'awaiting_setup';
        return result;
      }
      const config = this.config.update;
      const feed = new URL(config.feed);
      invariant(feed.protocol === 'https:', 'invalid_feed', 'Official release discovery requires HTTPS.');
      invariant(['latest', 'stable'].includes(config.channel), 'invalid_channel', 'Invalid upstream channel.');
      const response = await this.fetch(`${feed.href.replace(/\/$/, '')}/${config.channel}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      invariant(response.ok, 'update_network', `Release discovery returned HTTP ${response.status}.`, 502);
      invariant(Number(response.headers.get('content-length') || 0) < 1024, 'invalid_feed', 'Release pointer is too large.');
      const id = (await response.text()).trim();
      invariant(/^[a-f0-9]{8}$/.test(id), 'invalid_feed', 'Upstream release pointer changed format. Adapter review required.');
      result.available = id;
      const state = await this.manager.state();
      const releases = await listReleases(this.config.home);
      const active = releases.find(r => r.id === state.active?.releaseId);
      if (active?.upstreamId === id) result.phase = 'current';
      else {
        let candidate = releases.find(r => r.upstreamId === id);
        if (!candidate) {
          const descriptor = await readJson(join(config.catalogDirectory, `${id}.json`), null);
          if (descriptor) {
            invariant(descriptor.schema === 1 && descriptor.upstreamId === id && /^[a-f0-9]{64}$/.test(descriptor.treeHash), 'invalid_catalog', 'Prepared runtime descriptor is invalid.');
            candidate = await importRelease(this.config.home, descriptor.sourcePath, id, descriptor.treeHash);
          } else {
            const currentManifest = active ? await readJson(join(this.config.home, 'releases', active.id, 'release.json')) : null;
            const downloaded = await downloadOfficial(this.config, id, this.fetch, Date.parse(currentManifest?.builtAt || '1970-01-01T00:00:00Z'));
            const prepared = await unpack(downloaded.binary, join(downloaded.directory, 'prepared'));
            await adaptPrepared(prepared.root);
            candidate = await importRelease(this.config.home, prepared.root, id);
          }
        }
        result.releaseId = candidate.id;
        result.phase = 'available';
        if (apply) {
          await this.manager.apply(candidate.id);
          result.applied = true; result.phase = 'applied';
        }
      }
    } catch (error) {
      result.phase = error.code === 'runtime_busy' ? 'deferred' : error.code === 'adapter_required' ? 'adapter_required' : 'blocked';
      result.error = publicError(error);
      if (error?.name === 'TypeError') result.error = { code: 'update_network', message: 'Cannot reach the official release feed. Current version is retained.' };
    } finally {
      this.checking = false;
      await atomicJson(join(this.config.home, 'discovery.json'), result);
    }
    return result;
  }
  start() {
    this.timer = setInterval(() => { this.check().catch(error => console.error(JSON.stringify({ code: 'update_check_failed', type: error.name }))); }, this.config.update.intervalMs);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }
}
