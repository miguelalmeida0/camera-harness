# Gate 1F Bug Report Safety Audit

## Claim Being Tested

`darkquest_operator_bug_report.json` must help diagnose operator failures without leaking raw media, private desk content, model output, or cloud evidence.

## Forbidden Content

The bug report must not contain:

- raw frames
- screenshots
- base64 media
- audio
- OCR
- notebook text
- API keys
- model responses
- cloud evidence

## Allowed Content

The bug report may contain:

- browser user agent
- wizard stage
- quest state
- event types
- event ids
- symbolic payload summaries
- latency metrics
- privacy/model status
- error messages
- disabled button reasons

## Implementation

The app uses `buildOperatorBugReport` in:

```text
packages/perception/browser-local-capture/prototype/local-capture.js
```

The builder emits summarized symbolic event data instead of full raw event payloads. It includes payload summaries, event IDs, event types, confidence, and evidence kind.

## Gate 1F Check

`npm run gate:1f` builds a sample bug report and scans it for forbidden markers:

```text
runs/darkquest_operator_bug_report.sample.json
```

Latest result: `PASS`.

## Result

`PASS`

The bug report is suitable for operator diagnostics under the Gate 1F constraints. It does not satisfy Gate 1C and does not prove autonomous vision.
