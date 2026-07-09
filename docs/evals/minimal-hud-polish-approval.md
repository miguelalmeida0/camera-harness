# Minimal HUD Polish Approval

## Approval Rule

Minimal state-backed HUD polish can be approved only if:

- Gate 0B is `PASS`
- Gate 1A is `PASS` or `PASS_WITH_DISCLOSURE`
- Gate 1B is `PASS` or `PASS_WITH_DISCLOSURE`
- Gate 1C is `PASS` or `PASS_WITH_DISCLOSURE`
- Gate 1E does not report source or dry-run failures
- Gate 1F does not report operator-readiness failures
- physical trace passes replay
- privacy, model-call, memory, and HUD honesty checks pass
- raw media persistence count is `0`
- LLM calls are `0`
- VLM calls are `0`
- TypeScript issue is resolved or explicitly waived

## Allowed After Approval

- layout polish
- typography
- color system
- confidence bands
- event timeline presentation
- recovery panel styling
- state-backed progress animation
- local latency/status indicators

## Still Forbidden

- fake progress
- cinematic completion without state
- hidden uncertainty
- hidden low confidence
- implied VLM/cloud intelligence
- raw camera artifacts
- raw frame exports
- screenshots in replay artifacts
- model calls in the hot path

## Current Status

`APPROVED_WITH_DISCLOSURE`

minimal state-backed HUD polish: approved_with_disclosure

Latest Gate 1C verdict: `PASS_WITH_DISCLOSURE`.

Latest Gate 1E verdict: `TRACE_EXPORT_READY`.

Latest Gate 1F verdict: `TRACE_EXPORT_GUIDED`.

Disclosure evidence:

- physical trace: `PASS`
- physical trace origin: `PASS`
- replay: `PASS`
- privacy: `PASS`
- model calls: `PASS`
- memory: `PASS`
- HUD honesty: `PASS`
- waiver: accepted
- static validation: `FAIL`, waived with disclosure
- LLM calls: `0`
- VLM calls: `0`
- raw media persistence count: `0`
- latest report: `runs/gate-1c-latest.json`

Approval position:

- minimal state-backed HUD polish approved with disclosure
- no cinematic HUD polish approved
- no portfolio demo claims approved
- no autonomous vision claims approved
- no production-quality claims approved
- scope: UI clarity, status display, checklist, event timeline, export/validation UX
- manual confirmation disclosure must remain visible
- static waiver disclosure must remain visible where applicable

## Gate 1D/1E/1F Boundary

Gate 1D, Gate 1E, and Gate 1F may allow user testing and usability hardening. Gate 1C `PASS_WITH_DISCLOSURE` unlocks only minimal state-backed HUD polish.

Allowed after Gate 1C `PASS_WITH_DISCLOSURE`:

- usability controls
- debug HUD clarity
- making app controls usable
- calibration UI
- recording/export UI
- validation instructions
- failure diagnostics
- provenance and dry-run validation hardening
- operator guidance, bug report export, save-path assistance, and event-sequence inspection
- status display clarity
- checklist clarity
- event timeline clarity
- export/validation UX clarity

Still blocked:

- cinematic HUD polish
- portfolio demo claims
- autonomous vision claims
- production-quality claims

## Accepted Disclosure Path

Minimal state-backed HUD polish may proceed because:

- Gate 1C is `PASS_WITH_DISCLOSURE`
- static validation failure is waived with disclosure
- the UI explicitly states manual local confirmation and not automatic vision
- privacy/model status remains visible
- raw media persistence and model calls remain zero

Required visible disclosure:

```text
Minimal HUD polish is enabled with disclosure. Static package build validation is waived. This app does not claim autonomous vision; manual confirmations are clearly labeled.
```

## Gate 2 Boundary

Gate 2A is allowed only for minimal state-backed HUD polish evaluation. Cinematic HUD polish, portfolio-grade claims, model-assisted recovery claims, autonomous perception claims, and production-quality claims remain blocked.
