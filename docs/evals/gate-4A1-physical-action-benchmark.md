# Gate 4A.1 Physical Action Benchmark

## Purpose

Measure real local camera action suggestions without turning trace export into the product. This benchmark records symbolic metrics only.

## Protocol

For each action, run 5 physical attempts:

- phone moved
- notebook opened
- pen picked up
- writing motion
- typing motion
- uncertain/occlusion

For each attempt:

1. Start the app in product mode.
2. Perform the physical action for the current ritual step.
3. Record whether the Detected Action card shows a suggestion.
4. Confirm correct suggestions or reject wrong suggestions.
5. Record symbolic metrics only.

## Metrics

| Action | Attempts | Suggestions shown | Confirmed correct | Rejected wrong | Missed attempts | Average latency | False positives | False negatives | Confidence range |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| phone moved | 5 |  |  |  |  |  |  |  |  |
| notebook opened | 5 |  |  |  |  |  |  |  |  |
| pen picked up | 5 |  |  |  |  |  |  |  |  |
| writing motion | 5 |  |  |  |  |  |  |  |  |
| typing motion | 5 |  |  |  |  |  |  |  |  |
| uncertain/occlusion | 5 |  |  |  |  |  |  |  |  |

## Privacy Boundary

Do not store raw video, screenshots, base64 images, audio, OCR, notebook text, cloud evidence, or model responses. Record only action name, symbolic suggestion status, confidence range, latency, confirmation/rejection outcome, and operator notes.

## Approval Boundary

This benchmark does not approve autonomous vision, blind auto-completion, object detection proof, production action recognition, or production perception.
