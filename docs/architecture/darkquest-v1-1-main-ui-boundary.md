# DarkQuest v1.1 Main UI Boundary

## Decision

The DarkQuest v1.1 main UI stays simple. The research layer may get smarter, but it must not add clutter or internal tooling to the primary product flow.

## Main UI May Show

- Camera preview.
- Describe my next movement button.
- Big movement sentence.
- Try another movement.
- Speak result.
- Confirm.
- Simple Why? details with concise reason, evidence, and careful confidence language.

## Main UI Must Not Show

- Research diagnostics.
- Raw provider logs.
- Token information.
- Internal evaluation or gate language.
- Old ritual object workflows.
- Trace, fixture, or export language.
- Raw frame, screenshot, base64, OCR, or image data.
- Provider candidate failure dumps.
- Cost internals beyond simple privacy/cost copy.

## Developer Tools Boundary

Advanced diagnostics may exist only inside Developer Tools, hidden by default. The closed main UI must remain:

Camera -> Describe my next movement -> Big movement result.

Developer Tools may expose provider/model/latency, prompt version, safe errors, retry metadata, and cost estimates if available, but must never expose raw media or secrets.

## Product Copy Boundary

Allowed main UI copy should be user-facing and calm:

- "Describe my next movement"
- "Understanding movement..."
- "Try another movement"
- "Speak result"
- "Confirm"
- "Why?"

Disallowed main UI copy includes internal harness, validation, trace, fixture, gate, or provider-debug terminology.

