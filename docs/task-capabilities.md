# Task execution capabilities

CS-Switch v0.0.5 adds task adapters alongside the original application. It does
not edit the installed original executable, original frontend, scientific tool
implementations, approval rules or sandbox. Account and billing features are
outside this scope. The original application executes Python/R/MCP and owns files,
artifacts, agents and user approvals; the bridge supplies missing inference and
web/document protocol behavior.

## Capability matrix

| Task path | Bridge behavior | Evidence / boundary |
| --- | --- | --- |
| Search | Converts recognized native web-search definitions into provider function calls; executes public search and returns source URLs/excerpts | Real original 0.1.62 + MiMo returned 8 results. Search-site availability/challenges remain external; failures are explicit |
| Read a page | Adds a bridge reader when an original request enables search but does not offer its own reader; never replaces a named client tool | Real original web-fetch receipts contain the PubMed About page; not merely a model claim |
| Web HTML/text/PDF | Fetches only public standard-port URLs already present in user/tool context; validates/pins DNS destinations and every redirect; extracts bounded content | Real NCBI HTML read; PDF parser exercised on generated fixture; images-only PDFs require OCR/vision |
| Direct document input | Converts plain-text, embedded-content and base64/public-URL PDF blocks into labelled text with page markers; works in both API families | Actual DeepSeek OpenAI and Anthropic requests and MiMo OpenAI requests read the PDF measurement correctly |
| Structured output | Supplies the schema to the model and validates the complete JSON before delivery; no coercion or fabricated replacement | Real DeepSeek and MiMo returned the expected value. DeepSeek uses its JSON-object mode; generic endpoints use instructions plus local validation |
| Mixed web/client tools | Runs bridge web calls, returns their receipts with original client calls; original application performs execution and approval | Actual search/fetch -> Python -> save_artifacts chain completed; focused native/OpenAI continuation regressions |
| Evidence across turns/review | Persists bounded page evidence in CS-Switch and restores it from a source-link reference when the original application strips hosted-tool blocks | Original 0.1.62 was observed removing web-fetch calls/results from later model and reviewer input. Restart/stripping regression covers restoration without changing original code |
| Streaming | Preserves normal OpenAI text/reasoning SSE and native pass-through SSE; tool identities/arguments are completed before emission | Split-name and malformed/truncated stream regressions. Native emulated web turns and structured outputs are buffered until complete/valid |
| Reasoning | Maps documented DeepSeek, MiMo and Qwen controls; preserves explicit thinking choices and reasoning history | MiMo official hosts recognized for existing compatible profiles; other endpoints are not inferred from model names |
| Latest installed runtime | Uses semantic AST boundaries rather than an exported minified alias; refuses missing/ambiguous matches | Official standalone 0.1.62 attached, started, stopped/restarted; original binary SHA-256 unchanged |

## Limits and error semantics

- Web requests: 30 seconds, four redirects, 8 MiB, public IPs only. Proxy setups
  resolve public hosts through Cloudflare HTTPS DNS before pinning the actual
  destination; the original TLS hostname/certificate is retained. Cookies,
  model API keys and local credentials are never forwarded to fetched pages.
- Web tools: at most five uses per tool and twelve provider rounds. `max_uses: 0`
  remains disabled. Domain restrictions apply at every redirect. Content budgets
  are conservatively bounded by UTF-8 bytes; excerpts are labelled explicitly.
- PDF: 8 MiB, 100 pages, 200000 extracted characters, 20-second worker timeout
  and 128 MiB worker heap. No PDF scripts, attachments or embedded actions execute.
  Text extraction is not OCR or visual interpretation; empty text pages are
  labelled. Unsupported, encrypted or malformed documents fail explicitly.
- JSON Schema: bounded schema, local references/standard formats, strict schema
  compilation and exact validation. Remote schema downloads, type coercion,
  default injection and silently removing extra properties are disabled. Invalid
  JSON/schema results never emit a successful structured response. Array/scalar
  schemas use an internal JSON-object envelope only where DeepSeek needs one;
  the validated source value is returned to the caller.
- Task transport has a five-minute overall deadline; individual web/PDF limits
  remain shorter. Connection probes retain their two-minute deadline. User
  cancellation propagates to provider requests and document workers. No retry
  can accidentally duplicate an execution tool.
- `web-evidence/` is a private cache under the CS-Switch state home: at most 256
  page receipts, usable for 14 days. Opaque source-link fragments identify evidence
  without exposing credentials. Missing/expired evidence is reported explicitly
  and requires a fresh read. The original scientific artifact/database is not
  changed or removed by this cache's eviction policy.
- Plain source URLs and page text are preserved. This does not reproduce
  Anthropic encrypted citation tokens, proprietary dynamic code filtering,
  geographic search personalization, authenticated browsing or JavaScript browser
  automation. These are not silently represented as equivalent capabilities.
- Model context limits, image support and correctness still belong to the selected
  model. Native hosted code execution is not replaced with arbitrary execution
  outside the original Python/R/MCP sandbox. Existing local scientific tools remain
  the execution authority.

## Reproducible acceptance

`node scripts/verify-task-bridge.mjs STATE_HOME PROVIDER [PDF_PATH] [--anthropic] [--web]`
performs bounded real model calls through the production ModelProxy, without
changing the active profile. `--anthropic` is restricted to the same official
DeepSeek host. A fixture PDF must contain the acceptance measurement 37. The
fixture is input data; the real model must read it and the bridge must validate
its response. Keys and document bodies are never printed by the script.

`node scripts/start-web-verification.mjs ORIGIN [--no-thinking]` submits a small
original task that searches, reads a page, writes JSON through Python and saves
the artifact. Inspect each execution approval before allowing it once. Validate
the original stored tool receipts and artifact bytes, not just the final model
summary. This is important: initial MiMo and DeepSeek runs lost fetch evidence in
later turns/reviewer input because original 0.1.62 stripped those new hosted-tool
blocks. Sanitized input-shape tracing confirmed the cause. The bridge evidence
cache repairs that task contract without modifying the original application.

No task data, generated PDFs, runtime bundles or screenshots belong in Git.
