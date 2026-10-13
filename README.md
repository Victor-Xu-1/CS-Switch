# CS-Switch

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 中文快速使用

首版 **v0.0.1**。工作台支持中文 / English，语言选择会保留。

自 **v0.0.2** 起，CS-Switch 的自有源码以 [MIT 许可证](LICENSE)开源。
原版 Claude Science / Operon 不随项目分发，其许可证与服务条款保持独立。

- 首次使用：自动查找本机安装，也可填写程序路径，点击“连接程序并启动”。
  原版程序和数据会保留，使用独立受管理副本；导入已有数据前需退出原版。
- 选择第三方模型并填写密钥，点击“连接并测试”。只有收到真实回复后才
  保存并切换；失败时保持之前的连接，不会半途更换正在执行任务的模型。
- 以后直接点击“打开 Claude Science”；程序未运行时显示“启动并打开”。
- 高级设置可打开原版前端、停止程序、检查更新及恢复之前版本。

CS-Switch 不按版本号白名单限制安装；按实际程序结构、启动、安全沙箱和
工具环境检查兼容性。目前已验证 Claude Science **0.1.47、0.1.60**。
这不等于所有未来版本均已验证。当前支持 Linux x64 / Windows 下 Ubuntu WSL；
原生 Windows/macOS 可执行文件尚需平台适配。

停止程序不会停止工作台，也不会删除数据；有任务运行时拒绝停止。
第三方模型仍须支持相应工具调用、上下文长度和模态，外部服务可能需要独立密钥。

## Overview

Configure a third-party LLM in a small local workbench, then use that model
inside Claude Science to run scientific tasks. CS-Switch manages the model
gateway, compatible upstream versions, and recoverable application data.

**This is independent compatibility software, not an official Anthropic product.**
You install your own original Claude Science / Operon executable. The repository
does not redistribute that executable, its application bundle, or its assets.

## What it does

- OpenAI Chat Completions and Anthropic Messages model connections.
- Provider profiles with locally encrypted API keys and one active selection.
- English/Chinese workbench with a single connect-and-test action, persistent
  language preference, local installation discovery, and start/stop/open controls.
- Text/image inputs, JSON tool schemas, tool results, streaming and usage mapping.
- Original Python, R, MCP, skills, files, artifacts and agent execution remain in
  Claude Science, with its sandbox and execution/network/file approval workflow.
- An explicit web-search adapter for OpenAI providers, since Anthropic's hosted
  search tool is not part of the OpenAI Chat Completions protocol.
- Automatic release discovery, official RSA signature/SHA-256 verification,
  bounded extraction, semantic adapter checks and immutable runtime releases.
- Update only while idle; copy the stopped data generation before migration;
  retain the prior runtime and its matching data for rollback.
- Stable application URL: `http://127.0.0.1:8000/`.
- Configuration workbench: `http://127.0.0.1:8000/_bridge/`.

Compatibility is verified, not assumed. A future upstream signing key, binary
layout, identity flow, API or tool protocol can change. An unsupported change
blocks the candidate and retains the current version. There is no promise that
every future version or every model supports every feature without adaptation.

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
key for that profile. Language changes never translate model IDs or scientific
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

## Update and rollback

By default, the running service checks the pinned official `latest` channel
every six hours and activates only a validated, idle candidate. Use the
workbench or the CLI to check immediately:

```bash
node src/cli.mjs check
node src/cli.mjs status
node src/cli.mjs rollback
```

Rollback selects the previous runtime **and its previous data snapshot**. Work
created after the upgrade remains in the newer generation but is not present in
the older snapshot. Generations are not automatically deleted. See
[operations](docs/operations.md) for recovery and [architecture](docs/architecture.md)
for trust boundaries. The installation/validation record is in
[verification](docs/verification.md).

## Focused development checks

```bash
npm run check
npm run check:version
npm run test:protocol
npm run test:update
npm run test:workbench
```

These exercise only CS-Switch's changed protocol, gateway and update contracts.
They do not run the upstream scientific application's global test suite.
The `scripts/verify-scientific-tools.mjs` integration tool uses a clearly marked
local model-wire fixture with real application tool execution. It is not a real
external-model or scientific-quality benchmark.

`node scripts/verify-installed.mjs` performs read-only runtime/frontend/sandbox/
environment checks. `verify-installation.mjs ORIGINAL_BINARY NEW_ISOLATED_HOME`
tests attachment, stop/start and frontend access with isolated data, not a paid
model request.

## Version and PR policy

CS-Switch starts at **v0.0.1**. Each PR increments the smallest field exactly
once relative to the current base: v0.0.1 → v0.0.2 → v0.0.3. Fields carry at 99:
v0.0.99 → v0.1.0 and v0.99.99 → v1.0.0. This is the user's sequential PR release
counter; schema/API compatibility is tracked independently.

Run `npm run version:next` once per new PR. Further commits in that PR do not bump
again. Before merging an overlapping/stale PR, update its base and choose the
next unused number. CI checks package/lockfile consistency and requires exactly
the next number against the PR base. Display versions and Git tags use a `v`
prefix; package.json stores the numeric authority. Claude Science's upstream
version and its automatic updates do not increment the CS-Switch version.

## License and distribution boundary

CS-Switch's first-party source is available under the [MIT License](LICENSE).
Dependencies retain their own licenses. Claude Science / Operon binaries,
application code, assets, trademarks and services are not relicensed by this
project and are not included in the repository. See
[third-party notices](docs/third-party-notices.md).

The `private: true` package flag only prevents accidental npm publication; it
does not limit the MIT license or public GitHub access. This release does not
publish a package to npm.
