# Getting started with CS-Switch

[Back to the project](../README.md)

## Requirements

- Linux x64 or Ubuntu under WSL. Native Windows/macOS process management is not
  implemented in this release.
- Node.js >=22.19, npm, Bun, bubblewrap, socat and the prerequisites required by
  your original Claude Science installation.
- A tool-calling model with enough context for the original scientific prompts.
  Visual tools additionally require a model that accepts images.
- Provider API access; a local model may use a loopback URL without a key.

## Install alongside your original executable

```bash
git clone https://github.com/Victor-Xu-1/CS-Switch.git
cd CS-Switch
npm ci
node src/cli.mjs init
node scripts/install-service.mjs
```

Open the workbench at `http://127.0.0.1:8000/_bridge/`. It works even before
Claude Science is attached or running. Choose a detected installation, or enter
its original executable path. Common Linux/WSL locations are scanned without
executing discovered files. An unlisted installation can be selected manually.

Close the original application first if it occupies port 8000 or you want to
import its data. Existing data is optional: a blank data path creates a fresh
workspace. The importer refuses an in-use data directory and preserves the
original executable. It starts only a separate extracted/validated managed copy.
The adapter does not replace the scientific application with a chat demo.

The installer creates and enables a `cs-switch.service` systemd user service.
It refuses to overwrite an existing unit. It does not stop unrelated services.
For a foreground run, use `node src/cli.mjs serve` instead.

Advanced CLI equivalents remain available: `adopt --binary PATH`, followed by
`bootstrap --release ID --data STOPPED_DATA_PATH`. Both use the same extraction,
adapter and release registry as the workbench. Native Windows/macOS binaries are
reported as requiring a platform adapter, never falsely shown as compatible.

`CS_SWITCH_HOME` (or `--home PATH`) chooses the state directory. The default is
`~/.local/share/cs-switch`. Run one service per home; systemd uses `flock` for
ownership. No credentials or runtime data belong inside the source checkout.
Keep this path short: the original application's Unix socket paths must fit
within 108 bytes. An overlong path is reported before activation.

## Connect a model

1. Select a provider, enter its model ID/key and click **Connect & test**. Common
   API addresses are prefilled; custom addresses are under Connection details.
   One short real inference checks the draft before atomically activating it.
2. Click **Open Claude Science** (or **Start & open** when stopped). Start a new task. The selected provider
   handles model inference, including subagents and reviewers; the original
   application executes its tools.

For DeepSeek, use `https://api.deepseek.com/v1` with the model ID offered by your
account. For an Anthropic-compatible endpoint, use its API root or `/v1` root.
OpenAI-compatible URLs must end at the versioned API base, before
`/chat/completions`.

The interface intentionally separates **configured**, **connection tested**,
**tool execution tested**, and **scientifically validated**. A successful HTTP
request or example session is not evidence that a real task succeeded.

Keys are never returned to the browser. A blank key field preserves the saved
key only while the API address remains unchanged. A new address requires explicit
key entry so saved credentials cannot be forwarded accidentally. Cancelling a
connection test aborts its request; the workbench reloads the actual saved state.
Language changes never translate model IDs or scientific
data. English is the default for a fresh/invalid preference.

## Network and environment setup

The original runtime owns Conda installation and its environment manifests.
CS-Switch shows their live state. If the host requires an HTTP proxy, set
`network.proxy` in the external `config.json`, for example:

```json
"network": { "proxy": "http://127.0.0.1:7890" }
```

Restart the service after editing configuration. This setting is used by release
downloads, provider requests and the runtime's package installer. Loopback
traffic stays direct. TLS validation and the runtime sandbox remain enabled.
Do not assume the example proxy port is present on another computer.

