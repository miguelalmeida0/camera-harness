import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createInitialState,
  endRealtimeConversation,
  handleRealtimeUserSpeechTurn,
  queueMovementRecognitionResult,
  speakVisualResponse,
  startRealtimeConversation,
  validateLiveFrameWindow,
  visualContextForRequest
} from "../prototype/local-capture.js";
import { visualCompanionObserveResponseForRequest } from "../server/visual-companion-provider.mjs";
import { createNeuralVoiceHarness } from "./neural-voice-fixture.mjs";

const source = readFileSync(new URL("../prototype/local-capture.js", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../server/visual-companion-provider.mjs", import.meta.url), "utf8");

const voice = createNeuralVoiceHarness();

const videoTrack = { kind: "video", readyState: "live", stop() { this.readyState = "ended"; } };
const audioTrack = { kind: "audio", readyState: "live", stop() { this.readyState = "ended"; } };
const stream = {
  getTracks: () => [videoTrack, audioTrack],
  getVideoTracks: () => [videoTrack],
  getAudioTracks: () => [audioTrack]
};
class Recognition {
  start() { this.onstart?.(); }
  abort() {}
  stop() {}
}

const runtime = createInitialState();
  await startRealtimeConversation(runtime, { mediaStream: stream, SpeechRecognition: Recognition });
  const inferenceCalls = [];
  let activeInference = 0;
  let maxInference = 0;
  const options = {
    runRealtimeInference: async (target, task) => {
      activeInference += 1;
      maxInference = Math.max(maxInference, activeInference);
      try {
        inferenceCalls.push({
          text: task.userTurn.text,
          visual_context: visualContextForRequest(target)
        });
        const turn = inferenceCalls.length;
        const text = turn === 1 ? "Yes, I can hear you." : "I can see the current camera view.";
        queueMovementRecognitionResult(target, {
          observation_id: `conversation_${turn}`,
          movement: text,
          spoken_response: text,
          response_type: "narrate",
          confidence: 0.8,
          uncertainty: false,
          provider: "local_visual_companion",
          model: "test-provider-adapter",
          response_source: "local_vlm"
        }, performance.now(), { recordMovementHistory: false, queueSuggestion: false });
        await speakVisualResponse({ observationId: `conversation_${turn}`, text }, {
          target,
          ...voice.options
        });
      } finally {
        activeInference -= 1;
      }
    }
  };

  const first = await handleRealtimeUserSpeechTurn(runtime, "Can you hear me?", options);
  const duplicate = await handleRealtimeUserSpeechTurn(runtime, "Can you hear me?", options);
  assert.equal(first.ok, true);
  assert.equal(duplicate.code, "duplicate_final_transcript");
  await waitFor(() => inferenceCalls.length === 1 && runtime.interactionState.inferenceInFlight === false);
  assert.equal(runtime.conversationMemory.userTurns.length, 1, "one finalized sentence creates one user turn");
  assert.equal(typeof inferenceCalls[0].visual_context, "object", "conversation request includes current visual context");
  assert.equal(runtime.movementResultSnapshot.spoken_response, "Yes, I can hear you.");
  assert.equal(runtime.movementRecognition.voiceStatus, "Voice complete");
  assert.equal(runtime.interactionState.listeningActive, true);

  await handleRealtimeUserSpeechTurn(runtime, "What can you see?", options);
  await waitFor(() => inferenceCalls.length === 2 && runtime.interactionState.inferenceInFlight === false);
  assert.equal(runtime.conversationMemory.userTurns.length, 2);
  assert.equal(runtime.movementResultSnapshot.spoken_response, "I can see the current camera view.");
  assert.equal(maxInference, 1, "maximum one inference is in flight");
  assert.equal(voice.requests.filter((request) => request.pathname.endsWith("/speak")).length, 2);
  assert.equal(voice.maxActiveCount, 1);
  assert.equal(runtime.realtimeSession.processingTranscript, false);

  const frameNow = performance.now();
  const observingStream = { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] };
  const observingRuntime = createInitialState();
  observingRuntime.stream = observingStream;
  const frames = [
    { width: 384, height: 216, captured_at_ms: frameNow, luma_signature: [0.1, 0.1], encoded_frame: "YQ==", data_uri: "data:image/jpeg;base64,YQ==", mime_type: "image/jpeg" },
    { width: 384, height: 216, captured_at_ms: frameNow + 10, luma_signature: [0.5, 0.1], encoded_frame: "Yg==", data_uri: "data:image/jpeg;base64,Yg==", mime_type: "image/jpeg" }
  ];
  assert.equal(validateLiveFrameWindow(frames, observingRuntime, { requireChange: true }).ordered, true);

  const providerResults = [
    { meaningful_change: true, movement_label: "peace_sign", spoken_response: "You raised your hand and made a peace sign.", confidence: 0.91, evidence_frames: [1, 2] },
    { meaningful_change: true, movement_label: "thumbs_up", spoken_response: "You raised your hand and gave a thumbs up.", confidence: 0.93, evidence_frames: [1, 2] }
  ];
  let providerCalls = 0;
  for (const expected of providerResults) {
    const requestFrames = frames.map((frame) => ({ ...frame }));
    const response = await visualCompanionObserveResponseForRequest({
      frames: requestFrames,
      frame_timestamps_ms: requestFrames.map((frame) => frame.captured_at_ms),
      interaction_mode: "observing",
      requested_response_mode: "movement_observation",
      client_scene_change_score: 0.4
    }, {}, {
      fetch: async () => {
        providerCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ...expected,
              response_type: "narrate",
              observation_summary: expected.spoken_response,
              uncertainty: false,
              provider: "local_visual_companion",
              model: "real-provider-adapter-test",
              response_source: "local_vlm"
            };
          }
        };
      }
    });
    assert.equal(response.json.movement_label, expected.movement_label);
    assert.equal(response.json.spoken_response, expected.spoken_response);
    assert.equal(response.json.response_source, "local_vlm");
    assert.deepEqual(response.json.evidence_frames, [1, 2]);
  }
  assert.equal(providerCalls, 2, "peace sign and thumbs up each invoke the provider adapter");

  let productionFetchCalled = false;
  const productionResult = await visualCompanionObserveResponseForRequest({ frames: frames.map((frame) => ({ ...frame })) }, {}, {
    mockResult: { spoken_response: "fixture result", response_type: "narrate", confidence: 1 },
    fetch: async () => {
      productionFetchCalled = true;
      return { ok: true, status: 200, async json() { return { response_type: "uncertain", spoken_response: "Provider result.", confidence: 0.4, uncertainty: true }; } };
    }
  });
  assert.equal(productionFetchCalled, true, "deterministic fixtures cannot bypass the production provider path");
  assert.notEqual(productionResult.json.response_source, "deterministic_test_fixture");
  assert.equal(providerSource.includes("responseForStaticWindow"), false, "generic canned static response is removed");
  assert.equal(/MediaRecorder|toDataURL|readAsDataURL|indexedDB|navigator\.sendBeacon/.test(source), false, "runtime does not persist raw media");
  assert.equal(/Authorization:\s*`Bearer|hf_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{12,}/.test(source), false, "frontend exposes no provider token value");

  const heldVoice = createNeuralVoiceHarness({ autoEnd: false });
  const heldSpeechRuntime = createInitialState();
  const heldSpeech = speakVisualResponse({ observationId: "held_voice", text: "Sensefield voice test." }, {
    target: heldSpeechRuntime,
    ...heldVoice.options
  });
  await waitFor(() => heldVoice.instances[0]?.playing === true);
  assert.equal(heldSpeechRuntime.movementRecognition.voiceStatus, "Speaking…", "Voice complete is not shown before onend");
  heldVoice.instances[0].end();
  await heldSpeech;
  assert.equal(heldSpeechRuntime.movementRecognition.voiceStatus, "Voice complete");

  const errorSpeechRuntime = createInitialState();
  const failedSpeech = await speakVisualResponse({ observationId: "error_voice", text: "Sensefield voice test." }, {
    target: errorSpeechRuntime,
    fetch: async () => ({ ok: true, headers: { get: () => "application/json" }, async json() { return { ok: false }; } })
  });
  assert.equal(failedSpeech.ok, false);
  assert.equal(errorSpeechRuntime.movementRecognition.voiceStatus, "Voice unavailable");

await endRealtimeConversation(runtime, voice.options);
console.log("p0 live runtime tests passed");

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for runtime transition");
}
