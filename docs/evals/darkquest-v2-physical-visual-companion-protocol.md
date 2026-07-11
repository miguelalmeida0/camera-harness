# DarkQuest v2 Physical Visual Companion Protocol

Purpose: collect physical webcam evidence for the Visual Intelligence Companion without retaining media.

Evidence level: physical webcam proof. This is separate from contract/unit proof, mock integration proof, and real model proof.

Rules:
- Record text response, response type, confidence, uncertainty, latency, model, user accept/correct result.
- Do not retain frames, screenshots, video, audio, base64, data URIs, OCR text, or provider request payloads.
- Clear memory after the privacy test and verify only text summaries were present.
- Keep suggested actions secondary and require confirmation before execution.

Required physical tests:
1. Raise/lower object.
2. Present object.
3. Point at object.
4. Enter/leave frame.
5. No meaningful change.
6. Ambiguous action.
7. Poor lighting.
8. Correction/follow-up.
9. Suggested timer action.
10. Privacy clear-memory flow.

Expected symbolic artifact:

```json
{
  "schema": "darkquest.v2_physical_visual_companion_evidence.v1",
  "retained_media": false,
  "tests": [
    {
      "case_id": "raise_lower_object",
      "text_response": "",
      "response_type": "narrate | ask | assist | uncertain | silence",
      "confidence": 0,
      "uncertainty": "",
      "latency_ms": 0,
      "model": "",
      "user_result": "accepted | corrected | rejected"
    }
  ]
}
```

Gate path:
`runs/darkquest-v2-physical-visual-companion-latest.json`
