import { parse } from 'acorn';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { invariant } from '../core/errors.mjs';
import { atomicJson } from '../core/files.mjs';

const local = 'process.env.OPERON_LOCAL_PROVIDER_MODE==="1"';
const credential = `if(${local}){const key=process.env.ANTHROPIC_API_KEY?.trim();if(!key)throw Error("CS-Switch model gateway credential missing");return{api_key:key,auth_token:null,source:"environment",subscription_tier:null,rate_limit_tier:null,seat_tier:null,org_uuid:null,account_uuid:null,billing_type:null,has_extra_usage_enabled:null};}`;
const localAuth = `if(${local})return{authenticated:true,provider:"api_key",user_id:"local",email:"local@localhost",account_uuid:null,subscription_type:null,rate_limit_tier:null,billing_resolved:true,tier_unmappable:true,oauth_stale:false,reauth_required:false,shared_api_key:false,restart_pending:false,wif_unverified:false,dangerously_skip_approvals:false};`;

function walk(node, parents, visitor) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visitor(node, parents);
  parents.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc', 'range'].includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) walk(item, parents, visitor);
    else if (value && typeof value === 'object') walk(value, parents, visitor);
  }
  parents.pop();
}
const parentOf = (parents, type) => parents.findLast(p => typeof type === 'string' ? p.type === type : type(p));
const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);

export function adaptBackend(source) {
  invariant(!source.includes('/* CS-Switch adapter v1 */'), 'already_adapted', 'The runtime has already been adapted.');
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const edits = [], matches = new Map(), policyReturns = new Set(), policyMembers = new Map();
  const add = (label, start, end, text) => {
    matches.set(label, (matches.get(label) || 0) + 1); edits.push({ label, start, end, text });
  };
  walk(tree, [], (node, parents) => {
    const enclosing = parentOf(parents, isFunction);
    if (node.type === 'MemberExpression' && enclosing?.type === 'FunctionDeclaration') {
      const properties = policyMembers.get(enclosing) || new Set();
      properties.add(node.property.name || node.property.value); policyMembers.set(enclosing, properties);
    }
    if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression' && enclosing?.type === 'FunctionDeclaration') {
      const properties = new Set(node.argument.properties.map(p => p.key?.name || p.key?.value));
      if (['stop', 'refreshNow', 'whenReady', 'rearmHold'].every(key => properties.has(key))) policyReturns.add(enclosing);
    }
    const value = node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.cooked : null;
    if (typeof value !== 'string') return;
    if (value === 'This build requires signing in with your Claude account. API keys are not supported.') {
      const guard = parentOf(parents, 'IfStatement'), fn = parentOf(parents, isFunction);
      invariant(guard && fn?.params.length === 2 && fn.params.every(p => p.type === 'Identifier'), 'adapter_required', 'Credential gate structure changed.');
      const [apiKey, authToken] = fn.params.map(p => p.name);
      add('api-key-gate', guard.test.start, guard.test.end, `(${local}?(!${apiKey}&&!${authToken}&&!process.env.ANTHROPIC_API_KEY?.trim()&&!process.env.ANTHROPIC_AUTH_TOKEN?.trim()):(${source.slice(guard.test.start, guard.test.end)}))`);
    }
    if (value === 'No credentials available for Anthropic API. Please sign in with your Claude account.') {
      const fn = parentOf(parents, isFunction), method = parentOf(parents, 'MethodDefinition');
      invariant(fn?.body.type === 'BlockStatement' && method?.key.name === 'resolve', 'adapter_required', 'Credential resolver structure changed.');
      add('credential-resolver', fn.body.start + 1, fn.body.start + 1, credential);
    }
    if (value.includes('disabling login auth (require_token = false) is not available in this build')) {
      const guard = parentOf(parents, 'IfStatement');
      invariant(guard, 'adapter_required', 'Local entry guard structure changed.');
      add('loopback-local-entry', guard.test.start, guard.test.end, `(${source.slice(guard.test.start, guard.test.end)})&&!(${local})`);
    }
    if (value === '/api/auth/status') {
      const call = parentOf(parents, 'CallExpression');
      if (call?.callee?.property?.name === 'get' && call.arguments[1]?.body?.type === 'BlockStatement') {
        const body = call.arguments[1].body;
        add('local-auth-status', body.start + 1, body.start + 1, localAuth);
      }
    }
    if (value.startsWith('caFetch: path must start with')) {
      const fn = parentOf(parents, isFunction);
      invariant(fn?.body.type === 'BlockStatement', 'adapter_required', 'Account fetch boundary changed.');
      add('local-account-isolation', fn.body.start + 1, fn.body.start + 1, `if(${local})return null;`);
    }
    if (value.includes('(operon|claude-bioscience|claude-science)')) {
      const fn = parentOf(parents, isFunction);
      if (fn?.type === 'FunctionDeclaration' && fn.params[0]?.type === 'Identifier') {
        const argument = fn.params[0].name;
        add('daemon-process-identity', fn.body.start + 1, fn.body.start + 1,
          `if(${local}&&typeof ${argument}==="string"&&${argument}.includes("/app_bundle_raw/claude-science.bundle.js")&&/\\bserve\\b/.test(${argument}))return true;`);
      }
    }
  });
  const pollers = [...policyReturns].filter(fn => ['flagKeys', 'caFetch', 'pollIntervalMs'].every(key => policyMembers.get(fn)?.has(key)));
  invariant(pollers.length === 1 && pollers[0].body.type === 'BlockStatement', 'adapter_required', 'Feature-policy polling boundary changed or is ambiguous.');
  const poller = pollers[0];
  add('local-feature-policy', poller.body.start + 1, poller.body.start + 1,
    `if(${local})return{stop:()=>{},refreshNow:async()=>null,whenReady:async()=>{},rearmHold:()=>{},forgetKeptUseCases:()=>{}};`);
  for (const label of ['api-key-gate', 'credential-resolver', 'loopback-local-entry', 'local-auth-status', 'local-account-isolation', 'local-feature-policy', 'daemon-process-identity']) {
    invariant(matches.get(label) === 1, 'adapter_required', `Adapter expected one ${label} boundary; found ${matches.get(label) || 0}. No partial patch was written.`);
  }
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) invariant(edits[i].end <= edits[i - 1].start, 'adapter_overlap', 'Adapter edits overlap.');
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  output += '\n/* CS-Switch adapter v1 */\n';
  parse(output, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  return { output, changes: edits.map(({ label, start, end }) => ({ label, start, end })) };
}

export async function adaptPrepared(root) {
  const path = join(root, 'app_bundle_raw/claude-science.bundle.js');
  const source = await readFile(path, 'utf8');
  const adapted = adaptBackend(source);
  await writeFile(path, adapted.output, { mode: 0o600 });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const receipt = { schema: 1, adapter: 'operon-ast-local-provider-v1', inputSha256: hash(source), outputSha256: hash(adapted.output), changes: adapted.changes,
    boundary: 'Local inference identity only. Scientific tools, sandbox, network/file approvals and original frontend remain intact.' };
  await atomicJson(join(root, 'adaptation.json'), receipt);
  return receipt;
}
