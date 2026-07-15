import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReplaySafetyController } from "./replay-safety-controller.mjs";

test("replay requires consent, remains bounded and local, and stops on lifecycle changes", async () => {
  let clock = 100;
  const revoked = [];
  let savedBlob = null;
  const controller = createReplaySafetyController({
    testOnly: true,
    maxDurationMs: 1_000,
    maxEvents: 3,
    now: () => clock,
    createObjectURL: (blob) => {
      savedBlob = blob;
      return `blob:neural-field/${clock}`;
    },
    revokeObjectURL: (url) => revoked.push(url)
  });

  assert.throws(() => controller.start("missing", true), /consent/);
  const consentId = controller.requestConsent();
  assert.throws(() => controller.grantConsent(consentId, false), /consent/);
  controller.grantConsent(consentId, true);
  controller.start(consentId, true);
  controller.append({ event_type: "stroke_point", timestamp_ms: 110, metadata: { x: 0.2, camera_frame: "forbidden", token: "forbidden" } });
  controller.append({ event_type: "stroke_point", timestamp_ms: 120, metadata: { x: 0.3 } });
  controller.append({ event_type: "stroke_point", timestamp_ms: 130, metadata: { x: 0.4 } });
  controller.append({ event_type: "stroke_point", timestamp_ms: 140, metadata: { x: 0.5, note: "data:image/png;base64,forbidden", credential: "Bearer forbidden-token" } });
  assert.equal(controller.snapshot().eventCount, 3, "replay event history is bounded");
  clock = 1_101;
  controller.tick();
  assert.equal(controller.snapshot().recording, false);
  assert.equal(controller.snapshot().stopReason, "duration_limit");
  assert.throws(() => controller.save(false), /explicit_replay_save_required/);
  const saved = controller.save(true);
  assert.deepEqual({ localOnly: saved.localOnly, containsRawMedia: saved.containsRawMedia }, { localOnly: true, containsRawMedia: false });
  const savedPayload = JSON.parse(await savedBlob.text());
  assert.doesNotMatch(JSON.stringify(savedPayload), /data:image|Bearer forbidden-token/);
  assert.equal(controller.snapshot().uploadRequests, 0);
  controller.discard();
  assert.equal(revoked.length, 1);
  assert.equal(controller.snapshot().activeObjectUrls, 0);

  let lifecycleConsent = controller.requestConsent();
  controller.grantConsent(lifecycleConsent, true);
  controller.start(lifecycleConsent, true);
  assert.equal(controller.onExit(), true);
  assert.equal(controller.snapshot().stopReason, "mode_exit");
  assert.equal(controller.snapshot().consentGranted, false);
  assert.throws(() => controller.save(true), /must_be_stopped/);

  lifecycleConsent = controller.requestConsent();
  controller.grantConsent(lifecycleConsent, true);
  controller.start(lifecycleConsent, true);
  assert.equal(controller.onModeSwitch(), true);
  assert.equal(controller.snapshot().stopReason, "mode_switch");

  lifecycleConsent = controller.requestConsent();
  controller.grantConsent(lifecycleConsent, true);
  controller.start(lifecycleConsent, true);
  assert.equal(controller.onRecorderError(), true);
  assert.equal(controller.snapshot().stopReason, "recorder_stopped_unexpectedly");
  controller.discard();
  assert.equal(controller.snapshot().backgroundRecording, false);
});

test("generated replay media and failure artifacts are ignored", async () => {
  const ignore = await readFile(new URL("../../../../../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /test-results\/neural-field\//);
  assert.match(ignore, /runs\/neural-field\/replays\//);
  assert.match(ignore, /\.webm/);
});
