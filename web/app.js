import { $, t, date, element, api, notice, errorKey, languages } from './ui.js';
import { renderSettings, bindSettings } from './settings.js';
import { renderApplication, bindApplication, startApplication, isApplicationBusy } from './application.js';

let profiles = [], templates = [], active = null, editing = null, status = null;
let editingVisible = false, loading = true, connecting = false;

// Suggestions are editable IDs, never a silent model substitution.
const suggestions = { deepseek: ['deepseek-v4-pro', 'deepseek-flash'] };
function renderOptions() {
  for (const option of $('provider').options) {
    const template = templates.find(item => item.id === option.value);
    const key = 'provider.' + option.value;
    option.textContent = t(key) === key ? template.name : t(key);
  }
  const fresh = $('saved-profile').querySelector('option[value=""]');
  if (fresh) fresh.textContent = t('newConnection');
}
function render() {
  renderOptions();
  $('loading').hidden = !loading;
  const verified = Boolean(active?.connectionTest);
  $('model-connection').hidden = Boolean(status && !status.state.active);
  $('connected').hidden = loading || editingVisible || !verified;
  $('provider-form').hidden = loading || (!editingVisible && verified);
  $('connection-title').textContent = t(!editingVisible && verified ? 'connected' : 'setup');
  $('connection-badge').textContent = t(editingVisible && active ? 'currentKept' : verified ? 'verified' : active ? 'configured' : 'notConnected');
  $('connection-badge').classList.toggle('success', verified && !editingVisible);
  $('cancel-edit').hidden = !verified;
  $('connect').textContent = t(connecting ? 'connecting' : 'connect');
  $('connection-fields').disabled = connecting;
  $('connect').disabled = connecting || templates.length === 0 || !status?.runtime;
  $('change-model').disabled = Boolean(status?.runtime?.activeFrames || status?.inFlight);
  $('open-workspace').textContent = t(status?.runtime ? 'open' : 'startAndOpen');
  $('open-workspace').disabled = !status?.state?.active || !verified || isApplicationBusy(status);
  $('open-help').textContent = t(status?.runtime?.sandbox ? 'readyHint' : status?.state?.active ? 'startHint' : 'waitHint');
  $('key-help').textContent = t(editing?.hasApiKey ? 'keySaved' : $('provider').value === 'ollama' ? 'localKey' : 'keyHelp');
  $('show-key').textContent = t($('api-key').type === 'password' ? 'show' : 'hide');
  if (active) {
    $('active-name').textContent = active.name;
    $('active-model').textContent = active.model;
    $('connection-proof').textContent = active.connectionTest ? t('proof', { date: date(active.connectionTest.at) }) : t('untested');
  }
  renderSettings(status);
  renderApplication(status, verified);
}
function choose(profile = null) {
  editing = profile;
  $('provider').value = profile?.provider || templates[0]?.id || '';
  const template = templates.find(item => item.id === $('provider').value);
  $('name').value = profile?.name || template?.name || '';
  $('base-url').value = profile?.baseUrl || template?.baseUrl || '';
  const models = suggestions[template?.id] || [];
  $('model').value = profile?.model || models[0] || '';
  $('model-options').replaceChildren(...models.map(id => { const option = element('option', id); option.value = id; return option; }));
  $('api-key').value = '';
  $('api-key').type = 'password';
  $('show-key').setAttribute('aria-pressed', 'false');
  $('saved-profile').value = profile?.id || '';
  $('endpoint-settings').open = !template?.baseUrl;
  render();
}
async function loadProfiles() {
  const data = await api('providers');
  profiles = data.profiles;
  templates = data.templates;
  active = profiles.find(profile => profile.id === data.activeId) || null;
  $('provider').replaceChildren(...templates.map(template => { const option = element('option', template.name); option.value = template.id; return option; }));
  $('saved-profile').replaceChildren(...[...profiles.map(profile => { const option = element('option', profile.name + ' · ' + profile.model); option.value = profile.id; return option; }), element('option', t('newConnection'))]);
  $('saved-profile').lastElementChild.value = '';
  $('saved-row').hidden = profiles.length <= 1;
  loading = false;
  choose(active);
}
async function refresh() {
  try { status = await api('status'); }
  catch (error) { status = null; render(); throw error; }
  render();
}
$('provider').addEventListener('change', () => {
  const template = templates.find(item => item.id === $('provider').value);
  choose({ provider: template.id, name: template.name, baseUrl: template.baseUrl });
});
$('saved-profile').addEventListener('change', () => choose(profiles.find(profile => profile.id === $('saved-profile').value)));
$('change-model').addEventListener('click', () => { editingVisible = true; choose(active); $('provider').focus(); });
$('cancel-edit').addEventListener('click', () => { editingVisible = false; choose(active); notice(null); });
$('show-key').addEventListener('click', () => {
  const shown = $('api-key').type === 'password';
  $('api-key').type = shown ? 'text' : 'password';
  $('show-key').setAttribute('aria-pressed', String(shown));
  render();
});
$('base-url').addEventListener('invalid', () => { $('endpoint-settings').open = true; });
$('provider-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (connecting) return;
  connecting = true; notice(null); render();
  const template = templates.find(item => item.id === $('provider').value);
  try {
    await api('connect', {
      id: editing?.id, provider: template.id, protocol: template.protocol,
      name: $('name').value, baseUrl: $('base-url').value, model: $('model').value,
      apiKey: $('api-key').value, apiKeyEnv: editing?.apiKeyEnv || '',
    });
    $('api-key').value = '';
    editingVisible = false;
    await loadProfiles();
    await refresh();
    notice('connectedNotice');
    $('open-workspace').focus();
  } catch (error) { notice(errorKey(error), true); }
  finally { connecting = false; render(); }
});
$('open-workspace').addEventListener('click', async () => {
  if (!status?.runtime && !await startApplication(refresh)) return;
  window.location.assign('/');
});
bindSettings(refresh);
bindApplication(refresh);
languages(render);
render();
try { await Promise.all([loadProfiles(), refresh()]); }
catch (error) { notice(errorKey(error), true); }
finally { loading = false; render(); }
// Readiness refresh never performs a paid model request or overwrites form input.
let lastRefresh = Date.now();
setInterval(() => {
  if (!document.hidden && !connecting && (isApplicationBusy(status) || Date.now() - lastRefresh >= 30000)) {
    lastRefresh = Date.now();
    void refresh().catch(error => notice(errorKey(error), true));
  }
}, 5000);
