# Product quality standard and audit

CS-Switch targets the craft, usability and execution associated with Awwwards,
Webby Awards and FWA. These are design aspirations, not awards, nominations,
certifications or guaranteed judging outcomes. The scope is the CS-Switch-owned
workbench/backend, not redesigning the proprietary Claude Science frontend.

Reference lenses: [Webby software criteria](https://www.webbyawards.com/judging-criteria/),
[Awwwards evaluation](https://www.awwwards.com/about-evaluation/),
[FWA](https://thefwa.com/), and
[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Screenshots alone cannot establish full accessibility or scientific validity.

## Acceptance criteria

- One obvious primary action; no fixed five-step ceremony or invented readiness.
- Legible Chinese/English type, consistent spacing, visible focus, field-help
  associations, announced errors, comfortable 44px controls and reduced motion.
- Normal text contrast at least 4.5:1 on the actual background; responsive
  connected/form/error states at desktop and narrow viewport widths.
- Loading, saved/tested, running/stopped, environment-checking and error states
  must differ. Historical connection tests are not live model health claims.
- Failed/cancelled tests retain the previous connection. Endpoint changes cannot
  silently forward stored credentials. Activation and updates share a lock.
- Environment checks cannot block core controls or let old process results
  overwrite new process readiness. Request failures must remain visible.
- No P0/P1 finding may be relabelled as passed; fixes require a regression and
  directly related browser/API verification. External accounts/platforms not
  exercised must remain marked unverified.

## Audit round 1 — 2026-10-13 baseline v0.0.1

Fresh screenshots are stored outside Git with their associated audit notes.

| Step | Evidence | Finding | Initial health |
| --- | --- | --- | --- |
| 1. Connected workbench | 01-connected.png + computed styles | Clear primary action, but help/status text is only 10–11px and pale | Needs improvement |
| 2. Edit model connection | 02-connection-form.png + DOM | Values preserved and key hidden; help lacks explicit field association | Needs improvement |
| 3. Invalid endpoint | DOM error, 03-error-detail.png | Existing profile preserved; error announcement/focus insufficient | Needs improvement |
| Backend connection lifecycle | Three failing regression cases before fixes | Saved-key forwarding on endpoint change, ignored cancellation, commit/update race | Must fix |
| Environment readiness | Source/API path | Expensive checks are awaited by the primary status response | Must improve |

## Iteration record

Round 2 caught a conflicting hint: the field still said a saved key could be
reused after the API address changed. The hint now changes immediately, before
submission. Optional endpoint details for an existing custom provider also stay
collapsed until needed. Both retain the single primary connect action.

Measured in the same local audit session: three baseline status reads took
1665/1588/1659ms; three revised reads took 11/21/9ms while environment checks
continued separately. This is a local API measurement, not a universal latency
or frontend performance score.

## Round 3 — acceptance of the revised paths

| Step | Result | Evidence |
| --- | --- | --- |
| Connect/edit | Pass for audited paths | English desktop and 360px form; Chinese 390px connected view; persisted language and hidden saved key |
| Error recovery | Pass | New-address hint updates before submission; old key not transmitted; role=alert, notice focus, field association and invalid marker; 08-endpoint-error-en.png |
| Cancel a test | Pass | Local slow-response fixture aborted; active model retained; unit checks cover OpenAI and native Anthropic body cancellation |
| Start/open | Pass | Stopped state remains usable, then Start & open reaches original frontend; 09-stopped-en.png and 10-open-original.png |
| Keyboard/motion | Pass for inspected controls | 3px visible focus; 44px controls/52px primary action; reduced-motion emulation yields animation=none and transition=0s |
| Status/backend | Pass | Coalesced process-scoped checks, stale-response rejection, credential destination binding, shared activation lock |
| Latest independent executable | Pass for 0.1.60 | Official latest pointer 8db2454a on 2026-10-13; freshly attached unchanged standalone binary; Python/R and 20 MCP environment checks |
| Real third-party task | Pass | DeepSeek v4 pro completed Python, R, PubChem and CSV artifact task; 11-latest-real-task.png; exact record in verification.md |

The second review also caught response-body cancellation being misclassified as
a generic network failure; it now preserves cancellation semantics. An initially
overlong isolated state path was rejected by the original Unix socket constraint.
The verifier was rerun with a short new state path, preserving the failed attempt
for diagnosis. The workbench now gives specific bilingual remediation for this
condition, not a generic failure.

49 affected automated checks passed across nine selected files. Unchanged
protocol/search/release suites were not run in this pass. The same dependency-
based selection now controls PR CI; new tests and non-import UI/HTTP contracts
are included explicitly. No global upstream scientific suite was executed.

This is an evidence-based internal quality gate, **not a claim that the product
has won or is guaranteed to win an award**. Full screen-reader/user studies,
Safari/Firefox, native Windows/macOS runtimes, all scientific workflows, every
third-party provider and unknown future upstream versions remain unverified.
No Lighthouse score, full WCAG certification or independent jury assessment is
claimed. Screenshots from fixture previews are labelled as such and must not be
used as proof of real external-model inference. Operational screenshots and task
data remain outside the public repository.
