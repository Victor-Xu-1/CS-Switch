const origin = process.argv[2] || 'http://127.0.0.1:19970';
const csrf = await fetch(origin + '/api/csrf', { headers: { origin } });
const cookie = csrf.headers.getSetCookie().find(value => value.startsWith('operon_csrf='));
if (!cookie) throw Error('Original runtime CSRF handshake failed.');
const token = decodeURIComponent(cookie.split(';')[0].slice('operon_csrf='.length));
const call = async (path, body) => {
  const response = await fetch(origin + path, { method: 'POST', headers: { origin, 'x-operon-csrf': token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(`Original API returned ${response.status}`); return response.json();
};
const project = await call('/api/projects', { name: 'CS-Switch web task acceptance', find_or_create: true });
const task = await call(`/api/projects/${project.project_id}/request`, { input_data: { request:
  'This is a short software integration acceptance test. Use the web_search tool to find the official NCBI PubMed site. Then use the web_fetch tool to read https://pubmed.ncbi.nlm.nih.gov/about/ . Report one short fact actually present on that page, with the source URL. Use Python to save that fact and URL in cs-switch-web.json, and save the file as an artifact. Do not delegate or add unrelated work. Report tool failures honestly; do not replace a failed web tool with memory or another tool.' }, plan_mode: false,
  ...(process.argv.includes('--no-thinking') ? { thinking: false, thinking_mode: 'off' } : {}) });
console.log(JSON.stringify({ project: project.project_id, ...task, url: `${origin}/projects/${project.project_id}/frames/${task.root_frame_id}` }));
