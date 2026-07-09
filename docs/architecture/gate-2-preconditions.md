# Gate 2 Preconditions

Current Gate 2 status: `BLOCKED_MISSING_PHYSICAL_TRACE`.

Gate 2 minimal HUD polish can begin only if all required conditions are met.

## Allowed Work While Blocked

- physical capture operator flow;
- physical trace validation;
- Gate 1C rerun;
- static validation closure;
- Gate 1D local tryable app work;
- local user testing through Gate 1D with manual confirmation disclosed.

## Not Allowed While Blocked

- minimal HUD polish;
- cinematic HUD polish;
- visual effects;
- portfolio demo claims;
- production-quality claims.

## Gate 1D Boundary

Gate 1D can allow local user testing when the app is tryable enough to start camera, calibrate zones, start Focus Ritual, emit symbolic events, show debug HUD state, record, export trace JSON, and run validation.

Gate 1D does not approve:

- minimal HUD polish;
- cinematic HUD polish;
- visual effects;
- portfolio claims;
- autonomous vision claims from manual confirmation;
- production-quality claims;
- fake physical provenance;
- any relaxation of Gate 1C.

## Required Gate State

- Gate 0B is `PASS`.
- Gate 1A is `PASS` or accepted `PASS_WITH_DISCLOSURE`.
- Gate 1B is `PASS` or accepted `PASS_WITH_DISCLOSURE`.
- Gate 1C is `PASS` or accepted `PASS_WITH_DISCLOSURE`.

## Required Physical Evidence

- physical trace exists;
- physical trace replays deterministically;
- physical trace provenance passes and is not browser-origin synthetic substitution;
- occlusion recovery passes;
- camera bump/reset passes;
- zero raw media persistence;
- zero LLM/VLM calls;
- HUD honesty checks pass;
- browser latency is measured.

## Required Static Evidence

- TypeScript validation passes, or a temporary static-validation waiver exists;
- waiver scope is limited to minimal HUD polish;
- waiver does not waive physical webcam trace evidence;
- waiver does not waive privacy or model-call scanners.

## Required Approval

Harness, Evaluation, Memory and Safety must approve minimal polish scope.

Cinematic HUD polish remains blocked.

## Gate 2 Start Rule

Gate 2 minimal HUD polish can begin only after:

- physical trace exists;
- physical trace replays deterministically;
- Gate 1C returns `PASS` or accepted `PASS_WITH_DISCLOSURE`;
- privacy, model, memory, and HUD checks pass;
- raw media persistence count is `0`;
- LLM/VLM calls are `0`;
- static validation passes or waiver is explicitly accepted.

Gate 1D local tryability is useful input to Gate 2, but it is not a Gate 2 precondition substitute. Gate 2 remains blocked until Gate 1C physical trace passes or is accepted with allowed disclosure.

## Blocking Conditions

Gate 2 is blocked if:

- physical trace is missing;
- physical provenance is absent or fake;
- raw media persists;
- any LLM/VLM call occurs;
- HUD hides uncertainty;
- quest completes without supporting events;
- TypeScript validation is missing and no waiver exists;
- requested polish cannot be replayed.
