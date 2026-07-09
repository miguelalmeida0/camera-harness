# Gate 3B Action Suggestion Engine Results

## What changed

Gate 3B adds a local action suggestion layer on top of Gate 3A motion proxy signals. The browser still processes camera frames locally, downsampled in memory, and emits only symbolic suggestions/events.

The engine now ranks step-specific suggestions for the Focus Ritual:

- phone removal from `phone_zone` toward `off_desk_zone`
- notebook opening in `notebook_zone`
- pen pickup from `pen_zone`
- writing-like motion in `notebook_zone`
- typing-like motion in `keyboard_zone`
- scene uncertainty/reset suggestions when motion is noisy or global

## How it works

The camera path computes zone motion scores, keeps a short in-memory motion history, then derives dwell, burst, and directional-change proxies. Those proxies are mapped to the current quest step only. Future-step suggestions are suppressed.

Suggestions are ranked by confidence and step relevance. Each suggestion has:

- `suggested_event_type`
- `suggested_action`
- `quest_step`
- `zone_id`
- `object_id`
- `confidence`
- `reason`
- `evidence`
- `expires_at_ms`
- `accepted`
- `rejected`

## UI behavior

The Camera Suggestions panel shows the suggestion, confidence, zone, reason, evidence summary, expiry, and Accept/Reject controls. The label remains:

`Camera suggestion - requires confirmation.`

Local Perception Tuning exposes motion sensitivity, suggestion threshold, cooldown, max active suggestions, and an optional symbolic motion-score display. These controls do not expose or persist frames.

## Acceptance and rejection

Accepting a suggestion routes through the same symbolic event path as manual local confirmation. Accepted events include both:

- `local_signal`
- `human_correction`

Rejecting a suggestion dismisses it, starts cooldown for that suggestion key, and does not progress quest state.

## Privacy guarantees

Gate 3B does not store raw frames, screenshots, base64 media, audio, or private notebook text. It does not call LLMs or VLMs. Evidence records remain symbolic and use `contains_raw_media: false`.

## Known limitations

This is still motion proxy assistance, not object recognition or autonomous action recognition. Similar motions in the wrong zone can confuse the engine, lighting/camera shake can trigger uncertainty, and writing/typing suggestions remain especially heuristic. Manual confirmation remains the final step completion authority.

## Recommendation

Gate 3B is suitable for symbolic suggestion testing and operator-assisted physical traces. Demo polish should remain blocked until live traces generated with these suggestions replay successfully through the harness.
