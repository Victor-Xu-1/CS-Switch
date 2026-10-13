import { languageKey, readLanguage, translate } from './i18n.js';

export const $ = id => document.getElementById(id);
let language;
try { language = readLanguage(localStorage); } catch { language = 'en'; }
let noticeState = null;
export const t = (key, values) => translate(language, key, values);
export const date = value => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
export function element(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
export async function api(path, data) {
  let response;
  try {
    response = await fetch(`/_bridge/api/${path}`, { signal: AbortSignal.timeout(130000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-cs-switch': '1' }, body: JSON.stringify(data) }) });
  } catch (cause) { throw Object.assign(new Error('Service unavailable'), { code: cause.name === 'TimeoutError' ? 'timeout' : 'network' }); }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message), { code: result.error?.code, status: response.status });
  return result;
}
export function errorKey(error) {
  if (['runtime_busy', 'update_busy', 'connection_busy'].includes(error.code)) return 'modelBusy';
  if (error.code === 'network') return 'errorNetwork';
  if (['timeout', 'request_timeout'].includes(error.code)) return 'errorTimeout';
  if (error.code === 'invalid_endpoint') return 'errorEndpoint';
  if (error.code === 'invalid_model') return 'errorModel';
  if (error.code === 'source_running') return 'errorSourceRunning';
  if (error.code === 'installation_platform') return 'platformHelp';
  if (['adapter_required', 'binary_layout', 'bytecode_unsupported'].includes(error.code)) return 'errorAdapter';
  if (['installation_path', 'ENOENT', 'data_source'].includes(error.code)) return 'errorAppPath';
  if (['no_runtime', 'runtime_boot_failed', 'runtime_boot_timeout', 'runtime_identity', 'sandbox_required'].includes(error.code)) return 'errorAppStart';
  if (error.code === 'key_unavailable') return 'errorCredentials';
  if ([401, 403].includes(error.status)) return 'errorKey';
  if ([402, 429].includes(error.status)) return 'errorQuota';
  if (error.code === 'provider_http_error') return 'errorProvider';
  if (['connection_invalid', 'upstream_protocol', 'upstream_empty', 'upstream_truncated'].includes(error.code)) return 'errorResponse';
  return 'errorGeneric';
}
export function notice(key, isError = false) {
  noticeState = key ? { key, isError } : null;
  $('notice').hidden = !key;
  $('notice').textContent = key ? t(key) : '';
  $('notice').classList.toggle('error', isError);
}
export function localize() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-language]')) node.setAttribute('aria-pressed', String(node.dataset.language === language));
  if (noticeState) notice(noticeState.key, noticeState.isError);
}
export function languages(render) {
  localize();
  for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => {
    language = button.dataset.language;
    try { localStorage.setItem(languageKey, language); } catch { notice('languageMemory'); }
    localize(); render();
  });
}
