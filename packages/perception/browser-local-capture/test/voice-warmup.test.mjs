import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ensureNeuralVoiceService,
  warmNeuralVoiceService
} from "../scripts/neural-voice-startup.mjs";

const serviceUrl = "http://127.0.0.1:8766";
const proof = {
  ok: true,
  voice_warmed: true,
  already_warm: false,
  warmup_ms: 1200,
  audio_duration_ms: 2050,
  audio_bytes: 98444,
  sample_rate: 24000,
  voice: "sensefield_default",
  model_initialized: true
};
let request;
const warmed = await warmNeuralVoiceService(serviceUrl, {
  fetch: async (input, init) => {
    request = { input, init };
    return jsonResponse(proof);
  }
});
assert.equal(request.input, `${serviceUrl}/warmup`);
assert.equal(request.init.method, "POST");
assert.equal(request.init.headers.Accept, "application/json");
assert.equal(request.init.body, undefined, "warm-up has no incompatible request schema");
assert.equal(warmed.ok, true);
assert.equal(warmed.audioBytes, proof.audio_bytes);
assert.equal(warmed.sampleRate, 24000);

const invalidProof = await warmNeuralVoiceService(serviceUrl, {
  fetch: async () => jsonResponse({ ok: true, voice_warmed: true })
});
assert.equal(invalidProof.code, "service_contract_mismatch", "ready requires measurable synthesized audio");

const missingVoice = await warmNeuralVoiceService(serviceUrl, {
  fetch: async () => jsonResponse({ ok: false, code: "voice_not_found" }, 503)
});
assert.equal(missingVoice.code, "voice_not_found");

const timedOut = await warmNeuralVoiceService(serviceUrl, {
  fetch: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }
});
assert.equal(timedOut.code, "warmup_timeout");

let spawnCount = 0;
let warmCount = 0;
const healthy = await ensureNeuralVoiceService({
  root: "/repo",
  env: {},
  runtime: { ok: true },
  healthCheck: async () => ({ reachable: true, ready: true, warmed: false }),
  warmUp: async () => { warmCount += 1; return { ...warmed, ok: true }; },
  spawnVoice: () => { spawnCount += 1; }
});
assert.equal(healthy.owned, false);
assert.equal(spawnCount, 0, "an existing service is never duplicated");
assert.equal(warmCount, 1, "an existing cold service is warmed exactly once");

await assert.rejects(() => ensureNeuralVoiceService({
  root: "/repo",
  env: {},
  runtime: { ok: true },
  healthCheck: async () => ({ reachable: true, ready: true, warmed: false }),
  warmUp: async () => missingVoice
}), (error) => error.code === "voice_not_found", "physical startup preserves the exact warm-up stage");

const launcherSource = readFileSync(new URL("../scripts/physical-capture-launcher.mjs", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../../../../services/visual-companion/voice_runtime.py", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../../../services/visual-companion/app.py", import.meta.url), "utf8");
const localCaptureSource = readFileSync(new URL("../prototype/local-capture.js", import.meta.url), "utf8");
assert.ok(launcherSource.indexOf("await ensureNeuralVoiceService") < launcherSource.indexOf("createServer("), "physical:capture waits for warm-up before launch");
assert.match(launcherSource, /Neural voice: unavailable[\s\S]*process\.exit\(1\)/, "physical:capture fails truthfully when warm-up fails");
assert.equal(/new\s+Audio|\.play\(/.test(runtimeSource + appSource), false, "server warm-up never plays audio");
assert.equal(/SpeechSynthesisUtterance|speechSynthesis\.speak/.test(localCaptureSource), false, "browser/system speech fallback remains absent");
assert.match(runtimeSource, /buffer\s*=\s*io\.BytesIO\(\)/, "WAV encoding remains in memory");

console.log("neural voice warm-up contract tests passed");

function jsonResponse(body, status = 200, mimeType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? mimeType : "" },
    async json() { return body; }
  };
}
