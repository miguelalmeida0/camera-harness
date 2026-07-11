import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_VISUAL_COMPANION_MODEL,
  DEFAULT_VISUAL_COMPANION_MODEL_REVISION,
  VISUAL_COMPANION_SCHEMA_VERSION,
  applyContextualResponsePolicy,
  clearVisualFramePayloads,
  extractJsonObject,
  loadVisualCompanionConfig,
  normalizeContextualVisualResponse,
  validateVisualObservationWindow,
  visualCompanionHealth,
  visualCompanionObserveResponseForRequest,
  visualCompanionStaticHealth
} from "../server/visual-companion-provider.mjs";
import {
  PERSISTENT_OBSERVATION,
  REALTIME_AUDIO_CONSTRAINTS,
  VISUAL_COMPANION_CLIENT_CONFIG,
  VISUAL_COMPANION_ALLOWED_ACTIONS,
  computeVisualSceneChangeScore,
  createInitialState,
  endRealtimeConversation,
  handleRealtimeUserSpeechTurn,
  interruptAssistantSpeech,
  maybeAutoSpeakVisualResult,
  persistentObservationEventFromLocalChange,
  queueMovementRecognitionResult,
  scheduleRealtimeVisualEvent,
  speakVisualResponse,
  speakMovementResult,
  startRealtimeConversation,
  updateVisualContextFromResult,
  visualContextForRequest
} from "../prototype/local-capture.js";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const html = readFileSync(resolve("packages/perception/browser-local-capture/prototype/index.html"), "utf8");
const source = readFileSync(resolve("packages/perception/browser-local-capture/prototype/local-capture.js"), "utf8");
const launcher = readFileSync(resolve("packages/perception/browser-local-capture/scripts/physical-capture-launcher.mjs"), "utf8");
const serverSource = readFileSync(resolve("packages/perception/browser-local-capture/server/movement-recognition-server.mjs"), "utf8");
const service = readFileSync(resolve("services/visual-companion/app.py"), "utf8");
const contract = readFileSync(resolve("docs/contracts/contextual-visual-response.v1.md"), "utf8");
const providerContract = readFileSync(resolve("docs/contracts/visual-companion-provider.v1.md"), "utf8");
const bodyHtml = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
const advancedTemplateStart = bodyHtml.indexOf('<template id="advancedViewTemplate">');
const primaryHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(0, advancedTemplateStart) : bodyHtml;
const advancedHtml = advancedTemplateStart >= 0 ? bodyHtml.slice(advancedTemplateStart) : "";

assert.equal(DEFAULT_VISUAL_COMPANION_MODEL, "HuggingFaceTB/SmolVLM2-2.2B-Instruct");
assert.equal(DEFAULT_VISUAL_COMPANION_MODEL_REVISION, "main");
assert.equal(providerContract.includes("Apache-2.0"), true, "model license is recorded");
assert.equal(providerContract.includes("No Hugging Face routed inference providers"), true, "production path forbids HF router");
assert.equal(service.includes("AutoModelForImageTextToText"), true, "Python service has a real Transformers VLM adapter");
assert.equal(service.includes("snapshot_download"), false, "service runtime does not download during requests");
assert.equal(service.includes("await asyncio.to_thread("), true, "voice synthesis does not block service health/observe routes");
assert.equal(service.includes("safe_textual_model_output"), true, "local VLM natural-language output is not discarded as generic uncertainty");
assert.equal(service.includes("can_use_summary"), true, "concrete local VLM summaries survive low-confidence JSON");
assert.equal(readFileSync(resolve("services/visual-companion/download_model.py"), "utf8").includes("snapshot_download"), true, "setup path downloads model assets explicitly");

assert.equal(html.includes("Sensefield"), true, "product is renamed to Sensefield");
assert.equal(primaryHtml.includes("Start conversation"), true, "primary CTA starts the persistent conversation");
assert.equal(source.includes("End conversation"), true, "primary CTA can end the persistent conversation");
assert.equal(source.includes("Starting…"), true, "primary CTA exposes a starting state");
assert.equal((primaryHtml + source).includes("Turn on camera"), false, "old camera-on CTA is gone");
assert.equal(primaryHtml.includes("Observe again"), false, "primary runtime has no Observe again state");
assert.equal(primaryHtml.includes("Cooling down"), false, "primary runtime has no visible cooldown state");
assert.equal(html.includes("Describe my next movement"), false, "old movement CTA is not primary UI copy");
assert.equal(html.includes("Memory"), true, "memory mode is visible");
assert.equal(html.includes("Clear context"), true, "clear context is visible");
assert.equal(html.includes("Confirm suggested action"), true, "suggested action requires confirmation");
assert.equal(primaryHtml.includes("No raw media stored"), true, "primary privacy copy remains visible");
assert.equal(primaryHtml.includes("dq-auto-speak-toggle"), false, "auto-speak toggle is not shown in the primary UI");
assert.equal(primaryHtml.includes("Open voice controls"), false, "microphone controls are not shown in the primary UI");
assert.equal(primaryHtml.includes("stageVoiceShortcut"), false, "primary UI has no separate microphone control");
assert.equal(advancedHtml.includes("dq-auto-speak-toggle"), true, "advanced mode retains mute preference");
assert.equal(source.includes("VISUAL_COMPANION_CLIENT_CONFIG"), true, "frontend has visual companion client config");
assert.equal(source.includes("/api/visual-companion/observe"), true, "frontend calls visual observe endpoint");
assert.equal(source.includes("client_scene_change_score"), true, "scene-change score is sent symbolically");
assert.equal(source.includes("clearMovementFrameBuffer(frames)"), true, "frame cleanup remains in finally path");
assert.equal(source.includes("requestInFlight"), true, "one-shot in-flight guard remains");
assert.equal(source.includes("document.hidden"), true, "hidden-tab guard remains");
assert.equal(source.includes("PERSISTENT_OBSERVATION"), true, "persistent observation runtime is present");
assert.equal(source.includes("maybeTriggerPersistentObservationFromLocalChange"), true, "local scene changes gate VLM calls");
assert.equal(source.includes("completePersistentObservationCycle"), true, "legacy observer hook remains internal only");
assert.equal(source.includes("realtimeSession"), true, "persistent conversation session controller is present");
assert.deepEqual(REALTIME_AUDIO_CONSTRAINTS, {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}, "microphone capture uses echo cancellation constraints");
assert.equal(PERSISTENT_OBSERVATION.cooldownMs, 0, "distinct observations are not blocked by a cooldown");
assert.equal(PERSISTENT_OBSERVATION.maxFrames >= 4 && PERSISTENT_OBSERVATION.maxFrames <= 8, true, "persistent capture window is bounded to 4-8 frames");
assert.equal(PERSISTENT_OBSERVATION.windowMs >= 2000 && PERSISTENT_OBSERVATION.windowMs <= 4000, true, "persistent capture window is bounded to 2-4 seconds");
assert.equal(source.includes("maxFrames: 1"), false, "local visual runtime preserves an ordered multi-frame movement window");
assert.equal(Boolean(persistentObservationEventFromLocalChange([{ zone_id: "center", motion_score: 0.22, active: true }], 101)), true, "meaningful local change can create one observation");
assert.equal(persistentObservationEventFromLocalChange([{ zone_id: "center", motion_score: 0.01, active: false }], 101), null, "minor local noise does not call the VLM");
assert.equal(source.includes("Confirm suggested action"), false, "button label lives in HTML, not dynamic rerender");
assert.equal(/router\.huggingface\.co/.test(source), false, "frontend has no HF router URL");

assert.equal(launcher.includes("/api/visual-companion/observe"), true, "launcher proxies observe route");
assert.equal(launcher.includes("visualCompanionObserveResponseForRequest"), true, "launcher uses visual provider helper");
assert.equal(launcher.includes("ensureNeuralVoiceService"), true, "launcher starts or verifies the neural voice service");
assert.equal(launcher.includes("Neural voice: ready"), true, "launcher reports neural voice readiness");
assert.equal(serverSource.includes("visualCompanionSpeakResponseForRequest"), true, "server speak route proxies local TTS provider");
assert.equal(serverSource.includes("visualCompanionSpeakStreamResponseForRequest"), true, "server proxies real progressive TTS chunks");
assert.equal(serverSource.includes("visualCompanionCancelResponseForRequest"), true, "server cancel route proxies local TTS provider");
assert.equal(serverSource.includes('ok: true, engine: "browser_speech_fallback", audio_duration_ms: 0'), false, "server no longer fakes successful zero-audio speech");

const config = loadVisualCompanionConfig({
  VISUAL_COMPANION_URL: "http://127.0.0.1:9999",
  VISUAL_COMPANION_MODEL: "HuggingFaceTB/SmolVLM2-2.2B-Instruct",
  VISUAL_COMPANION_MAX_FRAMES: "7",
  VISUAL_COMPANION_WINDOW_MS: "3000"
});
assert.equal(config.provider, "local_visual_companion");
assert.equal(config.maxFrames, 7);
assert.equal(config.windowMs, 3000);

const staticHealth = visualCompanionStaticHealth({});
assert.equal(staticHealth.production_path_uses_hf_router, false);
assert.equal(staticHealth.token_required, false);
assert.equal(staticHealth.token_exposed_to_frontend, false);

const frameA = { mime_type: "image/jpeg", encoded_frame: "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", captured_at_ms: 10, width: 1, height: 1 };
const frameB = { ...frameA, captured_at_ms: 20 };
const window = validateVisualObservationWindow({
  frames: [frameA, frameB],
  previous_context: { last_response: "I saw a cup move." },
  user_question: "What changed?",
  requested_response_mode: "auto",
  client_scene_change_score: 0.2,
  memory_mode: "session"
}, config);
assert.equal(window.schema_version, "visual-observation-window.v1");
assert.deepEqual(window.frame_timestamps_ms, [10, 20]);
assert.equal(window.contains_raw_media, false);
assert.equal(window.frames[0].encoded_frame.length > 0, true);
assert.deepEqual(window.allowed_suggested_actions, VISUAL_COMPANION_ALLOWED_ACTIONS);

assert.equal(computeVisualSceneChangeScore([
  { luma_signature: [0, 0.5, 1] },
  { luma_signature: [0, 0.5, 1] }
]), 0, "static window score can be zero");
assert.equal(computeVisualSceneChangeScore([
  { luma_signature: [0, 0.5, 1] },
  { luma_signature: [1, 0.5, 0] }
]) > 0, true, "changed window score is positive");

assert.deepEqual(extractJsonObject("prefix {\"response_type\":\"narrate\"} suffix"), { response_type: "narrate" });
const normalized = normalizeContextualVisualResponse({
  response_type: "assist",
  observation_summary: "A hand points at the mug.",
  spoken_response: "You pointed at the mug.",
  confidence: 0.82,
  suggested_actions: [{ action: "start_timer", label: "Start a timer", parameters: { duration_seconds: 600 } }, { action: "signed_webhook_post", label: "Unsafe" }]
});
assert.equal(normalized.schema_version, VISUAL_COMPANION_SCHEMA_VERSION);
assert.equal(normalized.response_type, "assist");
assert.equal(normalized.suggested_actions.length, 1, "only allowlisted actions survive");
assert.equal(normalized.suggested_actions[0].requires_confirmation, true);
assert.equal(normalized.contains_raw_media, false);

const malformed = normalizeContextualVisualResponse("not json", {});
assert.equal(malformed.response_type, "uncertain");
assert.equal(malformed.spoken_response, "I could not confidently identify the completed movement.");
assert.equal(applyContextualResponsePolicy({ confidence: 0.9, spoken_response: "The person looks angry." }).response_type, "uncertain", "sensitive inference is suppressed");

let fetchCalled = false;
const response = await visualCompanionObserveResponseForRequest({
  frames: [{ ...frameA }, { ...frameB }],
  client_scene_change_score: 0.2,
  previous_context: {},
  requested_response_mode: "auto",
  memory_mode: "session"
}, {}, {
  fetch: async (url, init) => {
    fetchCalled = true;
    assert.equal(String(url).endsWith("/observe"), true);
    const body = JSON.parse(init.body);
    assert.equal(body.frames.length, 2);
    assert.equal(body.contains_raw_media, false);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          response_type: "narrate",
          observation_summary: "An object moved upward between frames.",
          spoken_response: "You lifted an object.",
          confidence: 0.77,
          uncertainty: false,
          evidence: ["object position changed"],
          model: DEFAULT_VISUAL_COMPANION_MODEL,
          model_revision: DEFAULT_VISUAL_COMPANION_MODEL_REVISION,
          latency_ms: 12
        };
      }
    };
  }
});
assert.equal(fetchCalled, true, "real observe helper calls local service when scene changes");
assert.equal(response.status, 200);
assert.equal(response.json.response_type, "narrate");
assert.equal(response.json.spoken_response, "You lifted an object.");

let staticProviderCalled = false;
const staticResponse = await visualCompanionObserveResponseForRequest({
  frames: [{ ...frameA }, { ...frameB }],
  client_scene_change_score: 0,
  previous_context: {},
  requested_response_mode: "auto",
  memory_mode: "session"
}, {}, {
  fetch: async () => {
    staticProviderCalled = true;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          meaningful_change: false,
          movement_label: null,
          response_type: "uncertain",
          observation_summary: "The frames were similar.",
          spoken_response: "I saw your right hand move slightly, but I could not identify a final gesture.",
          confidence: 0.43,
          uncertainty: true,
          evidence_frames: [1, 2],
          response_source: "local_vlm"
        };
      }
    };
  }
});
assert.equal(staticProviderCalled, true, "low scene scores do not bypass the real provider adapter");
assert.equal(staticResponse.json.response_type, "uncertain");
assert.equal(staticResponse.json.response_source, "local_vlm");
assert.notEqual(staticResponse.json.spoken_response, "No meaningful change detected.");

let staticConversationFetchCalled = false;
const staticConversationResponse = await visualCompanionObserveResponseForRequest({
  frames: [{ ...frameA }, { ...frameB }],
  client_scene_change_score: 0,
  previous_context: {},
  user_question: "What am I holding?",
  requested_response_mode: "conversation",
  interaction_mode: "conversation",
  memory_mode: "session"
}, {}, {
  fetch: async (_url, init) => {
    staticConversationFetchCalled = true;
    const body = JSON.parse(init.body);
    assert.equal(body.interaction_mode, "conversation");
    assert.equal(body.user_question, "What am I holding?");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          response_type: "narrate",
          observation_summary: "The current frame shows an object in hand.",
          spoken_response: "You appear to be holding an object.",
          confidence: 0.7,
          uncertainty: false
        };
      }
    };
  }
});
assert.equal(staticConversationFetchCalled, true, "conversation questions bypass the static no-change shortcut");
assert.equal(staticConversationResponse.json.spoken_response, "You appear to be holding an object.");

const framesToClear = [{ encoded_frame: "abc", data_uri: "data:image/jpeg;base64,abc" }];
clearVisualFramePayloads(framesToClear);
assert.equal(framesToClear.length, 0, "server helper clears frame payload arrays");

const health = await visualCompanionHealth({}, {
  fetch: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { ok: true, status: "ready", model: DEFAULT_VISUAL_COMPANION_MODEL, device: "cpu" };
    }
  })
});
assert.equal(health.status, "ready");
assert.equal(health.token_exposed_to_frontend, false);

const lazyModelHealth = await visualCompanionHealth({}, {
  fetch: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { ok: false, status: "model_not_installed", safe_error: "Model is not loaded yet." };
    }
  })
});
assert.equal(lazyModelHealth.status, "model_not_installed");
assert.equal(lazyModelHealth.observe_endpoint_ready, true, "reachable local service remains eligible for first-use model load");

const unreachableHealth = await visualCompanionHealth({}, {
  fetch: async () => {
    throw new Error("connect failed");
  }
});
assert.equal(unreachableHealth.observe_endpoint_ready, false, "unreachable local service is not treated as observable");

const state = createInitialState();
state.visualContext.memoryMode = "session";
updateVisualContextFromResult(state, {
  movement: "You raised the cup.",
  reason: "The cup moved upward.",
  suggested_actions: [{ action: "start_timer", label: "Start timer", parameters: { duration_seconds: 60 } }]
});
assert.equal(visualContextForRequest(state).last_response, "You raised the cup.");
assert.equal(state.visualContext.suggestedActions.length, 1);

const autoVoice = createNeuralVoiceHarness();
  const runtime = createInitialState();
  runtime.movementRecognition.autoSpeak = true;
  runtime.movementRecognition.health = { provider: VISUAL_COMPANION_CLIENT_CONFIG.provider, status: "ready" };
  queueMovementRecognitionResult(runtime, {
    observation_id: "obs_thumb_1",
    movement: "You gave a thumbs up.",
    spoken_response: "You gave a thumbs up.",
    response_type: "narrate",
    confidence: 0.9,
    reason: "A thumbs-up gesture was visible.",
    evidence: ["thumb visible"],
    suggested_actions: []
  }, 101);
  assert.equal(runtime.movementResultSnapshot.confirmed, false, "auto narration does not require Confirm");
  assert.equal(maybeAutoSpeakVisualResult(runtime, autoVoice.options), true, "new visual result auto-speaks");
  for (let index = 0; index < 20 && runtime.movementRecognition.voiceStatus !== "Voice complete"; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(autoVoice.requests.filter((item) => item.pathname.endsWith("/speak") && item.body?.text === "You gave a thumbs up.").length, 1, "auto speech starts exactly once");
  assert.equal(runtime.movementRecognition.voiceStatus, "Voice complete");
  assert.equal(maybeAutoSpeakVisualResult(runtime, autoVoice.options), false, "rerender/reentry does not repeat speech");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(autoVoice.requests.filter((item) => item.pathname.endsWith("/speak") && item.body?.text === "You gave a thumbs up.").length, 1, "same observation is not spoken twice");
  await speakMovementResult(runtime, autoVoice.options);
  assert.equal(autoVoice.requests.filter((item) => item.pathname.endsWith("/speak") && item.body?.text === "You gave a thumbs up.").length, 2, "Speak again intentionally replays the latest response");
  runtime.movementRecognition.autoSpeak = false;
  queueMovementRecognitionResult(runtime, {
    observation_id: "obs_thumb_2",
    movement: "You waved.",
    spoken_response: "You waved.",
    response_type: "narrate",
    confidence: 0.86,
    reason: "A wave was visible.",
    evidence: ["hand moved"],
    suggested_actions: []
  }, 202);
  assert.equal(maybeAutoSpeakVisualResult(runtime, autoVoice.options), false, "mute blocks automatic speech for the next observation");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(autoVoice.requests.filter((item) => item.pathname.endsWith("/speak") && item.body?.text === "You waved.").length, 0, "muted observation stays silent automatically");
  assert.equal(runtime.movementRecognition.voiceStatus, "Muted");
  assert.equal(runtime.automation.receipts.length, 0, "auto narration does not execute automation");
  assert.equal(runtime.vlmCalls || 0, 0, "speech replay does not call the VLM");
  assert.equal(autoVoice.requests.every((request) => [VISUAL_COMPANION_CLIENT_CONFIG.speakEndpoint, VISUAL_COMPANION_CLIENT_CONFIG.speakStreamEndpoint, VISUAL_COMPANION_CLIENT_CONFIG.cancelEndpoint].includes(request.pathname)), true, "only local visual TTS endpoints are requested");
  assert.equal(autoVoice.requests.some((request) => request.pathname.includes("/observe")), false, "speech never calls visual observe");

  queueMovementRecognitionResult(runtime, {
    observation_id: "obs_silent_1",
    movement: "No meaningful change detected.",
    spoken_response: "No meaningful change detected.",
    response_type: "silent",
    confidence: 0.76,
    uncertainty: false,
    reason: "Static frame shortcut.",
    evidence: ["low_scene_change_score"],
    suggested_actions: []
  }, 303);
  assert.equal(maybeAutoSpeakVisualResult(runtime, autoVoice.options), false, "silent visual context refreshes do not auto-speak");

const localAudioRuntime = createInitialState();
const localAudioRequests = [];
const objectUrlEvents = [];
const URLApi = {
  createObjectURL(blob) {
    objectUrlEvents.push(`create:${blob.size}`);
    return "blob:sensefield-local-voice";
  },
  revokeObjectURL(url) {
    objectUrlEvents.push(`revoke:${url}`);
  }
};
class TestAudio {
  constructor(url) {
    this.url = url;
    this.src = url;
    objectUrlEvents.push(`audio:${url}`);
  }
  play() {
    this.onplaying?.();
    this.onended?.();
    return Promise.resolve();
  }
  pause() {
    objectUrlEvents.push("pause");
  }
  removeAttribute(name) {
    objectUrlEvents.push(`remove:${name}`);
  }
  load() {
    objectUrlEvents.push("load");
  }
}
const localAudioResult = await speakVisualResponse({
  observationId: "obs_local_audio_1",
  text: "You formed a heart shape with your hands."
}, {
  target: localAudioRuntime,
  URLApi,
  AudioCtor: TestAudio,
  fetch: async (url, init = {}) => {
    localAudioRequests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : {} });
    if (String(url) === VISUAL_COMPANION_CLIENT_CONFIG.cancelEndpoint) {
      return {
        ok: true,
        headers: { get: () => "application/json" },
        async json() { return { ok: true, cancelled: true, contains_raw_media: false }; }
      };
    }
    return {
      ok: true,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === "content-type") return "audio/wav";
          if (key === "x-sensefield-voice-engine") return "Kokoro-82M";
          if (key === "x-sensefield-audio-duration-ms") return "250";
          return "";
        }
      },
      async blob() {
        return new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" });
      }
    };
  }
});
assert.equal(localAudioResult.ok, true, "local WAV playback succeeds");
assert.equal(localAudioResult.path, "local_tts");
assert.equal(localAudioRuntime.movementRecognition.voiceStatus, "Voice complete");
assert.equal(localAudioRuntime.movementRecognition.activeSpeechObjectUrl, "", "object URL is cleared after playback");
assert.equal(objectUrlEvents.some((item) => item.startsWith("revoke:blob:sensefield-local-voice")), true, "object URL is revoked");
const speakPayload = localAudioRequests.find((item) => item.url === VISUAL_COMPANION_CLIENT_CONFIG.speakEndpoint)?.body || {};
assert.equal(speakPayload.text, "You formed a heart shape with your hands.");
assert.equal(speakPayload.observation_id, "obs_local_audio_1");
assert.equal("encoded_frame" in speakPayload, false, "TTS payload contains no camera frame");
assert.equal("data_uri" in speakPayload, false, "TTS payload contains no raw media data URI");
assert.equal(localAudioRequests.some((item) => item.url === VISUAL_COMPANION_CLIENT_CONFIG.cancelEndpoint), true, "prior speech is cancelled before local playback");

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
try {
  const realtimeRuntime = createInitialState();
  const trackStops = [];
  const audioTrack = { kind: "audio", stop: () => trackStops.push("audio") };
  const videoTrack = { kind: "video", stop: () => trackStops.push("video") };
  const mediaStream = {
    getTracks: () => [videoTrack, audioTrack],
    getAudioTracks: () => [audioTrack]
  };
  class FakeSpeechRecognition {
    static instance = null;
    constructor() {
      FakeSpeechRecognition.instance = this;
      this.continuous = false;
      this.interimResults = false;
      this.lang = "";
      this.started = false;
      this.aborted = false;
      this.stopped = false;
    }
    start() {
      this.started = true;
      this.onstart?.();
    }
    abort() {
      this.aborted = true;
    }
    stop() {
      this.stopped = true;
    }
  }

  await startRealtimeConversation(realtimeRuntime, { mediaStream, SpeechRecognition: FakeSpeechRecognition });
  assert.equal(realtimeRuntime.realtimeSession.state, "active", "one click starts a persistent active session");
  assert.equal(realtimeRuntime.cameraReady, true, "camera remains active during the session");
  assert.equal(realtimeRuntime.realtimeSession.listeningActive, true, "microphone listening remains active during the session");
  assert.equal(FakeSpeechRecognition.instance.continuous, true, "speech recognition runs continuously");
  assert.equal(FakeSpeechRecognition.instance.interimResults, true, "speech recognition receives interim activity for barge-in");

  let releaseFirstInference;
  const inferenceTasks = [];
  const realtimeOptions = {
    runRealtimeInference: async (target, task) => {
      inferenceTasks.push(task);
      if (task.userTurn?.text === "What am I holding?") {
        await new Promise((resolve) => {
          releaseFirstInference = resolve;
        });
      }
      assert.equal(target.realtimeSession.inferenceInFlight, true, "scheduler exposes one in-flight inference");
    }
  };
  await handleRealtimeUserSpeechTurn(realtimeRuntime, "What am I holding?", realtimeOptions);
  await handleRealtimeUserSpeechTurn(realtimeRuntime, "What color is it?", realtimeOptions);
  assert.equal(inferenceTasks.length, 1, "second user turn waits behind the active inference");
  assert.equal(realtimeRuntime.realtimeSession.queuedUserTurns.length, 1, "second user turn is queued, not lost");
  assert.deepEqual(visualContextForRequest(realtimeRuntime).recent_user_turns.slice(-2), ["What am I holding?", "What color is it?"], "recent user turns enter bounded text context");
  releaseFirstInference();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inferenceTasks.length, 2, "second user turn runs without restarting");

  assert.equal(scheduleRealtimeVisualEvent(realtimeRuntime, {
    fingerprint: "left_hand:0.8",
    timestamp_ms: 500,
    score: 0.82
  }, realtimeOptions), false, "conversation mode does not queue proactive visual events");
  assert.equal(realtimeRuntime.realtimeSession.queuedVisualEvent, null, "conversation leaves proactive visual events empty");

  let paused = false;
  realtimeRuntime.interactionState.assistantSpeaking = true;
  realtimeRuntime.movementRecognition.latestSpokenResponse = "This is a longer answer.";
  realtimeRuntime.movementRecognition.activeSpeechAudio = {
    pause: () => { paused = true; },
    removeAttribute: () => {},
    load: () => {}
  };
  interruptAssistantSpeech(realtimeRuntime, "user_speech");
  assert.equal(paused, true, "barge-in stops active playback immediately");
  assert.equal(realtimeRuntime.realtimeSession.assistantSpeaking, false, "barge-in clears assistant speaking capability");
  assert.equal(realtimeRuntime.realtimeSession.memory.interruptedResponses.length, 1, "interrupted assistant text is preserved");

  await endRealtimeConversation(realtimeRuntime, { fetch: async () => ({ ok: true }) });
  assert.equal(realtimeRuntime.realtimeSession.state, "inactive", "ending returns to inactive state");
  assert.deepEqual(trackStops.sort(), ["audio", "video"], "ending stops camera and microphone tracks");
  assert.equal(FakeSpeechRecognition.instance.aborted, true, "ending aborts speech recognition");
  assert.equal(realtimeRuntime.cameraReady, false, "ending clears camera readiness");
  assert.equal(realtimeRuntime.realtimeSession.queuedUserTurns.length, 0, "ending clears user queue");

  await startRealtimeConversation(realtimeRuntime, { mediaStream, SpeechRecognition: FakeSpeechRecognition });
  assert.equal(realtimeRuntime.realtimeSession.memory.userTurns.length, 0, "restart creates a fresh conversation memory");
  await endRealtimeConversation(realtimeRuntime, { fetch: async () => ({ ok: true }) });
} finally {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
}

assert.equal(contract.includes("response_type"), true);
assert.equal(contract.includes("spoken_response"), true);
assert.equal(contract.includes("suggested_actions"), true);

console.log("visual companion tests passed");
