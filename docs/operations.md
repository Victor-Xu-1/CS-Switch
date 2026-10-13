# Operations

## Files and ownership

Under `CS_SWITCH_HOME`:

| Path | Purpose |
| --- | --- |
| `config.json` | Ports, Bun path, proxy, update policy |
| `providers.json`, `providers.key` | Provider configuration and separate encryption key |
| `state.json` | Committed runtime/data generation pair and prior pair |
| `releases/` | Immutable runtime files plus integrity manifest |
| `d/` | Preserved scientific data generations (short paths for Unix sockets) |
| `downloads/`, `adopted/` | Official package receipts and isolated preparation |
| `discovery.json` | Latest update-check outcome, including blockers |
| `logs/` | Runtime logs, never intentionally containing provider keys |
| `inbox/` | Optional locally reviewed prepared-runtime descriptors |

Back up providers.json and providers.key together. Never upload either to
GitHub. User data and runtime logs are also excluded from the repository.

## Service commands

Ordinary users can start/stop/open Claude Science from the workbench. Stopping
the scientific process leaves CS-Switch running. The choice persists across
service restarts. Runtime boot errors remain visible in the workbench.

```bash
systemctl --user status cs-switch.service
journalctl --user -u cs-switch.service -n 50 --no-pager
systemctl --user restart cs-switch.service
systemctl --user stop cs-switch.service
```

Do not restart while analyses are running. Normal updates use the live idle
check. The launcher stops its own process group; it does not kill PIDs based
on an old PID file or process-name matching.

## Common states

- **provider_unconfigured**: add and activate a model profile.
- **key_unavailable**: restore the matched local encryption key, or re-enter
  the provider API key. Do not overwrite the encrypted store to hide the error.
- **provider_http_error**: verify provider endpoint, model, quota and supported
  reasoning/tool parameters. HTTP 401/429/5xx stays visible.
- **adapter_required**: keep the working version and update the semantic
  adapter after reviewing the changed upstream contract.
- **release_signature / release_integrity**: do not run that artifact. Verify
  the official publisher/signing-key change before updating trust material.
- **runtime_busy**: the current task is preserved; retry after it completes.
- **environment failed**: inspect the original environment status/logs and
  package network configuration. TLS validation and sandboxing remain enabled.
- **search_unavailable**: the search site is blocked, challenged or changed its
  response format. The gateway reports this as a tool failure.

## Safe rollback

Use `node src/cli.mjs rollback` or the workbench while idle. It switches both
runtime and data. The newer data generation remains recoverable. Do not
manually point an old executable at a newly migrated database.

If a process or power failure interrupts an update, the next startup loads the
last committed pair in `state.json`. If startup itself fails, stop the service
before inspecting state and restore a matching retained pair. Do not delete
databases, keys or Conda caches as a generic repair.

For a previously managed application, use **Start Claude Science** in the
workbench. Initial installation attachment is intentionally disabled after a
runtime/data lineage exists; changing an existing runtime uses the validated
update or matched-snapshot rollback path, not an unrelated data replacement.

## Publishing

Publish only this source tree. The owner selected public MIT distribution for
CS-Switch's first-party code. Review tracked files and reachable Git history for
secrets and private data before publication. Do not package the upstream application,
the verification state directories or user credentials. A GitHub source push
is distinct from a release artifact and from a passed external-model test.
