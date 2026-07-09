# @darkquest/event-stabilizer

Deterministic stabilizer for DarkQuest Focus Ritual perception frames.

The package ingests local `PerceptionFrame` records and emits stable symbolic events only after observations survive temporal smoothing, dwell thresholds, gesture debounce, and uncertainty gates. It has no cloud dependency and is safe for the live camera hot path.

## API

```ts
import { createEventStabilizer } from "@darkquest/event-stabilizer";

const stabilizer = createEventStabilizer();
const events = stabilizer.ingest(frame);
const resetEvents = stabilizer.reset("camera-bump");
```

## Event families

- `gesture.detected`
- `hand.entered_zone`
- `hand.left_zone`
- `object.moved`
- `object.placed`
- `zone.activated`
- `confidence.changed`
- `scene.uncertain`
- `scene.reset`

Every event includes `confidence`, `evidence`, and a structured payload suitable for replay.
