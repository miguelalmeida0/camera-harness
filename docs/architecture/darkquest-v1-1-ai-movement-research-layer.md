# DarkQuest v1.1 AI Movement Research Layer

## Decision

DarkQuest v1.1 keeps the v1 product surface frozen:

Camera -> Describe my next movement -> Big movement result -> optional confirmation and voice.

The upgrade is an intelligence-layer pass, not a new UI concept. The app should feel more like an AI research prototype by improving prompt quality, session memory, correction handling, confidence calibration, provider reliability, cost discipline, and hidden diagnostics while preserving one-shot user control and raw-media privacy.

## What Changes

### 1. Movement History, Text Only

- Store the last 10 movement sentences in session memory.
- Store text only: no frames, screenshots, base64 images, audio, OCR, or raw media.
- Let the user clear history.
- Keep history collapsed by default or secondary below the big result.
- Use history for product continuity only; do not imply person identification or long-term tracking.

### 2. Correction Loop

- If the user chooses Not this / Correct, ask: "What did you actually do?"
- Store the correction as text-only session memory.
- Use recent corrections to improve the next prompt in the same session.
- Never upload old images as correction context.
- Never identify the person, infer identity, or store biometric identity.
- Confirmation remains explicit; correction does not auto-complete future movements.

### 3. Prompt v2: Temporal Movement Reasoning

- Label capture frames as Frame 1, Frame 2, Frame 3, and Frame 4.
- Ask the model to describe what changed over time.
- Require one concise movement sentence suitable for the hero result.
- Discourage identity, appearance, sensitive attributes, and person recognition.
- Ask for uncertainty when the movement is unclear, partially visible, or ambiguous.
- Prefer frame-relative language when direction could be mirrored or ambiguous.

### 4. Confidence Calibration

- Track confirmed and rejected movement results in session memory.
- Display confidence carefully as a qualitative signal, not exact truth.
- Do not show fake precision in the main UI.
- If confidence is low, soften the sentence and require confirmation clearly.
- Use rejection history to lower confidence for repeated similar failures in the same session.

### 5. Provider Reliability Ladder

- Keep the known working route as the primary path: `google/gemma-4-31B-it:cerebras`.
- Use a bounded list of fallback candidates only when the primary route fails.
- Cap provider retries and candidate fallback attempts.
- Surface provider-busy states explicitly.
- Never loop-retry indefinitely.
- Never call a provider before the user clicks Describe my next movement.

### 6. Hidden Research Lab

Research diagnostics belong behind Developer Tools only. They may include:

- provider and model
- latency
- prompt version
- image token usage if returned by the provider
- retry count and candidate failures
- last safe error
- cost estimate if available

The main UI must not expose raw provider logs, token strings, raw images, or internal evaluation language.

### 7. Voice Polish

- Use browser Web Speech API voices only.
- Speak the movement sentence only.
- Do not speak confidence, provider, evidence, cost, diagnostics, or errors as narration.
- Do not add paid TTS in v1.1.
- Auto-speak remains off by default.

### 8. Future Optional Mode

Live Narrator stays disabled until there is an explicit user opt-in, a separate cost guard, and clear product copy for continuous operation.

## Non-Negotiable Invariants

- No raw media persistence.
- No automatic continuous calls.
- No background calls while the tab is hidden.
- No provider call without an explicit user click.
- No visible research diagnostics in the main UI.
- No identity, biometric, or sensitive-attribute claims.
- Main product hierarchy remains Camera -> Describe my next movement -> Big movement result.

