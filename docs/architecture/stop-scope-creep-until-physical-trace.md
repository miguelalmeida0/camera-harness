# Stop Scope Creep Until Physical Trace

Superseded by:

```text
docs/architecture/stop-scope-creep-after-gate-1C.md
```

Gate 1C is now `PASS_WITH_DISCLOSURE`, so the active policy is post-physical-trace scope control. This file remains as historical context for the pre-physical-trace phase.

No new gates after Gate 1F.

Until this file exists:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

and Gate 1C runs against it, the project stays focused on physical capture success.

## Allowed

- app usability fixes;
- operator guidance;
- export fixes;
- validation fixes;
- bug report fixes;
- physical trace capture support.

## Not Allowed

- new gates after Gate 1F;
- cinematic HUD;
- minimal HUD polish;
- visual effects;
- portfolio demo work;
- autonomous CV claims;
- model integration;
- memory features;
- RAG;
- narration;
- agentic embellishments.

## Decision Rule

If the work does not help the user complete physical capture, export the trace, save it at the required path, or validate it through Gate 1C, it waits.
