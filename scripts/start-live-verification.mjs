const origin = process.argv[2] || 'http://127.0.0.1:8000';
const artifactIndex = process.argv.indexOf('--source-artifact');
const sourceArtifact = artifactIndex >= 0 ? process.argv[artifactIndex + 1] : null;
if (artifactIndex >= 0 && !/^[a-f0-9-]{36}$/.test(sourceArtifact || '')) throw Error('--source-artifact requires the actual saved artifact ID.');
const csrfResponse = await fetch(`${origin}/api/csrf`, { headers: { origin } });
const cookie = csrfResponse.headers.getSetCookie().find(c => c.startsWith('operon_csrf='));
if (!cookie) throw Error('Runtime CSRF handshake failed.');
const token = decodeURIComponent(cookie.split(';')[0].slice('operon_csrf='.length));
const call = async (path, input) => {
  const response = await fetch(origin + path, { method: 'POST', headers: { origin, 'x-operon-csrf': token, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
};
const project = await call('/api/projects', { name: 'CS-Switch · DeepSeek verification', find_or_create: true });
const request = sourceArtifact
  ? `This is a small artifact-lineage integration acceptance test. Use the actual Python tool to read the existing CSV artifact {{artifact:${sourceArtifact}}}. Calculate the mean of its value column, write a one-row CSV named cs-switch-lineage.csv with a mean column, and save that CSV as an artifact. Read the actual file; do not hardcode the values. Do not delegate or run unrelated analysis. Report the observed mean and saved artifact only; report failures honestly.`
  : 'This is a small real integration acceptance test, not a research project. Use the actual Python tool to calculate the mean of [2,4,6], write those three values to cs-switch-live.csv, and print the mean. Use the actual R tool to calculate the same mean. Use the chemistry MCP tool pubchem_search_compounds once to look up ethanol (with_properties=False, max_cids=1). Save the CSV as an artifact. Do not delegate or add unrelated analyses. Report only the observed Python mean, R mean, returned PubChem CID and artifact link; report any tool failure honestly. Keep the task short.';
const task = await call(`/api/projects/${project.project_id}/request`, { input_data: { request }, plan_mode: false });
console.log(JSON.stringify({ project: project.project_id, ...task, url: `${origin}/projects/${project.project_id}/frames/${task.root_frame_id}` }));
