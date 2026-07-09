# Gate 1D Pass/Fail Rules

## Claim

Gate 1D tests whether the local browser app is tryable enough for an operator to generate the required physical trace for Gate 1C.

Gate 1D does not approve minimal HUD polish. Gate 1D does not approve cinematic polish. Gate 1D does not replace Gate 1C. Gate 1D cannot support portfolio or demo claims.

## Automated Source Check

Run:

```sh
npm run gate:1d
```

The command is a static/source-level verifier. It checks that the prototype has the required controls, panels, manual confirmation disclosure, export code, trace origin generation, symbolic event creation, quest state logic, required zones/objects, validation instructions, and no obvious raw media export or model-call hooks.

The command writes:

```text
runs/gate-1d-latest.json
```

## Pass Criteria

Gate 1D passes only if a local operator verifies all of the following:

- app can be launched or launch instructions are valid
- local app starts
- camera can be turned on
- calibration UI exists
- required zones can be set
- required objects can be assigned
- Focus Ritual can be started
- recording can be started
- recording can be stopped
- all five manual ritual confirmations exist
- uncertainty and reset controls exist
- symbolic event timeline updates are implemented
- quest state update logic exists
- all ritual steps can emit symbolic events
- manual local confirmation is clearly labeled if used
- quest state updates
- HUD event timeline updates
- privacy status is visible
- model-call status is visible
- cost status is visible
- trace can be exported
- exported trace shape is compatible with Gate 1C
- physical provenance checkbox exists
- exported trace contains no raw media
- exported trace contains no model calls
- validation command exists
- user gets clear next commands

## Fail Criteria

Gate 1D fails if any of the following are true:

- camera is the only working feature
- user cannot calibrate
- user cannot start quest
- user cannot emit events
- quest state does not update
- trace cannot export
- physical provenance can be set without operator confirmation
- raw media is stored
- LLM or VLM call occurs
- manual confirmation is hidden or mislabeled as automatic vision

## Verdicts

| Verdict | Rule |
| --- | --- |
| `NOT_TRYABLE` | App cannot complete the operator path from camera start through trace export, or the checklist has not been completed. |
| `TRYABLE_WITH_MANUAL_CONFIRMATION` | App can complete the path using visible manual confirmation and symbolic events. |
| `TRYABLE_WITH_LOCAL_PERCEPTION` | App can complete the path using local perception without manual step confirmation. |
| `TRACE_EXPORT_WORKING` | Exported trace validates, replays, and can feed Gate 1C, but Gate 1C may still block on static disclosure. |
| `FAIL` | Any privacy, model-call, raw media, hidden confirmation, or trace integrity violation is observed. |

`TRYABLE_WITH_MANUAL_CONFIRMATION` does not mean autonomous vision works. It means the app has enough visible manual controls and symbolic trace plumbing for the operator to try the local capture path.

## Required Zones

- `phone_zone`
- `notebook_zone`
- `pen_zone`
- `keyboard_zone`
- `neutral_zone`
- `off_desk_zone`

## Required Ritual Path

The operator must be able to perform and observe:

1. Start camera.
2. Calibrate zones.
3. Assign required objects.
4. Start Focus Ritual.
5. Start recording.
6. Emit phone moved away event.
7. Emit notebook opened event.
8. Emit pen picked up event.
9. Emit writing motion event.
10. Emit typing motion event.
11. Observe quest complete state.
12. Stop recording.
13. Export trace.
14. Validate trace.

## Exported Trace Checks

Gate 1D exported trace must be checked for:

- file exists
- valid JSON
- valid replay fixture shape
- valid event schema
- required `trace_origin`
- no raw media
- no screenshots
- no base64 images
- no audio
- no OCR or notebook text
- no LLM calls
- no VLM calls
- unique event IDs
- monotonic timestamps
- expected Focus Ritual event sequence
- browser latency records if physical export

## Approval Boundary

Passing Gate 1D only allows user testing and physical-trace generation work. Minimal HUD polish, cinematic HUD polish, visual effects, portfolio demo claims, and production-quality claims remain blocked until Gate 1C passes.
