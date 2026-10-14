# Verification records — CS-Switch (Claude science-Switch)

## v0.0.5 — task capabilities and original 0.1.62

Date: 2026-10-14. Official `latest` moved to `7c91ff2f` / **0.1.62** during this
work. The old adapter correctly retained 0.1.60 when an exported policy alias
disappeared. A semantic producer/return-contract match now handles the new layout,
still requiring a unique complete match. The standalone 0.1.62 executable was
attached in isolated state, started, stopped and restarted. Sandbox, original
frontend assets, Python/R and 20 MCP environment checks passed. Its original
SHA-256 stayed `4ca53e7a770934743aa8a3b2b16b1d6df073bbb1b9543d58af2454f065cf16f8`.
The revised adapter also passed against a freshly extracted 0.1.60 copy.

### Real task evidence

- DeepSeek `deepseek-v4-pro`: original 0.1.62 frame
  `2fade481-f286-4ec6-81f2-9fa8b6ab8ff3`, completed
  `2026-10-14T11:15:38.176Z`. Search returned eight results; page reading returned
  the actual PubMed About content; Python wrote JSON and original save_artifacts
  registered version `9bcb371b-f693-4ca5-a797-10ca2c56e588`.
  File: 153 bytes, SHA-256
  `1c5384c9ee45be77a61ea5309da304cf71f04fc6772929d886548ee0201e8c6f`.
- User's current MiMo `mimo-v2.6-flash`: original 0.1.62 frame
  `9f43febd-94e8-47d1-8509-5be2ea33624f`, completed
  `2026-10-14T11:18:37.770Z`. Search, page read, Python and artifact saving passed;
  version `2b89448e-1e24-4eb2-8eee-a7cb26713f80`, 256 bytes, SHA-256
  `825e6d36d8cf9c0ad502cec36a6765e87849f4a732017314d2b3bf568f2f46b8`.
- Both tasks used the original frontend and approval/execution path. Browser
  controls, stored original tool receipts and actual artifact bytes were inspected.
  The short acceptance requests explicitly selected thinking off; enabled-mode
  parameter preservation is separately covered by protocol regressions.
- Real DeepSeek OpenAI and MiMo OpenAI calls read plain-text and generated PDF
  measurement inputs, returning the actual value **37** through schema validation.
- Real DeepSeek **Anthropic-compatible** requests to its documented same-host
  endpoint passed PDF input/schema validation and web fetch with actual page text.
  No original active production profile was switched by these probes.

### Failures found and resolved

The first original task exposed a missing reader in the original advertised
toolset. The bridge now adds its reader only on search-enabled task requests.
Later turns/reviewers still lost fetch evidence: sanitized message-shape tracing
proved original 0.1.62 removed the new hosted fetch calls/results while retaining
search. A private bounded source-evidence cache and normal source links now restore
that evidence before later inference, without changing the original application.
The successful tasks above were rerun after this fix; the earlier failed/stopped
attempts remain in isolated data and are not represented as passing runs.

The host proxy supplies synthetic 198.18.x.x DNS answers. Public reading now uses
fixed HTTPS DNS through the configured proxy and pins the validated public IP,
retaining Host/TLS identity. Private-address exceptions were not added. Real NCBI
page reads passed alongside focused HTTP-compression checks. PDF parsing, compressed
size limits, schema rejection, cancellation, mixed tools, split streamed tool
names and evidence restoration after restart have focused regressions.

Checks use `node scripts/test-scope.mjs 16d5c67c16cdcb511dd345be47b7705d245a6753`
and exact changed-module runs. Test concurrency is bounded to two processes after
a host WSL launch-timeout incident; no global upstream suite or WSL shutdown was
used. Full capability boundaries are in [task capabilities](task-capabilities.md).
Deployment revision/health remains a separate post-merge check.

## v0.0.4 — original background tool and artifact-lineage acceptance

The v0.0.3 task succeeded, but its runtime log subsequently exposed DeepSeek 400
errors in background input-reference extraction. A focused real request reproduced
the default-thinking/forced-tool mismatch. After preserving Claude's omitted
thinking mode as explicitly disabled for DeepSeek, the same request returned
HTTP 200 and the required `report_input_files` result. Explicit adaptive thinking
remains enabled. No forced tool is dropped and no automatic retry is introduced.

An additional real task ran through the same freshly attached standalone 0.1.60
application, now with the v0.0.4 transport:

- Frame: `2ff8e655-113e-4560-94ec-69ad801ac0bb`, completed
  `2026-10-13T05:06:11.967Z`.
- Python read the actual previous CSV version
  `9eea2195-129e-412c-bb43-5639bf5bf090`, computed **4.0**, and saved
  `cs-switch-lineage.csv`, version `7bbd9eb0-ff9f-4ff7-b2de-8c73104275d8`.
- Stored artifact: 9 bytes; checksum
  `23b54ff915839815851af7c57c4caae56e169e5022c7cd5b95470fbe63cdfed1`.
- A read-only database query verified the saved output/input dependency edge,
  reference name `cs-switch-live.csv` and dependency mapping `consensus: both`.
- Fresh runtime logs contained no provider/dependency-extraction failure for
  this task. Only the inspected Python call was approved once.
- 33 focused tests passed; syntax checked 53 first-party source files; version
  validation confirmed v0.0.3 -> v0.0.4.

Reproduction uses `verify-provider-contract.mjs STATE_HOME` (one explicitly
invoked paid inference, no execution tools or state mutation) and
`start-live-verification.mjs ORIGIN --source-artifact ACTUAL_VERSION_ID` for the
original task path. Neither script fabricates or hardcodes a scientific result.

## v0.0.3 — quality and latest independent executable acceptance

Date: 2026-10-13. The official `latest` pointer was read again and returned
`8db2454a`, the independently distributed Linux x64 executable **0.1.60**.
Its downloaded provenance records official RSA signature verification. The
standalone source executable SHA-256 before and after attachment is:
`94c7f9c50aa8a47935cc754d2e4b3b7d7cb186ef48e4826df353997322003108`.
This is not merely an existing extracted runtime being reused: the installation
API re-extracted and validated the standalone executable into a new isolated data
home, then stopped/restarted it. The original binary stayed unchanged.

The revised workbench opened this original frontend. The existing authorized
DeepSeek profile was re-encrypted in the isolated home at its unchanged API
address; no key entered Git or logs. A real connection reply succeeded, followed
by a real original-application task:

- Model: `deepseek-v4-pro` (external inference, not a local fixture).
- Frame: `f06f55a2-6254-4aaa-9b69-7d4ea13eef05`; completed at
  `2026-10-13T04:51:22.801Z`.
- Actual Python mean of [2,4,6]: **4**; actual R mean: **4**.
- Chemistry MCP `pubchem_search_compounds`: returned `cids: [702]` for ethanol.
- Original artifact version reference: `9eea2195-129e-412c-bb43-5639bf5bf090`.
- `cs-switch-live.csv`: exactly 12 bytes, `value\n2\n4\n6\n`;
  SHA-256 `4bf52ef5f6a4bb4d36efed5a331d561e4f0a7d2d25f77f48345f89ba364374e0`.
- Python/R requests were inspected and allowed **once**, not conversation,
  project or global permission. Sandbox active; Python/R and 20 MCP environment
  checks passed. Original frontend displayed the real task and artifact.

The initial test-home name exceeded the upstream Unix socket path limit and was
rejected before activation. A new short home resolved this host-path constraint;
the failed state was not deleted. The workbench now explains the specific fix.

Focused verification: 49 tests selected by changed files, imported dependants and
explicit UI/HTTP/shared-lock contracts; all passed. Syntax checked 52 first-party
source files. Version check confirmed exactly v0.0.2 -> v0.0.3. Browser evidence
and quality limits are in [quality](quality.md). Production revision verification
is a separate post-merge gate, not implied by candidate acceptance.

## v0.0.1 — original integration baseline

Verification date: 2026-10-13. This is an integration release, not a guarantee
about every future upstream version, external provider or scientific method.

## Focused contract checks

- `npm run check`: syntax check of 48 first-party JS/MJS source files.
- `npm run check:version`: package/lockfile agreement; PR CI additionally requires
  the exact next version relative to its base, starting with v0.0.1.
- `npm run test:protocol`: 18 passing protocol/gateway/search-adapter tests.
- `npm run test:update`: 14 passing release/update/rollback/stopped-state tests.
- `npm run test:workbench`: 17 passing connection, application lifecycle,
  installation discovery/data-source protection, bilingual UI and version tests.

These target the newly implemented CS-Switch modules and direct contracts.
No global upstream Claude Science scientific test suite was run.

## Actual installed applications

| Path exercised | Observed result |
| --- | --- |
| Official release download | 0.1.60, upstream 8db2454a; RSA signature, signed ordering and SHA-256 verified |
| Stable deployed entry | http://127.0.0.1:8000/ through CS-Switch |
| Automatic validated upgrade | 0.1.47 -> 0.1.60; previous runtime/data generation retained |
| Original scientific frontend | Loaded with its own assets and four-agent registry; sandbox active |
| Python and R | Ready; actual interpreter executions passed |
| Bundled environment-backed MCP checks | 20/20 ready; this is not a claim that every remote service account is configured |
| Older installed executable attachment | Unmodified 0.1.47: attach, start, stop, restart and original frontend passed with isolated data |
| Original executable preservation | Before/after SHA-256 identical: e356466bd43e64b44f386e0f55980deacfef71b571f5f46c4ce3667fd27588cc |
| Control plane independence | Workbench available before application attachment and after application stop |

The earlier Python/R/MCP installation failures were caused by missing outbound
proxy configuration in the WSL service. Environment installation succeeded using
the existing host proxy. TLS validation, sandboxing and approval controls were
not disabled.

Installation detection has no fixed version-number allowlist. The actual binary
layout, unique adapter boundaries, startup and runtime capabilities are gates.
Native Windows/macOS binaries remain unsupported by this Linux/WSL release.

## Real model and tool execution

The user-selected DeepSeek account offered `deepseek-v4-pro` and
`deepseek-flash`; this release was tested with **deepseek-v4-pro**.

A real original-application task completed using the external model:

- Frame: `3a8300a5-0bae-49ed-adb2-73ebb4ae9d8c`.
- Python: mean of [2, 4, 6] returned 4.0, exit_code 0.
- R: mean of the same values returned 4, exit_code 0.
- Chemistry MCP: actual PubChem ethanol lookup returned CID 702, exit_code 0.
- Original save_artifacts tool produced a 12-byte CSV, verified on disk as
  `value\n2\n4\n6\n`.
- Artifact SHA-256:
  `4bf52ef5f6a4bb4d36efed5a331d561e4f0a7d2d25f77f48345f89ba364374e0`.

Python/R execution approvals were granted once for the inspected test code.
No persistent blanket approval or sandbox bypass was introduced.

Both OpenAI and Anthropic wire formats also drove real application tools through
a clearly identified controlled local model fixture. The Anthropic fixture
executed Python, R, a real PubChem MCP lookup and artifact saving. This proves
protocol/tool integration, not a real external Anthropic-compatible account.

## Browser acceptance

Google Chrome on the deployed 8000 entry verified:

- English initial view and Chinese/English switching.
- Chinese language and successful connection receipt persisted after refresh.
- Saved key remained hidden; leaving it blank successfully reused it.
- One-click real DeepSeek connection test, disabled/loading state, success view.
- Invalid non-local HTTP endpoint rejected with Chinese guidance; previous
  usable profile remained unchanged.
- Cancel editing restored the saved connection.
- Opening the original Claude Science frontend through the main action.
- Narrow 390px layout without horizontal overflow.
- Advanced settings expose independent CS-Switch / Claude Science versions.
- Managed stop leaves the workbench reachable; Start & open launches the original
  scientific frontend again. Active-task rejection is covered by lifecycle tests.

Screenshots, model credentials, tool transcripts, databases and downloaded
upstream binaries are outside Git. The final repository contains first-party
source, pinned dependencies, reproducible verification scripts and this evidence
index only.

## Limits that remain explicit

- Future executable formats, signing keys and upstream API changes may need a
  reviewed adapter. Unsupported candidates retain the current version.
- Tool availability is distinct from model capability and scientific validity.
  No blanket validation of all scientific workflows, modalities or remote MCP
  accounts has been performed.
- Cloud-only services still need their own authorized accounts/keys.
- OpenAI top-level and tool-result images are mapped; the model still needs
  image support. Native document blocks and some provider-specific hosted tools
  require additional adapters.
- Web-search translation passed controlled contract tests; DuckDuckGo network
  access/challenges remain an external dependency, not guaranteed availability.
- Prices displayed by the original application are not authoritative third-party
  billing. Provider usage is mapped without counting cache-hit input twice.
