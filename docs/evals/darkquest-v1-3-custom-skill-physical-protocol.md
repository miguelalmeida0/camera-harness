# DarkQuest v1.3 Custom Skill Physical Protocol

## Claim

A user can teach a two-hand Heart shape, attach the safe local phrase `Heart detected`, and trigger it twice without confirmation, VLM calls, network automation calls, or raw-media persistence.

Synthetic gate evidence cannot satisfy this protocol. Run it in the target browser with the real camera and local landmark engine.

## Privacy boundary

- Do not record or retain video, images, screenshots, data URIs, base64, or landmark history.
- Keep only bounded symbolic outcomes: attempt type, match/non-match, score, latency, outcome code, and receipt ID.
- Confirm `contains_raw_media: false` and `vlm_calls: 0` before accepting the evidence.
- Stop immediately if developer tools, storage inspection, or network inspection shows a persisted frame or model request.

## Procedure

1. Start DarkQuest and enable local instant gestures.
2. Select `Create custom gesture` and name it `Heart shape`.
3. Select two hands and collect five accepted stable examples.
4. Inspect browser storage and confirm no image/video/blob/data URI/base64 value exists.
5. Run the wizard live-test phase until two Heart matches succeed.
6. Attach `Speak phrase` with exact phrase `Heart detected` and save.
7. Hold Heart until one receipt appears and speech starts once.
8. Continue holding and confirm there is no duplicate receipt or speech.
9. Return to neutral, wait for cooldown, and trigger Heart once more.
10. Try open hands three times; record zero Heart matches.
11. Try prayer hands three times; record zero Heart matches.
12. Confirm no Describe, Confirm, VLM, provider, or network automation call occurred.

## Required symbolic evidence

Create `runs/custom-skills-physical-latest.json` only after the operator completes every step:

```json
{
  "schema": "darkquest.custom_skill_physical_evidence.v1",
  "skill_name": "Heart shape",
  "valid_examples": 5,
  "live_test_matches": 2,
  "heart_trigger_attempts": 2,
  "heart_trigger_receipts": 2,
  "open_hand_attempts": 3,
  "open_hand_false_positives": 0,
  "prayer_hand_attempts": 3,
  "prayer_hand_false_positives": 0,
  "average_latency_ms": 0,
  "score_range": { "min": 0.0, "max": 0.0 },
  "outcome_codes": [],
  "receipt_ids": [],
  "vlm_calls": 0,
  "network_automation_calls": 0,
  "contains_raw_media": false,
  "operator_confirmed": true
}
```

Do not add frame data, landmarks, provider payloads, or tokens to this artifact.

## Pass criteria

- Five accepted training examples and two successful live-test matches.
- Two Heart executions separated by neutral reset and cooldown.
- Exactly two speech executions and two unique receipts.
- Zero open-hand and prayer-hand false positives across three attempts each.
- Zero VLM/provider/network automation calls.
- No raw-media persistence.

Until this evidence passes, `gate:v1:custom-skills` may return at most `PASS_WITH_DISCLOSURE`.
