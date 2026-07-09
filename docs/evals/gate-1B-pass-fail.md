# Gate 1B Pass/Fail Rules

## Claim

Gate 1B tests whether DarkQuest can use real browser-local camera observation frames to produce symbolic-only traces that replay deterministically through the harness, including occlusion recovery and camera bump reset, while preserving zero raw media persistence, zero model calls, honest HUD state, valid memory policy, exact failure-code checks, and measured browser-path latency.

Cinematic HUD polish remains blocked until this gate passes.

## Required Fixtures

Gate 1B requires:

- `fixtures/replay/live/live_browser_focus_ritual_001.v0.json`
- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`

The browser fixture must include:

```json
{
  "trace_origin": {
    "source": "browser.local_camera",
    "raw_media_persisted": false,
    "cloud_calls_enabled": false,
    "manual_fixture": false
  }
}
```

## Verdict Rules

| Verdict | Rule |
| --- | --- |
| `BLOCKED_MISSING_BROWSER_TRACE` | `live_browser_focus_ritual_001.v0.json` is missing or lacks required browser origin metadata. |
| `BLOCKED_MISSING_RECOVERY_FIXTURES` | Browser trace exists, but occlusion recovery or camera bump reset fixture is missing. |
| `FAIL` | Required traces exist but replay, privacy, model, memory, HUD, browser-origin, recovery, or exact-code checks fail. |
| `PASS_WITH_DISCLOSURE` | Required traces pass, but TypeScript/static validation or browser latency measurement is incomplete. |
| `PASS` | Required traces pass, browser latency is measured within thresholds, adversarial fixtures fail exactly, and no build/static blockers remain. |

## Pass Conditions

- real browser-local observation frames are represented by browser-origin trace metadata
- browser-generated symbolic trace exists
- occlusion recovery fixture exists and passes
- camera bump/reset fixture exists and passes
- all three required fixtures replay deterministically 3 times
- privacy scan passes
- model-call scan reports `0` LLM calls and `0` VLM calls
- raw media persistence count is `0`
- HUD honesty checks pass
- memory checks pass
- cost/latency records exist
- browser-path p50 and p95 latency are measured
- TypeScript/build limitations are either fixed or explicitly reported as disclosures

## Browser Latency Requirements

Gate 1B requires browser-path metrics for:

- frame capture time
- observation extraction time
- adapter time
- stabilizer time
- event emission time
- HUD update time
- trace recorder time
- p50 end-to-end local path latency
- p95 end-to-end local path latency
- max end-to-end local path latency
- dropped frames
- event count
- uncertainty count
- scene reset count
- LLM call count
- VLM call count
- raw media persistence count

Thresholds:

- p50 local path latency `<= 75ms`
- p95 local path latency `<= 150ms`
- max local path latency `<= 300ms`
- LLM calls `0`
- VLM calls `0`
- raw media persistence count `0`

Nonzero dropped frames must be disclosed.

## Recovery Requirements

Occlusion recovery must prove:

- `scene.uncertain` appears during occlusion
- HUD emits uncertainty or recovery state
- quest does not falsely progress during occlusion
- tracking resumes after occlusion
- no cloud/VLM call occurs
- no raw media is persisted
- replay is deterministic

Camera bump/reset must prove:

- `scene.reset` appears after camera bump/reset
- HUD emits reset or recovery state
- calibration is invalidated or marked stale
- quest does not continue using stale zone truth
- recovery or recalibration event appears
- no cloud/VLM call occurs
- no raw media is persisted
- replay is deterministic

## Fail Codes

Gate 1B adversarial fixtures must match exact failure-code sets. Required new codes:

- `browser_trace_origin_missing`
- `quest_progress_during_uncertainty`
- `stale_zone_truth_after_reset`
- `browser_latency_missing`

Gate 1B also reuses Gate 1A failure codes for privacy, model, memory, HUD, schema, duplicate ID, timestamp, experimental event, and broad matcher failures.
