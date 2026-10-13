const origin = process.argv[2] || 'http://127.0.0.1:8000';
const csrfResponse = await fetch(`${origin}/api/csrf`, { headers: { origin } });
const cookie = csrfResponse.headers.getSetCookie().find(c => c.startsWith('operon_csrf='));
if (!cookie) throw Error('Runtime CSRF handshake failed.');
const token = decodeURIComponent(cookie.split(';')[0].slice('operon_csrf='.length));
const call = async (path, input) => {
  const response = await fetch(origin + path, { method: 'POST', headers: { origin, 'x-operon-csrf': token, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
};
const project = await call('/api/projects', { name: 'CS-Switch · DeepSeek verification', find_or_create: true });
const task = await call(`/api/projects/${project.project_id}/request`, { input_data: { request: 'This is a small real integration acceptance test, not a research project. Use the actual Python tool to calculate the mean of [2,4,6], write those three values to cs-switch-live.csv, and print the mean. Use the actual R tool to calculate the same mean. Use the chemistry MCP tool pubchem_search_compounds once to look up ethanol (with_properties=False, max_cids=1). Save the CSV as an artifact. Do not delegate or add unrelated analyses. Report only the observed Python mean, R mean, returned PubChem CID and artifact link; report any tool failure honestly. Keep the task short.' }, plan_mode: false });
console.log(JSON.stringify({ project: project.project_id, ...task, url: `${origin}/projects/${project.project_id}/frames/${task.root_frame_id}` }));
