import { $, t, date, element, api, notice, errorKey } from './ui.js';

export function renderSettings(status) {
  const envs = status?.environments?.environments || [];
  const checks = [
    [t('workspace'), status?.runtime ? 'ready' : 'unavailable'],
    [t('sandbox'), status?.runtime?.sandbox ? 'ready' : 'unavailable'],
    ...['python', 'r'].map(name => [name === 'r' ? 'R' : 'Python', envs.find(e => e.name === name)?.status || 'unavailable']),
    [t('mcp'), status?.environments?.mcp?.status || 'unavailable'],
  ];
  const ready = checks.every(([, state]) => state === 'ready');
  const stopped = !status?.runtime && status?.state?.runtimeDesired === 'stopped';
  $('readiness-summary').textContent = t(!status ? 'envChecking' : stopped ? 'standby' : ready ? 'envReady' : 'envAttention');
  $('readiness-help').textContent = t(stopped ? 'startHint' : ready ? 'readinessHelp' : 'readinessIssue');
  $('readiness-items').replaceChildren(...checks.map(([label, state]) => {
    if (!status) state = 'preparing';
    const known = stopped ? 'standby' : ['ready', 'failed', 'unavailable'].includes(state) ? state : 'preparing';
    return element('span', `${state === 'ready' ? '✓' : '○'} ${label} · ${t(known)}`, `check ${known}`);
  }));
  if (!status) return;
  $('runtime-version').textContent = status.runtime?.version || t('unavailable');
  $('bridge-version').textContent = `CS-Switch v${status.bridgeVersion}`;
  $('update-policy').textContent = t(status.policy.autoApply ? 'autoPolicy' : 'manualPolicy', { hours: status.policy.intervalMs / 3600000 });
  $('last-check').textContent = status.discovery?.checkedAt ? date(status.discovery.checkedAt) : t('neverChecked');
  let phase = status.discovery?.phase || status.state.update.phase;
  if (status.runtime && ['application_stopped', 'awaiting_setup'].includes(phase)) phase = 'ready';
  const translated = t(`phase.${phase}`);
  $('update-state').textContent = translated.startsWith('phase.') ? t('phase.checking') : translated;
  $('update-detail').textContent = status.discovery?.error?.message || status.state.update.detail?.message || '';
  $('environment-detail').replaceChildren(...envs.map(env => element('p', `${env.name}: ${t(env.status === 'ready' ? 'ready' : env.status === 'failed' ? 'failed' : 'preparing')}${env.error ? ` — ${env.error}` : ''}`)));
  const mcp = status.environments?.mcp;
  $('environment-detail').append(element('p', `MCP: ${mcp ? `${mcp.ready}/${mcp.total}` : t('unavailable')}`));
  $('rollback').disabled = !status.state.previous || Boolean(status.runtime?.activeFrames || status.inFlight);
}

export function bindSettings(refresh) {
  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;
    try { await refresh(); notice(null); } catch (error) { notice(errorKey(error), true); }
    finally { $('refresh').disabled = false; }
  });
  $('check-update').addEventListener('click', async () => {
    $('check-update').disabled = true;
    $('check-update').textContent = t('checkingUpdate');
    try {
      const result = await api('check', {});
      await refresh();
      notice(result.error ? 'errorUpdate' : 'updateChecked', Boolean(result.error));
    } catch (error) { notice(errorKey(error), true); }
    finally { $('check-update').disabled = false; $('check-update').textContent = t('checkUpdate'); }
  });
  $('rollback').addEventListener('click', () => $('rollback-dialog').showModal());
  $('cancel-rollback').addEventListener('click', () => $('rollback-dialog').close());
  $('confirm-rollback').addEventListener('click', async () => {
    $('confirm-rollback').disabled = true;
    try { await api('rollback', {}); $('rollback-dialog').close(); await refresh(); notice('restored'); }
    catch (error) { notice(errorKey(error), true); }
    finally { $('confirm-rollback').disabled = false; }
  });
}
