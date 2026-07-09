# DarkQuest v1 Product Freeze

## Decision

DarkQuest v1 is frozen around one product loop:

```text
Camera
-> Describe my next movement
-> short frame window
-> Hugging Face / Cerebras VLM
-> big movement sentence
-> optional voice narration
```

Do not create a new product concept. Do not add visible product surfaces. Do not change the approved design unless the user explicitly asks.

## Frozen Main Product Hierarchy

1. Camera
2. Describe my next movement
3. Big movement result
4. Speak result / Try another movement / Confirm
5. Small expandable Why/details
6. Privacy/cost copy
7. Developer tools hidden

The main screen must continue to read as:

```text
Camera
-> Describe my next movement
-> Big movement result
```

## Working Provider Route

The proven live route is:

```text
google/gemma-4-31B-it:cerebras
```

Current proof markers:

- `BARE_CONTROL_PASS`
- `MOVEMENT_PROMPT_PASS`
- `PROVIDER_HELPER_PASS`
- `LIVE_OK`

Do not change provider route or candidate order without a new proof run.

## Main UI Must Not Include

Forbidden from the main product UI:

- Focus Ritual;
- phone/notebook/pen/keyboard workflow;
- trace campaign;
- JSON fixture export;
- Gate language;
- Recent Events;
- zone/debug internals;
- validation checklist UX.

These may exist only as hidden developer/QA tooling if still needed.

## Allowed Main UX Copy

- `Describe my next movement`
- `Move now.`
- `Understanding movement...`
- `Try another movement`
- `Speak result`
- `Confirm`
- `One click captures one short movement window.`

## Privacy And Cost Invariants

- No AI call before explicit user click.
- One click creates one short frame window.
- One frame window creates at most one capped provider request sequence.
- No raw media persistence.
- No token exposure to frontend.
- No continuous detection by default.
- Live narrator remains disabled/coming soon.

## Product Freeze Rule

If a change does not improve reliability, loading/error clarity, result reveal, voice response, one-shot cost guard, mirrored preview, or hidden diagnostics, it is out of scope for this pass.

