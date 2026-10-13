# Architecture and contracts

The application is a local compatibility manager with four separate modules.

The control workbench starts independently of the scientific process. It remains
available when no installation is registered, when the process is deliberately
stopped, and after a boot failure. Discovery scans bounded common Linux/WSL paths
and allows an explicit executable path; it does not execute arbitrary discovered
files or hardcode an upstream version allowlist. Initial attachment validates a
separate managed copy before committing a runtime/data pair.

Start/stop/attach and updates share one operation lock. A stop rechecks idle after
blocking new ingress, and persists the desired stopped state; automatic updates
do not restart a deliberately stopped application. The proxy refuses to forward
to an unowned runtime port. Original data import checks same-user open file
descriptors before and after copying and never terminates the source application.

```text
Browser :8000
  ├─ /_bridge/           CS-Switch configuration workbench
  └─ original routes    reverse proxy → managed Claude Science :18000
                                           │
                                  private model transport :17990
                                           │
                                OpenAI / Anthropic provider

Original runtime → Python / R / MCP / skills / artifacts / approvals
```

Provider configuration is independent of upstream releases. One active profile
is resolved for each inference request. API keys are AES-256-GCM encrypted with
a separate local key file. Malformed encrypted state is an error; credentials
are never silently discarded. Admin mutations require a same-origin request
and an explicit custom header. The model transport requires an ephemeral local
credential. Services bind only to loopback and reject unrecognized Host headers.

The proxy validates the browser Origin before translating it to the private
runtime's Origin. The original CSRF token flow and WebSocket protocol are
preserved. Long-lived WebSockets are disconnected at the start of an idle
update, allowing the client to reconnect after activation.

## Protocol contract

Anthropic-compatible providers receive native Messages content and live SSE.
OpenAI providers receive Chat Completions, with JSON schemas and tool arguments
preserved. Invalid JSON arguments, unsupported blocks, truncated streams and
unknown stop reasons fail explicitly. Missing usage is unknown, not free usage.
Image-bearing tool results retain a text tool receipt and an explicitly labelled
user-image message carrying the original pixels and tool-call ID. The selected
model must accept image inputs; unsupported modalities remain visible errors.
Cancellation aborts the upstream request; requests have time and concurrency
limits. No automatic retry can accidentally duplicate a tool execution.

One-click connection uses this same transport to test an unsaved draft. Only a
complete text reply and an idle runtime permit atomic activation and a durable
test receipt. Failed tests leave the previous profile and key unchanged. Input
usage excludes cache hits in the Anthropic-facing response, preventing double
counting; original-application price estimates are not provider billing evidence.

The final idle check and activation reserve the same operation lock as updates
and application start/stop. Disconnecting or cancelling a test aborts provider
transport, including native response-body reads. Cancellation before the atomic
commit leaves the prior profile unchanged; if completion raced with cancellation,
the UI reloads the actual saved state instead of promising an unverified rollback.
Changing a saved profile's API address requires an explicit replacement key (or
explicit removal), including credentials supplied through an environment variable.

Environment readiness is a coalesced background check with a 15-second freshness
window. Results belong to a specific process identity; restarting cannot reuse
the previous process's evidence. Core status is not delayed by MCP checks. The
browser coalesces polling and discards superseded responses after a mutation.

Anthropic adaptive-thinking requests map to the selected provider's reasoning
control: DeepSeek `thinking`, Qwen `enable_thinking`, or OpenAI
`reasoning_effort`. The provider/model must support that control. A provider
rejection is visible; the gateway does not silently switch models or protocols.
When Claude omits thinking (including its background dependency extraction), the
DeepSeek adapter explicitly disables it. DeepSeek's default is thinking enabled,
which rejects forced/required tool selection. The adapter preserves the requested
tool and arguments rather than dropping that requirement or silently retrying.
Explicit adaptive/enabled thinking requests remain enabled.

Anthropic-hosted web search is represented as an ordinary function for an
OpenAI provider and executed by the gateway's explicit DuckDuckGo HTML search
adapter. It preserves source URLs and bounds queries, response size, results
and tool rounds. Challenges/unrecognized responses are errors, never invented
results. Native Anthropic endpoints must support the server tools they receive.

Not every provider-specific feature has a universal equivalent. Unsupported
server tools, cloud-only account services, model modalities or context limits
require a matching adapter/provider. The scientific tool registry is not
reduced to hide such incompatibilities.

## Upstream adapter

The source executable stays unchanged. A managed copy is extracted from Bun's
serialized module graph. Tar extraction validates relative paths, file types,
size bounds, and internal symlink targets before writing assets.

Acorn parses the application bundle. The adapter discovers unique semantic
boundaries, independent of minified local variable names. It checks every
required match before writing one adapted bundle, checks overlap, parses the
result again and records before/after hashes. It preserves original frontend
assets, tools, kernels, skills, sandbox and approval behavior. Unknown boundary
shapes are rejected rather than patched by a broad regular expression.

Only local inference identity is substituted; this does not supply credentials
or permissions for external MCP services, cloud compute, paid data sources or
other accounts. Such integrations still require their own credentials and
normal authorization.

## Upgrade transaction

1. Read the official channel pointer.
2. Verify the signed binary digest and signed release ordering under the pinned
   public release key; refuse downgrade below the accepted build epoch.
3. Download to a unique staging path, verify SHA-256, extract and adapt.
4. Record a content-addressed immutable release manifest.
5. Confirm no active analyses/model requests, block new ingress and disconnect
   old WebSockets; check idle again.
6. Stop the old process tree. Copy its data to a new generation.
7. Start and validate the candidate on the private application port.
8. Atomically commit the active runtime/data pair, keeping the previous pair.

Failure restarts the prior pair. A crash before the state commit also selects
the prior pair on restart. A newer database is never opened with an older
binary. Conda environments are owned and reconciled by the original runtime;
they are not represented as database snapshots.

## Repository ownership

`src/core` owns storage/config/error primitives; `src/protocol` owns wire
translation; `src/gateway` owns HTTP/model/admin transport; `src/runtime` owns
extraction/adapter/process lifecycle; `src/update` owns release trust and
transactions. `web` is the standalone workbench, `tests` contains focused
contracts, and `scripts` contains installation and integration verification.

`package.json` is the single product version source, npm/package-lock is the
dependency authority, state and release schemas are versioned separately.
Runtime files, credentials, logs and verification artifacts stay outside Git.
