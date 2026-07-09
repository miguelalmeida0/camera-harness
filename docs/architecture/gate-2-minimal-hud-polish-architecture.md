# Gate 2 Minimal HUD Polish Architecture

## Purpose

Gate 2 defines the narrow HUD polish that may begin after Gate 1C. It is not approval for cinematic HUD work.

## Allowed Minimal Polish

- layout cleanup;
- typography;
- clear objective panel;
- event timeline presentation;
- confidence bands;
- active zone styling;
- uncertainty/recovery panel styling;
- reset/recalibration panel styling;
- state-backed progress animation;
- latency/status indicators.

## Still Forbidden

- fake progress;
- cinematic completion without state;
- hiding uncertainty;
- hiding low confidence;
- implying cloud/VLM intelligence;
- storing camera frames;
- exporting screenshots as replay evidence;
- model calls in the hot path;
- non-replayable UI claims.

## Architecture Rule

Every visual state must be backed by at least one of:

- quest state;
- HUD command;
- stable event;
- confidence value;
- latency/model/privacy status;
- replay evidence.

## HUD Data Sources

The HUD may read the reducer state, replayable HUD command stream, confidence values, uncertainty/reset status, latency status, model-call status, and privacy status. It must not read raw frames, mutate quest state, call models, write memory, or infer completion outside the reducer.

## Animation Rule

Progress animation may only follow accepted quest state transitions. It must not anticipate completion, mask uncertainty, or animate around missing evidence.

## Evidence Rule

If a visual claim cannot be reproduced from the replay report, the HUD must not show it as truth. It may show a pending, uncertain, or recovery state instead.

