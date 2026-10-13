# Verification record — CS-Switch v0.0.1

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
