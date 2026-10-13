import { $, t, element, api, notice, errorKey } from './ui.js';

let installations = [], discovered = false, discovering = false, operation = false, currentlyRunning = false;
export const isApplicationBusy = status => operation || ['checking', 'preparing', 'copying', 'starting'].includes(status?.application?.phase);

async function discover() {
  if (discovering || discovered) return;
  discovering = true;
  try {
    installations = (await api('installations')).installations;
    $('installations').replaceChildren(...installations.map(item => {
      const option = element('option', `${item.version || 'Claude Science'} · ${item.binary}`);
      option.value = item.id; return option;
    }), element('option', t('manualPath')));
    $('installations').lastElementChild.value = '';
    selectInstallation();
    discovered = true;
  } catch (error) { notice(errorKey(error), true); }
  finally { discovering = false; }
}
function selectInstallation() {
  const selected = installations.find(item => item.id === $('installations').value);
  $('binary-path').value = selected?.binary || '';
  $('data-path').value = selected?.dataPath || '';
}
export function renderApplication(status, verified = false) {
  const registered = Boolean(status?.state?.active);
  const running = Boolean(status?.runtime);
  currentlyRunning = running;
  const busy = isApplicationBusy(status);
  $('application-setup').hidden = !status || running || (registered && verified && !busy && !status.application?.error);
  $('installation-form').hidden = registered;
  $('start-application').hidden = !registered;
  $('start-application').disabled = busy;
  $('attach-application').disabled = busy;
  for (const id of ['installations', 'binary-path', 'data-path']) $(id).disabled = busy;
  $('application-help').textContent = t(registered ? 'applicationStopped' : 'applicationDiscover');
  $('application-version').textContent = running ? `Claude Science ${status.runtime.version} · ${t('running')}` : t('applicationStopped');
  $('stop-application').disabled = !running || busy || Boolean(status?.runtime?.activeFrames || status?.inFlight);
  $('application-open').disabled = !registered || busy;
  const error = status?.application?.error;
  $('application-progress').textContent = error ? `${t(errorKey(error))} (${error.code})` : busy ? t(`install.${status?.application?.phase || 'starting'}`) : '';
  const manual = $('installations').querySelector('option[value=""]');
  if (manual) manual.textContent = t('manualPath');
  if (status && !registered && !busy) void discover();
}
export function bindApplication(refresh) {
  $('application-open').addEventListener('click', async () => {
    if (!currentlyRunning && !await startApplication(refresh)) return;
    window.location.assign('/');
  });
  $('installations').addEventListener('change', selectInstallation);
  $('installation-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (operation) return;
    operation = true; $('attach-application').disabled = true;
    try {
      await api('application/attach', { binary: $('binary-path').value, dataPath: $('data-path').value.trim() });
      await refresh(); notice('attachStarted');
    } catch (error) { notice(errorKey(error), true); }
    finally { operation = false; await refresh().catch(error => notice(errorKey(error), true)); }
  });
  $('start-application').addEventListener('click', () => startApplication(refresh));
  $('stop-application').addEventListener('click', async () => {
    operation = true; $('stop-application').disabled = true;
    try { await api('application/stop', {}); notice('applicationStopped'); }
    catch (error) { notice(errorKey(error), true); }
    finally { operation = false; await refresh().catch(error => notice(errorKey(error), true)); }
  });
}
export async function startApplication(refresh) {
  if (operation) return false;
  operation = true; $('start-application').disabled = true; $('open-workspace').disabled = true;
  notice('install.starting');
  try { await api('application/start', {}); notice('applicationStarted'); return true; }
  catch (error) { notice(errorKey(error), true); return false; }
  finally { operation = false; await refresh().catch(error => notice(errorKey(error), true)); }
}
