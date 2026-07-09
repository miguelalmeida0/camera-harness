# Gate 1A Architecture Lock

## Decision

Gate 1A may implement live local perception only as an adapter into the existing replay-tested v0 event contract. The live path is accepted only when it records symbolic traces that replay through `packages/evals/bin/darkquest-eval.mjs` with deterministic results.

The protected path is:

```text
camera/browser local perception
-> LocalObservationFrame
-> event stabilizer
-> valid v0 symbolic event
-> replay-compatible trace
-> pure quest reducer
-> HUD command stream
-> replay harness
```

The quest engine must be a pure reducer:

```ts
nextState = reduceQuestState(previousState, stableEvent);
```

No cinematic HUD polish, direct live state mutation, hidden cloud fallback, or raw-media persistence is approved before this path passes with a recorded live symbolic trace.

## Why This Is The Right Architecture

Gate 0B proved that replay fixtures can catch vague event assertions, out-of-order quest evidence, hidden model calls, memory-policy violations, raw-media flags, HUD uncertainty hiding, and nondeterminism. Gate 1A must preserve that falsifiability while replacing hand-authored symbolic input with locally observed symbolic input.

This lock keeps the expensive and ambiguous part of the system at the edge. Camera perception can be noisy, but the rest of DarkQuest receives only typed, validated, replayable events. That protects capability-per-dollar, latency, privacy, debuggability, and architecture taste:

- LLM/VLM calls remain off the hot path.
- State changes are reproducible without a camera.
- Privacy checks scan symbolic artifacts, not raw desk media.
- HUD progress can be audited back to event evidence.
- Perception experiments cannot silently become quest truth.

## Alternatives Rejected

| Alternative | Rejection reason |
| --- | --- |
| Let live perception call quest APIs directly. | Bypasses replay validation and lets camera-loop bugs mutate state without a stable event artifact. |
| Let the HUD infer progress from live observations. | Creates a second state machine and can hide uncertainty or show completion without accepted evidence. |
| Store raw frames for later debugging by default. | Violates the privacy boundary and makes replay safety depend on media retention. |
| Allow cloud VLM fallback during Gate 1A. | Reintroduces cost, latency, privacy, and nondeterminism before local symbolic traces are proven. |
| Promote `event-schema.v1.md` during live adapter work. | Creates schema drift from the Gate 0B runner. Gate 1A is frozen to `event-schema.v0.md`. |
| Accept live traces with empty or vague expected outputs. | Recreates the false-confidence problem fixed in Gate 0B. |

## Required ECC Skills

The local workspace does not contain the named ECC skill checkout. The binding ECC-aligned constraints are therefore taken from the project request and existing architecture docs:

| Skill | Gate 1A use |
| --- | --- |
| `agentic-engineering` | Keep perception, stabilization, quest state, HUD, memory, and model routing as separate agents/boundaries. |
| `agent-harness-construction` | Route every accepted live behavior through schemas, fixtures, reports, and replay artifacts. |
| `agent-architecture-audit` | Treat schema drift, hidden cloud paths, quest impurity, raw media leakage, and adapter ambiguity as release blockers. |
| `cost-aware-llm-pipeline` | Require zero LLM/VLM calls in normal Gate 1A traces. |
| `context-budget` | Keep state-bearing artifacts compact and symbolic; exclude raw frames and verbose perception debug payloads. |
| `architecture-decision-records` | Require ADRs for state-bearing schema changes, raw-media retention, model-owned state, or replay-first gate changes. |
| `latency-critical-systems` | Keep the hot path local, bounded, measured, and nonblocking. |

## Interfaces And Schemas

### Frozen State-Bearing Contracts

| Contract | Gate 1A status |
| --- | --- |
| `docs/contracts/event-schema.v0.md` | Frozen state-bearing event schema. |
| `docs/contracts/replay-fixture-schema.v0.md` | Required export target for live symbolic traces. |
| `docs/architecture/gate-1A-schema-freeze.md` | Schema-change and vocabulary lock. |
| `docs/architecture/live-perception-adapter-boundary.md` | Adapter boundary and privacy rules. |
| `docs/evals/gate-1A-live-trace-acceptance.md` | Pass/fail rules for live symbolic traces. |

`docs/contracts/event-schema.v1.md` is not a Gate 1A state-bearing contract. It may remain as reference material, but live implementation must not emit v1-only fields or envelope names into replay input, quest state, HUD progress, memory, or model routing.

### Boundary Ownership

| Layer | May consume | May emit | Forbidden |
| --- | --- | --- | --- |
| Camera/browser perception | Browser camera frames in memory | `LocalObservationFrame` | Cloud model calls, quest transitions, HUD progress, persisted raw frames |
| Live perception adapter | Local observations, calibration profile | v0 perception events only | Quest events, HUD events, memory writes, model routes |
| Event stabilizer | Local observation frames | v0 stable events | Quest state truth, side effects, raw media evidence |
| Live trace recorder | Validated v0 events and symbolic outputs | `darkquest.replay_fixture.v0` export | Raw video/audio/frame/screenshot/notebook text |
| Quest engine | Previous quest state, one stable v0 event | Next quest state | Clock reads, random values, storage, network, camera, model calls |
| HUD engine | Quest state and accepted evidence IDs | HUD command records/events | State truth, hidden progress, uncertainty suppression |
| Memory gate | Evidence-backed write candidates | Approved or rejected memory write records | Raw-media memory, unevidenced writes, unbounded TTL |
| Model router | Symbolic uncertainty and budget context | Route decision records | Hot-path visual state, continuous video, hidden calls |

### Pure Quest Reducer Contract

The reducer must be referentially transparent: the same `previousState` and `stableEvent` produce the same `nextState`.

Forbidden inside `reduceQuestState`:

- `Date.now()`, `new Date()`, `performance.now()`, timers, or wall-clock reads;
- `Math.random()`, UUID generation, nondeterministic ordering, or ambient counters;
- file, database, browser storage, DOM, camera, audio, network, model, or memory-gate access;
- mutation of `previousState` or mutation of `stableEvent`;
- direct HUD, memory, model, or trace writes.

Allowed:

- deterministic guard checks from `docs/architecture/focus-ritual-state-machine.md`;
- reading fields on `previousState` and `stableEvent`;
- returning the next immutable state.

HUD commands, transition records, memory candidates, and route requests must be pure data derived from accepted state and event evidence. They may be emitted by separate pure functions or by a wrapper that records returned data, but they must not be hidden side effects of the reducer.

### Adapter Ambiguity Rule

If a live observation can map to more than one state-bearing event, the adapter must fail closed:

1. hold state unchanged;
2. emit `confidence.changed` or `scene.uncertain` when valid under v0;
3. record a symbolic diagnostic outside replay `input_events`;
4. wait for clearer local evidence, reset, or explicit human correction.

The adapter must not choose the most convenient event to advance the quest.

## Failure Modes

| Failure mode | Required detection | Required behavior |
| --- | --- | --- |
| Schema drift from v0 | Event validation against `event-schema.v0.md` and fixture strict top-level checks | Fail export or replay before quest/HUD. |
| Hidden cloud/model path | `llm_calls`, `vlm_calls`, model route records, and fixture privacy checks | Fail Gate 1A unless a future fixture explicitly permits the call. |
| Quest-engine impurity | Reducer contract review and future unit/static checks | Block merge/demo until reducer is pure and replay deterministic. |
| Raw-media leakage | Privacy scanner across trace, fixture, payloads, evidence refs, memory writes | Block write/export and fail privacy result. |
| Adapter emits downstream events | Producer/type allowlist on live adapter output | Reject event before trace or quest. |
| HUD hides uncertainty | Replay check for `scene.uncertain` plus `show_uncertain_state` | Fail replay. |
| Memory write lacks evidence | Memory policy checker | Fail replay. |
| Expected outputs are vague | Gate 0B matcher hardening | Fail with assertion-too-broad codes. |
| Live trace does not replay | `darkquest-eval replay --repeat 3` | Keep demo/HUD polish blocked. |

## Cost/Latency Impact

Normal Gate 1A expected model cost is `$0.00`: `llm_calls = 0`, `vlm_calls = 0`, `estimated_cost_usd = 0`.

Latency budget remains local:

| Segment | Gate 1A target |
| --- | ---: |
| Camera frame to local observation | `16-50ms` |
| Observation to stable event | `100-300ms` depending on stabilization window |
| Stable event to quest reducer output | `0-10ms` |
| Quest state to HUD command record | `16-50ms` |
| Replay of exported live fixture | `<= 1000ms` unless fixture raises the explicit metric |

The live adapter must record latency/cost fields even when cost is zero. Missing latency/cost records are not a cosmetic problem; they are a gate failure because the system becomes unobservable.

## Handoff To Next Agent

### PARALLAX

Implement live local perception behind `packages/perception/live-perception-adapter` without emitting quest, HUD, memory, or model events. Normalize zones before v0 validation. Record symbolic traces only. Ambiguous observations hold state or emit uncertainty; they never advance the quest by guess.

### GAUNTLET

Wire Gate 1A live trace checks into the eval harness after the recorder exists. Required adversarial cases: v1 envelope drift, adapter-emitted quest event, raw frame evidence, unexpected VLM call, missing latency/cost record, vague live-trace matcher, uncertainty hidden by HUD, and nondeterministic exported trace.

### AXIOM

Reject schema changes, state-boundary changes, model-route exceptions, or raw-media retention until they have an ADR, a schema-change note, a positive fixture, and an adversarial fixture that proves the intended failure mode.
