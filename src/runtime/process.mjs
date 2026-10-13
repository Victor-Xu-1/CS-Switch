import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { open, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { invariant, BridgeError } from '../core/errors.mjs';
import { networkEnvironment } from '../core/network.mjs';

export class RuntimeProcess {
  constructor(config, token) { this.config = config; this.token = token; this.child = null; this.release = null; this.dataPath = null; }
  async start(release, dataPath, options = {}) {
    invariant(!this.child, 'runtime_running', 'Runtime is already running.', 409);
    const config = this.config;
    invariant(Buffer.byteLength(`${dataPath}/sbx-bind-src/sock-9999999-ffffffff/socks.sock`) < 108, 'data_path_too_long', 'Use a shorter CS_SWITCH_HOME; upstream Unix socket paths must fit within 108 bytes.');
    const port = options.port || config.appPort;
    const sandboxPort = options.sandboxPort || config.sandboxPort;
    await mkdir(join(config.home, 'logs'), { recursive: true, mode: 0o700 });
    await mkdir(dataPath, { recursive: true, mode: 0o700 });
    const configPath = join(dataPath, 'bridge-runtime.toml');
    await writeFile(configPath, `host = "127.0.0.1"\nport = ${port}\nrequire_token = false\ndisable_telemetry = true\n[update]\nauto_update = false\n`, { mode: 0o600 });
    const logPath = join(config.home, 'logs', `runtime-${Date.now()}.log`);
    const log = await open(logPath, 'a', 0o600);
    const child = spawn(config.bun, [join(release.path, 'app_bundle_raw/claude-science.bundle.js'), 'serve',
      '--config', configPath, '--data-dir', dataPath, '--assets-root', join(release.path, 'assets'),
      '--host', '127.0.0.1', '--port', String(port), '--sandbox-port', String(sandboxPort), '--no-browser', '--no-auto-update',
      '--allow-origin', `http://127.0.0.1:${config.port}`, '--allow-origin', `http://localhost:${config.port}`], {
      cwd: release.path, detached: true, stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, ...networkEnvironment(config), OPERON_LOCAL_PROVIDER_MODE: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.modelPort}`,
        ANTHROPIC_API_KEY: this.token, OPERON_DISABLE_TELEMETRY: '1', OPERON_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    });
    this.child = child; this.release = release; this.dataPath = dataPath; this.port = port; this.logPath = logPath;
    child.once('error', error => { this.spawnError = error; });
    await log.close();
    try {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (this.spawnError || child.exitCode !== null || child.signalCode !== null) throw new BridgeError('runtime_boot_failed', `Runtime exited during startup. Log: ${logPath}`, 503);
        try {
          const status = await this.status();
          invariant(status.pid === child.pid, 'runtime_port_owned', 'The app port belongs to another process.', 409);
          invariant(status.version === release.version && status.boot === 'serving', 'runtime_identity', 'Runtime identity or readiness mismatch.', 503);
          invariant(status.sandbox_active === true, 'sandbox_required', 'Runtime sandbox must be active.', 503);
          return status;
        } catch (error) { if (error instanceof BridgeError) throw error; }
        await delay(250);
      }
      throw new BridgeError('runtime_boot_timeout', `Runtime did not become ready. Log: ${logPath}`, 503);
    } catch (error) { await this.stop(); throw error; }
  }
  async status() {
    const response = await fetch(`http://127.0.0.1:${this.port}/daemon/status`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Runtime health unavailable');
    const status = await response.json();
    invariant(!this.child || status.pid === this.child.pid, 'runtime_identity', 'The runtime port belongs to another process.', 409);
    return status;
  }
  async idle() {
    const status = await this.status();
    return status.pid === this.child?.pid && status.active_frames === 0 && status.active_conversations === 0;
  }
  async smoke({ requireEnvironments = false } = {}) {
    const status = await this.status();
    invariant(status.version === this.release.version && status.sandbox_active === true, 'runtime_contract', 'Candidate health/sandbox contract failed.', 503);
    const response = await fetch(`http://127.0.0.1:${this.port}/`, { signal: AbortSignal.timeout(5000) });
    const html = await response.text();
    invariant(response.ok && /<html[\s>]/i.test(html), 'runtime_contract', 'Candidate web page did not load.', 503);
    const modules = [...html.matchAll(/(?:src|href)=["'](\.?\/?assets\/[^"']+\.(?:js|css))["']/g)].map(m => m[1]);
    invariant(modules.length > 0, 'runtime_contract', 'Candidate web assets missing.', 503);
    for (const path of modules) {
      const asset = await fetch(new URL(path, `http://127.0.0.1:${this.port}/`), { signal: AbortSignal.timeout(5000) });
      invariant(asset.ok, 'runtime_contract', 'Candidate frontend references unavailable assets.', 503);
      await asset.body.cancel();
    }
    const agentsResponse = await fetch(`http://127.0.0.1:${this.port}/api/agents`, { signal: AbortSignal.timeout(5000) });
    const agents = await agentsResponse.json();
    invariant(agentsResponse.ok && Array.isArray(agents) && agents.some(a => a.name === 'OPERON'), 'runtime_contract', 'Scientific agent registry did not load.', 503);
    const capabilities = requireEnvironments ? await this.waitForEnvironments() : null;
    return { version: status.version, sandbox: true, webAssets: modules.length, agents: agents.length, ...(capabilities ? { capabilities } : {}) };
  }
  async environments() {
    const response = await fetch(`http://127.0.0.1:${this.port}/api/environments/status`, { signal: AbortSignal.timeout(5000) });
    invariant(response.ok, 'environment_status', 'Could not read environment readiness.', 503);
    const data = await response.json();
    let mcp = { status: 'unavailable', ready: 0, total: 0 };
    try {
      const readiness = await fetch(`http://127.0.0.1:${this.port}/api/environments/mcp-readiness`, { signal: AbortSignal.timeout(15000) });
      if (readiness.ok) {
        const result = await readiness.json();
        if (Array.isArray(result.servers) && result.servers.length) {
          const ready = result.servers.filter(server => server.ready).length;
          mcp = { ready, total: result.servers.length, status: ready === result.servers.length ? 'ready' : result.servers.some(server => server.failed) ? 'failed' : 'preparing' };
        }
      }
    } catch { /* A failed MCP read must not be shown as ready. */ }
    return { disabledReason: data.conda_disabled_reason, mcp, environments: data.environments.map(e => ({ name: e.env_name, status: e.status, packages: e.package_count, error: e.error?.split('\n')[0] || null })) };
  }
  async waitForEnvironments() {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const state = await this.environments();
      invariant(!state.disabledReason && !state.environments.some(e => e.status === 'failed'), 'environment_failed', 'Candidate scientific environment failed; the previous runtime will be restored.', 503);
      if (['python', 'r'].every(name => state.environments.some(e => e.name === name && e.status === 'ready'))) {
        if (state.mcp.status === 'ready') return { python: true, r: true, mcpReady: state.mcp.total };
      }
      await delay(1000);
    }
    throw new BridgeError('environment_timeout', 'Candidate scientific environments were not ready within the validation window.', 503);
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    const exited = once(child, 'exit').catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      const stopped = await Promise.race([exited.then(() => true), delay(10000, undefined, { ref: false }).then(() => false)]);
      if (!stopped) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await exited;
      }
    }
    this.child = null; this.release = null; this.dataPath = null; this.spawnError = null;
  }
}
