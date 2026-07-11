# DarkQuest v2 Visual Intelligence Companion

## Decision

DarkQuest v2 resets the product from gesture-to-phrase automation into a visual intelligence companion:

`local visual-change trigger -> bounded frame window -> open-source VLM -> structured scene-change result -> response policy -> text response -> open/local TTS -> optional suggested action -> existing automation policy layer`

The default user-facing mode is `Observe now`. Proactive observation is future work, explicit opt-in, and disabled initially.

## Product Loop

1. User starts the camera.
2. User clicks `Observe now`.
3. App shows `Watch closely...`.
4. User performs, presents, changes, or holds something in view.
5. App captures 4-8 frames over about 2-4 seconds.
6. A local or self-hosted open-source VLM compares the frame sequence.
7. The response policy converts structured visual output into one of: narrate, ask, assist, uncertain, or remain silent.
8. App speaks a concise contextual response through local/open TTS.
9. User may ask a follow-up, correct the response, accept a suggested action, or observe again.

## Architectural Boundaries

Recognition:
- Owns transient frame capture, model selection, model load, inference, and structured visual response parsing.
- Must not persist frames, screenshots, base64 media, audio, identity embeddings, or provider request bodies containing media.
- Must not call paid inference APIs in the production path.

Policy:
- Owns response type selection, safety filtering, and conversion from model output to product copy.
- Must describe visible behavior, not identity, biometric identity, sensitive attributes, unsupported emotions, or mental states.
- Must turn ambiguous results into `ask`, `uncertain`, or `remain_silent`.

Speech:
- Owns local/open TTS only.
- Browser speech is allowed as fallback.
- Spoken text is limited to `spoken_response` or an approved clarification question.

Automation:
- Existing automation engine remains downstream.
- VLM output can suggest bounded actions, but never executes them directly.
- External, media, webhook, and higher-risk actions remain confirmation and policy gated.
- Instant local gestures remain a separate optional path; they do not replace visual companion observation.

## Implementation Shape

Frontend modules:
- `visual-observation-controller`: starts one-shot observation, enforces tab/camera visibility, captures frame references, and deletes frames after inference.
- `visual-response-presenter`: renders contextual response using the existing visual hierarchy.
- `visual-followup-controller`: sends user text plus text-only context to the same provider boundary, without old frames.
- `visual-correction-controller`: stores text-only corrections under memory policy.

Server/local runtime modules:
- `visual-provider-registry`: hardware-aware provider selection without hardcoding a default model before detection.
- `visual-model-runtime`: loads/unloads local or self-hosted VLM adapters.
- `visual-response-parser`: validates `contextual-visual-response.v1`.
- `visual-tts-runtime`: routes to Kokoro or browser speech fallback.

## System Invariants

- One click creates one bounded observation window.
- One observation window creates at most one model inference request sequence.
- No model request starts while camera is off, tab is hidden, or another observation is in flight.
- Raw frames are transient in memory and deleted after inference completes or fails.
- No raw media enters history, memory, receipts, logs, analytics, or automation payloads.
- `HF_TOKEN` may be used only for gated model file download, not hosted inference billing.
- No paid Hugging Face routed/provider billing is permitted in the v2 production path.
- Suggested actions are structured data, not executable code.
- Automation execution requires allowlist validation and visible user confirmation when required by risk tier.

## Failure Modes

- Model unavailable: enter `provider_unavailable`; show concise local setup status and do not fall back to paid APIs.
- Model loading slow: enter `model_loading`; keep camera preview stable and block duplicate observations.
- Low confidence or no meaningful change: return `remain_silent` or `uncertain`; do not manufacture a response.
- Sensitive inference attempt: suppress with `safety_flags` and avoid spoken response.
- Raw media lifecycle violation: fail the observation, delete transient frames, and emit privacy-safe diagnostics only.
- Suggested action invalid: discard suggestion and keep the response visible.

## Cost and Latency

- Production inference cost is hardware/energy only; no paid API calls.
- Edge/lightweight target: useful response in about 2-8 seconds after capture on capable local hardware.
- Local/server omni target: higher quality response in about 3-12 seconds depending on GPU/quantization.
- Quality benchmark tier can be slower and is not the default product runtime.
