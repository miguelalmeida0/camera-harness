# Browser Local Capture

Gate 1B browser-local capture is a thin boundary between browser camera permission and the replay-tested symbolic system.

Allowed path:

```text
camera permission
-> transient local browser frame
-> manual/local observation mapping
-> LocalObservationFrame
-> live-perception-adapter
-> StableEvent[]
-> live-trace-recorder
-> replay fixture
```

Forbidden:

- raw frame, screenshot, base64 image, video, audio, OCR, or notebook text persistence;
- cloud LLM/VLM calls;
- direct quest transitions or HUD progress from camera frames;
- localStorage/sessionStorage/IndexedDB/cache writes for media.

The prototype at `prototype/index.html` is intentionally minimal. It requests camera permission, accepts manual symbolic observations, records local browser latency, and exports symbolic trace state only. Start it from the repo root with:

```sh
npm run physical:capture
```

For Gate 1C physical capture, the prototype requires explicit operator confirmation before exporting the replay fixture. Save the browser download as `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`, then run:

```sh
npm run physical:validate
npm run gate:1c
```

Do not create `live_physical_focus_ritual_001.v0.json` without a real browser webcam session.
