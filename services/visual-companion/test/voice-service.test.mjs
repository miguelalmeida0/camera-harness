import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createVisualTtsRuntime } from "../index.mjs";

const service = readFileSync(resolve("services/visual-companion/app.py"), "utf8");
const runtime = readFileSync(resolve("services/visual-companion/voice_runtime.py"), "utf8");
const benchmark = readFileSync(resolve("services/visual-companion/voice_benchmark.py"), "utf8");

assert.equal(service.includes("@app.get(\"/voices\")"), true, "voice list endpoint exists");
assert.equal(service.includes("@app.post(\"/speak\")"), true, "speak endpoint exists");
assert.equal(service.includes("@app.post(\"/cancel\")"), true, "cancel endpoint exists");
assert.equal(runtime.includes("hexgrad/Kokoro-82M"), true, "Kokoro engine is wired");
assert.equal(runtime.includes("ResembleAI/chatterbox"), true, "Chatterbox candidate is recorded");
assert.equal(runtime.includes("FunAudioLLM/CosyVoice3"), true, "CosyVoice candidate is recorded");
assert.equal(runtime.includes("SENSEFIELD_VOICE_MODEL"), true, "model selection is configurable");
assert.equal(runtime.includes("VOICE_PROFILE"), true, "Sensefield voice profile is defined");
assert.equal(runtime.includes("clone_or_imitation"), true, "profile forbids cloning/imitation");
assert.equal(benchmark.includes("runs/voice-benchmark"), true, "benchmark writes samples under runs/voice-benchmark");
assert.equal(/api_key|OPENAI_API_KEY|ELEVEN/i.test(runtime), false, "runtime has no paid API key dependency");
assert.equal(/encoded_frame|data_uri/.test(runtime), false, "voice runtime does not accept camera frame fields");
assert.equal(/browser_speechSynthesis/.test(runtime + service), false, "voice service has no browser/system fallback");

const calls = [];
const tts = createVisualTtsRuntime({
  localTts: {
    async synthesize(text) {
      calls.push({ type: "local", text });
      return { ok: true, audio: new Uint8Array([1, 2, 3]) };
    },
    cancel() {
      calls.push({ type: "cancel" });
    }
  }
});

const spoken = await tts.speak({ spoken_response: "You formed a heart shape with your hands." });
assert.equal(spoken.path, "local_tts");
assert.deepEqual(calls[0], { type: "cancel" });
assert.deepEqual(calls[1], { type: "local", text: "You formed a heart shape with your hands." });
tts.cancel();
assert.equal(calls.at(-1).type, "cancel");

console.log("voice service tests passed");
