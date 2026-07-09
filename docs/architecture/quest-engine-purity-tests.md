# Quest Engine Purity Tests

## Decision

The quest engine must expose state truth through a pure reducer:

```ts
nextState = reduceQuestState(previousState, stableEvent);
```

The reducer may compute deterministic next state, transition records, HUD command requests, memory write requests, and uncertainty/recovery state as explicit returned data. It must not call models, inspect raw media, write memory directly, read clocks, read global mutable state, or mutate its inputs.

## Required Tests

| Test name | Purpose | Expected pass behavior | Expected fail behavior |
| --- | --- | --- | --- |
| `quest_reducer_same_input_same_output` | Proves deterministic output. | Two calls with deep-cloned identical `previousState` and `stableEvent` produce deeply equal outputs. | Output differs, generated IDs differ, timestamps differ, or hidden counters change. |
| `quest_reducer_rejects_unknown_event` | Proves reducer trusts v0 event validation and rejects unknown state inputs. | Unknown event type returns unchanged state plus explicit rejection/uncertainty result. | Unknown event completes or advances any step. |
| `quest_reducer_rejects_out_of_order_step` | Prevents skipping required Focus Ritual steps. | Future-step evidence before active step returns unchanged state or ordered-step failure. | Notebook/writing/typing evidence completes before prior required steps. |
| `quest_reducer_no_model_calls` | Keeps models outside state truth. | Model client/router spies are not called during reducer execution. | Any LLM/VLM/provider/model-router call occurs inside reducer. |
| `quest_reducer_no_raw_media_access` | Keeps quest logic symbolic. | Files, image refs, camera APIs, DOM/canvas/video objects are never accessed. | Reducer reads raw frame bytes, image paths, media blobs, camera objects, or screenshots. |
| `quest_reducer_no_direct_memory_write` | Keeps memory gate separate and evidence-backed. | Reducer returns memory write candidates only as data when allowed; no store write happens. | Reducer writes to memory, local storage, database, file, or global memory object. |
| `quest_reducer_requires_payload_support` | Prevents broad event-family matches from completing steps. | Completion requires event-specific payload facts and confidence thresholds. | `object.moved` alone completes phone/pen step without object/zone payload support. |
| `quest_reducer_emits_uncertainty_state` | Represents ambiguous conditions honestly. | Below-threshold or ambiguous active-step evidence returns unchanged/pending state with uncertainty/recovery data. | Reducer guesses progress or silently drops meaningful uncertainty. |
| `quest_reducer_does_not_complete_without_evidence` | Ensures quest completion cites supporting events. | `quest_complete` only after all ordered steps have accepted evidence IDs. | Quest completes with missing, empty, or unrelated evidence. |
| `quest_reducer_rejects_non_monotonic_trace` | Prevents replay order ambiguity at the runner/wrapper boundary. | Reducer wrapper rejects a trace where `timestamp_ms` decreases. | Out-of-order timestamps are reduced as if valid. |

## Side-Effect Probes

The test harness should stub or spy on:

- model/provider clients;
- model router;
- memory store and memory gate write methods;
- file system writes;
- browser storage;
- network/fetch;
- camera/media APIs;
- clock APIs;
- random/UUID generation.

Any call from `reduceQuestState` to those probes is a failure.

## Determinism Fixture Pattern

Use a symbolic v0 event and cloned state:

```ts
const previousState = deepFreeze(makeQuestState("phone_removal_pending"));
const stableEvent = deepFreeze(makeStableEvent("object.moved", {
  object_id: "obj_phone",
  object_type: "phone",
  from_zone_id: "zone_focus",
  to_zone_id: "zone_away",
  duration_ms: 640
}));

const first = reduceQuestState(previousState, stableEvent);
const second = reduceQuestState(previousState, stableEvent);
expect(first).toEqual(second);
expect(previousState).toEqual(makeQuestState("phone_removal_pending"));
```

## Completion Guard Tests

Each quest step needs a positive and negative guard test:

| Step | Positive evidence | Negative evidence |
| --- | --- | --- |
| `step_phone_away` | `object.moved` phone from `zone_focus` to non-focus zone, confidence `>= 0.86`. | `object.moved` missing object type, low confidence, or still in `zone_focus`. |
| `step_notebook_open` | `object.placed` notebook in `zone_notebook`, `dwell_ms >= 500`, confidence `>= 0.86`. | Notebook in wrong zone, short dwell, low confidence, or object type missing. |
| `step_pen_pickup` | `object.moved`/`object.placed` pen into `zone_notebook` or `zone_focus`, confidence `>= 0.86`. | Pen false positive, wrong zone, low confidence, or broad object event. |
| `step_write_three_bullets` | `gesture.detected` writing in `zone_notebook`, repetitions `>= 3`, window `>= 900ms`, confidence `>= 0.82`. | Writing before pen, short repetition, wrong zone, low confidence. |
| `step_start_typing` | `gesture.detected` typing in `zone_keyboard` or `zone_laptop`, window `>= 900ms`, confidence `>= 0.82`. | Typing before writing, wrong zone, low confidence. |
| `step_quest_complete` | All prior steps complete in order with accepted evidence. | Any missing prior step or unsupported final completion event. |

## Gate Requirement

These tests must pass before `packages/quest-engine` can be treated as a live dependency. Until the package exists, this document is the implementation contract and code-review checklist.
