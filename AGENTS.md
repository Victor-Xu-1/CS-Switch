# CS-Switch

Independent local compatibility manager, not an official Anthropic product.
Node >=22.19, with Undici for explicit proxy-aware HTTP. Linux/WSL is the supported process-management platform.
Only first-party bridge code belongs in this repository; upstream binaries,
recovered bundles, credentials, databases and generated evidence stay outside it.

Allowed roots: src, web, tests, scripts, docs, .github, package.json,
package-lock.json, README.md, AGENTS.md, LICENSE, .gitignore, .env.example.
package.json is the only product-version authority. Runtime manifests and
persisted state have independent schema versions. npm is the package authority.
The main agent owns contracts and integration; no other task owns these files.

Keep protocol, gateway, runtime and update logic separate. Never patch unknown
upstream versions speculatively or disable upstream sandbox/approval controls.
Never declare an HTTP 200 to be model or scientific acceptance. Never log keys,
prompts or response content. Test changed modules and direct contracts only.

Updates must retain the active runtime until candidate validation succeeds.
Database rollback selects the matching prior data generation; it must not open
newer data with an older binary. Runtime and state ownership must be explicit.
Published artifacts may not contain upstream proprietary code or user data.
The first-party source is MIT-licensed and the repository is intended to be
public. This does not relicense the original application or external services.

Version policy: first release v0.0.1. Every PR advances exactly once from its
current integration base: v0.0.1 -> v0.0.2, with patch/minor carrying at 99.
Example: v0.0.99 -> v0.1.0; v0.99.99 -> v1.0.0. Store the numeric version only
in package.json (npm keeps the lockfile synchronized); show a v prefix in the
workbench and Git tags. Do not bump for every commit or automatic upstream
Claude Science update. Update a stale PR against the latest base before merging.
Claude Science versions are separate from CS-Switch release numbers.
