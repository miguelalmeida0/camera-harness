# Stop Scope Creep After Gate 1C

Gate 1C is now `PASS_WITH_DISCLOSURE`.

Current accepted state:

- physical trace exists and passed;
- physical trace origin passed;
- replay passed;
- privacy passed;
- model calls passed;
- memory passed;
- HUD honesty passed;
- waiver accepted;
- raw media persistence is `0`;
- LLM/VLM calls are `0`.

## Current Policy

Minimal state-backed HUD polish is allowed with disclosure.

The allowed scope is Gate 2A only.

## Allowed

- layout cleanup;
- typography hierarchy;
- spacing;
- status bar clarity;
- checklist clarity;
- event timeline readability;
- sequence inspector readability;
- export/save path clarity;
- validation command UX;
- bug report UX;
- troubleshooting UX;
- confidence, latency, privacy, and model status display.

## Still Not Allowed

- cinematic polish;
- portfolio claims;
- autonomous vision claims;
- model integration;
- VLM integration;
- production claims;
- narration;
- agentic embellishment;
- raw media persistence;
- hidden manual confirmation;
- hidden uncertainty;
- hidden low confidence.

## Decision Rule

If the work does not make the existing state-backed local app clearer, more honest, or easier to validate, it waits.
