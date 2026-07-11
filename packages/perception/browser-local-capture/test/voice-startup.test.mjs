import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decodeWavDurationMs,
  discoverVoiceRuntime,
  ensureNeuralVoiceService,
  requestVoiceDoctorSample,
  stopOwnedVoiceService
} from "../scripts/neural-voice-startup.mjs";
import {
  createInitialState,
  setInteractionModeInState,
  speakSensefieldResponse
} from "../prototype/local-capture.js";
import { executeLocalAutomationAction } from "../prototype/automation/local-action-adapters.js";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const root = "/repo/worktree";
const localPython = resolve(root, ".venv-voice/bin/python");
const configuredPython = resolve(root, "voice/python");
const sharedPython = "/repo/main/.venv-voice/bin/python";

assert.equal(discoverVoiceRuntime({
  root,
  env: {},
  commonRepoRoot: "/repo/main",
  isUsable: (candidate) => candidate === localPython
}).python, localPython, "runtime discovery prefers the worktree runtime");
assert.equal(discoverVoiceRuntime({
  root,
  env: { SENSEFIELD_VOICE_PYTHON: "voice/python" },
  commonRepoRoot: "/repo/main",
  isUsable: (candidate) => candidate === configuredPython
}).python, configuredPython, "configured Python path is honored");
assert.equal(discoverVoiceRuntime({
  root,
  env: {},
  commonRepoRoot: "/repo/main",
  isUsable: (candidate) => candidate === sharedPython
}).python, sharedPython, "linked worktrees can use the shared main runtime");
assert.equal(discoverVoiceRuntime({ root, env: {}, commonRepoRoot: "", isUsable: () => false }).ok, false, "missing runtime is reported");

const runtime = { ok: true, python: "/voice/python", serviceScript: "/repo/services/visual-companion/app.py" };
let spawnCount = 0;
const alreadyHealthy = await ensureNeuralVoiceService({
  root,
  env: {},
  runtime,
  healthCheck: async () => ({ reachable: true, ready: true, httpStatus: 200 }),
  spawnVoice: () => { spawnCount += 1; }
});
assert.equal(alreadyHealthy.owned, false);
assert.equal(spawnCount, 0, "healthy shared service is not duplicated");

await assert.rejects(() => ensureNeuralVoiceService({
  root,
  env: {},
  runtime: { ok: false },
  healthCheck: async () => ({ reachable: false, ready: false })
}), (error) => error.code === "runtime_not_found");
await assert.rejects(() => ensureNeuralVoiceService({
  root,
  env: {},
  runtime,
  healthCheck: async () => ({ reachable: false, ready: false }),
  pythonProbe: async () => ({ ok: false, missing: ["kokoro"] })
}), (error) => error.code === "dependency_import_failed");
await assert.rejects(() => ensureNeuralVoiceService({
  root,
  env: {},
  runtime,
  healthCheck: async () => ({ reachable: true, ready: false })
}), (error) => error.code === "health_not_ready");

const child = { exitCode: null, killed: false, kill() { this.killed = true; this.exitCode = 0; } };
let healthCalls = 0;
const started = await ensureNeuralVoiceService({
  root,
  env: {},
  runtime,
  healthCheck: async () => (++healthCalls === 1 ? { reachable: false, ready: false } : { reachable: true, ready: true, httpStatus: 200 }),
  pythonProbe: async () => ({ ok: true }),
  spawnVoice: () => { spawnCount += 1; return child; },
  sleep: async () => {},
  now: () => 0
});
assert.equal(started.owned, true, "unhealthy service is started");
assert.equal(spawnCount, 1);
assert.equal(stopOwnedVoiceService(started), true, "owned child is cleaned up");
assert.equal(child.killed, true);

const timeoutChild = { exitCode: null, killed: false, kill() { this.killed = true; this.exitCode = 0; } };
let clock = 0;
await assert.rejects(() => ensureNeuralVoiceService({
  root,
  env: {},
  runtime,
  healthCheck: async () => ({ reachable: false, ready: false }),
  pythonProbe: async () => ({ ok: true }),
  spawnVoice: () => timeoutChild,
  sleep: async () => {},
  now: () => (clock += 20),
  timeoutMs: 30
}), (error) => error.code === "startup_timeout");
assert.equal(timeoutChild.killed, true, "timed-out child is cleaned up");

const wav = testWav();
assert.ok(decodeWavDurationMs(wav) > 0, "WAV duration decodes above zero");
const sample = await requestVoiceDoctorSample("http://127.0.0.1:8766", {
  fetch: async () => audioResponse(wav, "audio/wav")
});
assert.equal(sample.httpStatus, 200);
assert.equal(sample.mimeType, "audio/wav");
assert.equal(sample.audioBytes, wav.byteLength);
assert.ok(sample.decodedDurationMs > 0);
await assert.rejects(() => requestVoiceDoctorSample("http://127.0.0.1:8766", {
  fetch: async () => audioResponse(wav, "application/json")
}), (error) => error.code === "invalid_audio_mime");

const state = createInitialState();
await setInteractionModeInState(state, "conversation");
const rejected = await speakSensefieldResponse({ observationId: "voice_rejected", text: "Test response." }, {
  target: state,
  fetch: createNeuralVoiceHarness().fetch,
  URLApi: createNeuralVoiceHarness().URLApi,
  AudioCtor: class { play() { return Promise.reject(new Error("blocked")); } pause() {} removeAttribute() {} load() {} }
});
assert.equal(rejected.code, "visual_local_tts_play_rejected");
assert.equal(state.movementRecognition.voiceStatus, "Voice unavailable");

const evidence = [];
const voice = createNeuralVoiceHarness();
const recovered = await speakSensefieldResponse({ observationId: "voice_recovered", text: "Recovered response." }, {
  target: state,
  ...voice.options,
  onVoiceEvidence: (item) => evidence.push(item)
});
assert.equal(recovered.ok, true, "Conversation remains usable after voice failure");
assert.equal(voice.maxActiveCount, 1, "one Audio playback maximum");
assert.ok(evidence.some((item) => item.event === "play_resolved"));
assert.ok(evidence.some((item) => item.event === "playing"), "speaking starts on the real playing event");
assert.ok(evidence.some((item) => item.event === "ended"), "completion waits for the real ended event");
assert.ok(evidence.every((item) => !Object.hasOwn(item, "text")), "voice evidence excludes spoken content");

await setInteractionModeInState(state, "observing");
const observing = await speakSensefieldResponse({ observationId: "observing_voice", text: "Observed response." }, { target: state, ...createNeuralVoiceHarness().options });
assert.equal(observing.ok, true, "Observing remains usable after voice failure");

let savedPhrase = "";
const savedAction = await executeLocalAutomationAction({
  action: { type: "speak_phrase", config: { text: "Saved action response." } },
  idempotency_key: "saved_action_voice_test"
}, { speakPhrase: async (phrase) => { savedPhrase = phrase; return { ok: true, path: "local_tts" }; } });
assert.equal(savedPhrase, "Saved action response.");
assert.equal(savedAction.status, "succeeded", "Saved Actions use the injected canonical voice owner");

const localCaptureSource = readFileSync(new URL("../prototype/local-capture.js", import.meta.url), "utf8");
const adapterSource = readFileSync(new URL("../prototype/automation/local-action-adapters.js", import.meta.url), "utf8");
const spatialSource = readFileSync(resolve("packages/perception/browser-local-capture/prototype/spatial/spatial-experience.js"), "utf8");
const launcherSource = readFileSync(new URL("../scripts/physical-capture-launcher.mjs", import.meta.url), "utf8");
assert.equal(/SpeechSynthesisUtterance|speechSynthesis\.speak/.test(localCaptureSource + adapterSource), false, "no browser speech fallback remains");
assert.equal(/new\s+Audio|\/api\/visual-companion\/speak/.test(spatialSource), false, "Spatial uses the canonical voice owner");
assert.equal(launcherSource.includes("ensureNeuralVoiceService"), true, "physical:capture owns neural startup");
assert.equal(/console\.(?:log|error)\([^\n]*(?:TOKEN|API_KEY|process\.env)/.test(launcherSource), false, "launcher does not log secrets");

console.log("neural voice startup tests passed");

function audioResponse(buffer, mimeType) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? mimeType : "" },
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); }
  };
}

function testWav() {
  const sampleRate = 8000;
  const samples = 800;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}
