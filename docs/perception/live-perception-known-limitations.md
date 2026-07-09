# Live Perception Known Limitations

| Limitation | What fails | Representation | Gate 1A impact | Demo disclosure | Future fix |
| --- | --- | --- | --- | --- | --- |
| Low light | Object and hand confidence drops below thresholds. | Emit `confidence.changed`; emit `scene.uncertain` if active step is blocked. | Does not block symbolic Gate 1A; blocks live demo if common. | Disclose if lighting setup is required. | Add local brightness checks and setup guidance. |
| Pen detection ambiguity | Pen may be too small or occluded to classify. | Emit `scene.uncertain` with `uncertainty_kind: "ambiguous_object"`. | Blocks pen step in real capture until stable. | Disclose only if manual correction exists. | Add object alias support and better local classifier. |
| Hand/object overlap | Hand covers phone or pen during movement. | Hold state; emit `scene.uncertain` for occlusion. | Does not block controlled trace; can block live trace. | Disclose as recovery behavior. | Add track retention and occlusion windows. |
| Writing-motion ambiguity | Fidgeting can look like writing. | Require `gesture_repetition_count >= 3` and `evidence_window_ms >= 900`; otherwise hold state. | Does not block controlled trace. | Disclose if writing gestures need deliberate motion. | Add pen-object correlation and motion direction rules. |
| Keyboard-motion ambiguity | Desk tapping can look like typing. | Require keyboard zone and stabilized typing window. | Does not block controlled trace. | Disclose if keyboard zone must be cleanly calibrated. | Add two-hand rhythm and keyboard occupancy rules. |
| Camera angle dependency | Zones may not align with object movement. | Emit `confidence.changed`; emit `scene.reset` after camera bump. | Blocks live browser claim until calibration QA exists. | Disclose calibration requirement. | Add calibration validation and zone drift detection. |
| Gesture false positives | Wrong gesture completes step. | Reject gestures outside active zone/order; emit no progress. | Covered by replay ordering gates. | Do not disclose as acceptable completion. | Add adversarial live traces. |
| Zone drift | Object appears to move zones without physical movement. | Emit `scene.uncertain`; `scene.reset` if drift persists. | Blocks demo if recurrent. | Disclose recalibration behavior. | Add anchor drift metrics. |
| Reflective surfaces | Phone or pen track flickers. | Hold state until stable confidence; emit uncertainty if blocked. | Does not block controlled trace. | Disclose setup sensitivity. | Add reflection-aware confidence decay. |
| Camera bump recovery | Calibration no longer maps to desk. | Emit `scene.reset` with `reset_reason: "camera_bump"`. | Blocks live trace until reset/recalibration path is tested. | Disclose as reset-required state. | Add bump fixture and browser reset flow. |

