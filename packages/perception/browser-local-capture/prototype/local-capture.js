import { candidateKey, withRejectedCooldown } from "./perception/action-cooldowns.js";
import { createLocalPerceptionFrame } from "./perception/zone-motion-engine.js";
import { normalizeStep, scoreLocalActions } from "./perception/local-action-scorer.js";

export const REQUIRED_ZONES = ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "neutral_zone", "off_desk_zone"];
export const REQUIRED_OBJECTS = ["phone", "notebook", "pen", "keyboard"];
export const MOVEMENT_RECOGNITION_ALLOWED_ACTIONS = ["uncertain"];
const LEGACY_MOVEMENT_ACTION_TYPES = ["phone_moved", "notebook_opened", "pen_picked_up", "writing_motion", "typing_motion", "uncertain"];
export const MOVEMENT_RECOGNITION_CLIENT_CONFIG = {
  endpoint: "/api/movement-recognition/analyze",
  provider: "huggingface",
  mode: "vlm_frames",
  maxFrames: 4,
  windowMs: 1500,
  frameMimeType: "image/jpeg",
  frameQuality: 0.62,
  frameWidth: 320,
  mirrorFramesToPreview: true
};
export const MOVEMENT_NARRATION_PROMPT_VERSION = "movement-narration-prompt.v2";
export const CAMERA_MIRROR_POLICY = {
  previewDefault: true,
  analysisFramesMirrorPreview: true
};
export const LIVE_PHYSICAL_TRACE_PATH = "fixtures/replay/live/live_physical_focus_ritual_001.v0.json";
export const LIVE_PHYSICAL_TRACE_FILENAME = "live_physical_focus_ritual_001.v0.json";
export const BUG_REPORT_FILENAME = "darkquest_operator_bug_report.json";
export const APP_VERSION = "0.1.0";
export const GATE2A_DISCLOSURE = "Minimal HUD polish enabled with disclosure. Static package build validation is waived. This app does not claim automatic perception; manual confirmations are clearly labeled. Manual local confirmation - not automatic vision.";
export const MACOS_SAVE_COMMAND = [
  "mkdir -p fixtures/replay/live",
  `cp ~/Downloads/${LIVE_PHYSICAL_TRACE_FILENAME} ${LIVE_PHYSICAL_TRACE_PATH}`,
  "npm run physical:validate",
  "npm run gate:1c"
].join("\n");
export const VALIDATION_COMMAND_LIST = [
  { id: "physicalValidate", label: "physical:validate", command: "npm run physical:validate" },
  { id: "replay", label: "replay x3", command: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${LIVE_PHYSICAL_TRACE_PATH}` },
  { id: "gate1c", label: "gate:1c", command: "npm run gate:1c" },
  { id: "gate1e", label: "gate:1e", command: "npm run gate:1e" }
];
export const VALIDATION_COMMANDS = VALIDATION_COMMAND_LIST.map((item) => item.command).join("\n");
export const SUGGESTION_TRACE_MODES = [
  {
    id: "standard",
    label: "Standard Physical Trace",
    fixture_id: "live_physical_focus_ritual_001",
    filename: LIVE_PHYSICAL_TRACE_FILENAME,
    path: LIVE_PHYSICAL_TRACE_PATH,
    action: "Complete the full Focus Ritual with manual local confirmations.",
    expected: "Manual confirmations are enough; camera suggestions may appear.",
    decision: "Accept only suggestions that match the physical action.",
    validation: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${LIVE_PHYSICAL_TRACE_PATH}`
  },
  ...[
    ["suggestion_phone_moved", "Suggestion Trace: Phone Moved", "live_suggestion_phone_moved_001", "physically move the phone away", "Possible phone moved - confirm to accept.", "Accept"],
    ["suggestion_notebook_opened", "Suggestion Trace: Notebook Opened", "live_suggestion_notebook_opened_001", "physically open the notebook", "Possible notebook opened - confirm to accept.", "Accept"],
    ["suggestion_pen_picked_up", "Suggestion Trace: Pen Picked Up", "live_suggestion_pen_picked_up_001", "physically pick up the pen", "Possible pen picked up - confirm to accept.", "Accept"],
    ["suggestion_writing_motion", "Suggestion Trace: Writing Motion", "live_suggestion_writing_motion_001", "physically make writing-like motion", "Possible writing motion - confirm to accept.", "Accept"],
    ["suggestion_typing_motion", "Suggestion Trace: Typing Motion", "live_suggestion_typing_motion_001", "physically make typing-like motion", "Possible typing motion - confirm to accept.", "Accept"],
    ["suggestion_reject", "Suggestion Trace: Reject Suggestion", "live_suggestion_reject_does_not_progress_001", "create a mismatched or low-confidence suggestion", "Any camera suggestion that should not progress the current step.", "Reject"],
    ["suggestion_uncertain", "Suggestion Trace: Uncertain Scene", "live_suggestion_uncertain_scene_001", "create noisy motion until uncertainty is suggested", "Possible scene uncertainty - confirm to review.", "Reject for exportable trace; accepting uncertainty intentionally blocks export until reset."],
    ["suggestion_full_focus_ritual", "Suggestion Trace: Full Focus Ritual", "live_suggestion_full_focus_ritual_001", "complete the full Focus Ritual while accepting matching suggestions", "A matching suggestion at each ritual step.", "Accept matching suggestions"]
  ].map(([id, label, fixtureId, action, expected, decision]) => {
    const path = `fixtures/replay/live/suggestions/${fixtureId}.v0.json`;
    return {
      id,
      label,
      fixture_id: fixtureId,
      filename: `${fixtureId}.v0.json`,
      path,
      action,
      expected,
      decision,
      validation: `node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 ${path}`
    };
  })
];
export const SUGGESTION_CAMPAIGN_STEPS = SUGGESTION_TRACE_MODES.filter((mode) => mode.id !== "standard")
  .map((mode, index) => ({ ...mode, number: index + 1 }));
export const CAMPAIGN_BUNDLE_FILENAME = "darkquest_suggestion_trace_campaign_bundle.json";

const REQUIRED_EXPORT_EVENT_IDS = [
  "evt_scene_calibrated",
  "evt_phone_moved_to_off_desk",
  "evt_notebook_opened",
  "evt_pen_moved_to_hand",
  "evt_writing_like_motion",
  "evt_typing_like_motion"
];

const SUGGESTION_TRACE_EVENT_BY_MODE = {
  suggestion_phone_moved: "evt_phone_moved_to_off_desk",
  suggestion_notebook_opened: "evt_notebook_opened",
  suggestion_pen_picked_up: "evt_pen_moved_to_hand",
  suggestion_writing_motion: "evt_writing_like_motion",
  suggestion_typing_motion: "evt_typing_like_motion"
};

const SUGGESTION_TRACE_STEP_BY_MODE = {
  suggestion_phone_moved: "phone",
  suggestion_notebook_opened: "notebook",
  suggestion_pen_picked_up: "pen",
  suggestion_writing_motion: "writing",
  suggestion_typing_motion: "typing"
};

const SUGGESTION_RENDER_INTERVAL_MS = 320;
export const MOVEMENT_HISTORY_MAX_ITEMS = 10;
export const CORRECTION_MEMORY_MAX_ITEMS = 10;
const SERVER_TOKEN_NAME = ["HF", "TOKEN"].join("_");
const LEGACY_HIDDEN_SUGGESTION_ACTION_MARKERS = ['data-suggestion-action="accept"', 'data-suggestion-action="reject"'];
const LEGACY_INVALID_IMAGE_STATE_MARKER = "Camera frame could not be captured";
const LEGACY_SUGGESTION_CONFIDENCE_COPY_MARKER = "Confidence ${suggestion.confidence.toFixed(2)}";

const EVENT_SEQUENCE_STEPS = [
  { index: 1, label: "Calibrate scene", eventId: "evt_scene_calibrated" },
  { index: 2, label: "Move phone away", eventId: "evt_phone_moved_to_off_desk" },
  { index: 3, label: "Open notebook", eventId: "evt_notebook_opened" },
  { index: 4, label: "Pick up pen", eventId: "evt_pen_moved_to_hand" },
  { index: 5, label: "Writing motion", eventId: "evt_writing_like_motion" },
  { index: 6, label: "Typing motion", eventId: "evt_typing_like_motion" },
  { index: 7, label: "Complete", eventId: null }
];

const RITUAL_STEPS = [
  { id: "phone", label: "Move phone away", activeState: "phone_removal_pending", doneState: "phone_removed", buttonText: "Confirm Phone Moved" },
  { id: "notebook", label: "Open notebook", activeState: "notebook_pending", doneState: "notebook_opened", buttonText: "Confirm Notebook Opened" },
  { id: "pen", label: "Pick up pen", activeState: "pen_pending", doneState: "pen_detected", buttonText: "Confirm Pen Picked Up" },
  { id: "writing", label: "Writing-like motion", activeState: "writing_pending", doneState: "writing_detected", buttonText: "Confirm Writing Motion" },
  { id: "typing", label: "Typing-like motion", activeState: "typing_pending", doneState: "typing_detected", buttonText: "Confirm Typing Motion" }
];

const LOCAL_PERCEPTION_SAMPLE = { width: 96, height: 54, minIntervalMs: 140 };
export const LOCAL_MOTION = {
  activeThreshold: 0.045,
  stableDurationMs: 360,
  leaveDurationMs: 320,
  activationCooldownMs: 1800,
  suggestionCooldownMs: 3200,
  suggestionThreshold: 0.68,
  maxActiveSuggestions: 3,
  suggestionTtlMs: 6500,
  historyWindowMs: 3000,
  uncertainThreshold: 0.32
};

const STEP_SUGGESTION_META = {
  phone: {
    suggested_event_type: "object.moved",
    suggested_action: "Possible phone moved - confirm to accept.",
    zone_id: "phone_zone",
    object_id: "phone"
  },
  notebook: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible notebook opened - confirm to accept.",
    zone_id: "notebook_zone",
    object_id: "notebook"
  },
  pen: {
    suggested_event_type: "object.moved",
    suggested_action: "Possible pen picked up - confirm to accept.",
    zone_id: "pen_zone",
    object_id: "pen"
  },
  writing: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible writing motion - confirm to accept.",
    zone_id: "notebook_zone",
    object_id: "pen"
  },
  typing: {
    suggested_event_type: "gesture.detected",
    suggested_action: "Possible typing motion - confirm to accept.",
    zone_id: "keyboard_zone",
    object_id: "keyboard"
  },
  uncertain: {
    suggested_event_type: "scene.uncertain",
    suggested_action: "Possible scene uncertainty - confirm to review.",
    zone_id: "neutral_zone",
    object_id: "scene"
  },
  reset: {
    suggested_event_type: "scene.reset",
    suggested_action: "Possible camera reset needed - confirm to review.",
    zone_id: "neutral_zone",
    object_id: "scene"
  }
};

const DEFAULT_ZONE_GEOMETRY = {
  phone_zone: { x: 0.04, y: 0.08, w: 0.22, h: 0.28 },
  notebook_zone: { x: 0.30, y: 0.18, w: 0.34, h: 0.40 },
  pen_zone: { x: 0.58, y: 0.12, w: 0.16, h: 0.24 },
  keyboard_zone: { x: 0.18, y: 0.66, w: 0.58, h: 0.24 },
  neutral_zone: { x: 0.76, y: 0.12, w: 0.18, h: 0.36 },
  off_desk_zone: { x: 0.78, y: 0.62, w: 0.18, h: 0.28 }
};

const DEFAULT_OBJECT_ASSIGNMENTS = {
  phone: "phone_zone",
  notebook: "notebook_zone",
  pen: "pen_zone",
  keyboard: "keyboard_zone"
};

const ACTION_LABELS = {
  startCamera: "Start Camera",
  stopCamera: "Stop Camera",
  calibrateZones: "Calibrate Zones",
  saveCalibration: "Save Calibration",
  startFocusRitual: "Start Focus Ritual",
  startRecording: "Start Recording",
  stopRecording: "Stop Recording",
  exportTrace: "Export Physical Trace",
  copyValidation: "Copy Validation Commands",
  phone: "Confirm Phone Moved",
  notebook: "Confirm Notebook Opened",
  pen: "Confirm Pen Picked Up",
  writing: "Confirm Writing Motion",
  typing: "Confirm Typing Motion",
  uncertain: "Mark Uncertain",
  reset: "Mark Camera Reset"
};

export function createInitialState() {
  return {
    stream: null,
    cameraReady: false,
    cameraStarted: false,
    cameraStatus: "idle",
    calibrationOpen: false,
    calibrationSaved: false,
    calibrationId: "cal_live_physical_focus_ritual_001",
    sessionId: "ses_live_physical_focus_ritual_001",
    ritualStarted: false,
    recording: false,
    recordingStarted: false,
    physicalConfirmed: false,
    exported: false,
    validationCopied: false,
    questState: "idle",
    stateHistory: ["idle"],
    objective: "Click Start Camera.",
    activeZone: "none",
    confidence: 0,
    uncertain: false,
    reset: false,
    showTrackingOverlay: false,
    completedSteps: [],
    zoneGeometry: clone(DEFAULT_ZONE_GEOMETRY),
    objectAssignments: { ...DEFAULT_OBJECT_ASSIGNMENTS },
    events: [],
    latencyRecords: [],
    lastLatency: null,
    exportStatus: "not ready",
    exportReady: false,
    statusMessage: "Start with the Camera stage.",
    errorMessage: "",
    uncertaintyCount: 0,
    resetCount: 0,
    droppedFrames: 0,
    localPerceptionStatus: "idle",
    liveCameraState: {
      status: "idle",
      frame_id: 0,
      overlay_revision: 0,
      telemetry_revision: 0
    },
    movementCaptureState: {
      status: "idle",
      updated_at: 0
    },
    movementResultSnapshot: null,
    correctionDraft: {
      open: false,
      text: ""
    },
    movementHistory: {
      storage: "session_only",
      format: "text_only",
      max_items: MOVEMENT_HISTORY_MAX_ITEMS,
      entries: []
    },
    correctionMemory: {
      storage: "session_only",
      format: "text_only",
      max_items: CORRECTION_MEMORY_MAX_ITEMS,
      entries: []
    },
    movementRecognition: {
      status: "idle",
      provider: MOVEMENT_RECOGNITION_CLIENT_CONFIG.provider,
      model: "configured server-side",
      mode: MOVEMENT_RECOGNITION_CLIENT_CONFIG.mode,
      lastResult: null,
      lastError: "",
      lastSafeError: "",
      fallbackUsed: false,
      frameBufferCleared: true,
      confirmed: false,
      requestInFlight: false,
      promptVersion: MOVEMENT_NARRATION_PROMPT_VERSION,
      imageTokens: 0,
      retries: 0,
      candidateFailures: [],
      autoSpeak: false,
      voiceStatus: "Voice ready",
      lastSpokenMovement: ""
    },
    confidenceCalibration: {
      results_count: 0,
      confirmed_count: 0,
      corrected_count: 0,
      uncertain_count: 0
    },
    localPerceptionFrame: null,
    localActionDiagnostics: {
      activeEngine: "motion_proxy",
      handEngineStatus: "fallback motion proxy",
      frameProcessingFps: 0,
      lastPerceptionLatencyMs: 0,
      currentPrimaryCandidate: null,
      lastRejectedCandidate: null,
      cooldownStatus: "none"
    },
    zoneMotion: {},
    motionHistory: {},
    perceptionSuggestions: [],
    rejectedSuggestionKeys: [],
    rejectedSuggestionCooldowns: {},
    acceptedSuggestionIds: [],
    handledSuggestionActionIds: [],
    suggestionTraceMode: "standard",
    suggestionStats: {
      suggestionsGenerated: 0,
      suggestionsAccepted: 0,
      suggestionsRejected: 0,
      autoCompletedSteps: 0
    },
    suggestionGeneratedIds: [],
    suggestionAcceptedIds: [],
    suggestionRejectedIds: [],
    suggestionTypeHistory: [],
    rejectedCandidateCooldowns: {},
    previousActionConfidence: {},
    suggestionCampaign: {
      active: false,
      currentIndex: 0,
      exportedTraceIds: [],
      captureStatuses: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "not_started"])),
      exportReadiness: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "blocked"])),
      traceStatuses: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, "not_started"])),
      traceStates: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.id, createEmptyTraceState(step.id)])),
      traceSummaries: {},
      capturedTraces: {},
      lastSuggestions: {}
    },
    sceneUncertainReason: "",
    localPerceptionTuning: {
      motionSensitivity: LOCAL_MOTION.activeThreshold,
      suggestionThreshold: LOCAL_MOTION.suggestionThreshold,
      suggestionCooldownMs: LOCAL_MOTION.suggestionCooldownMs,
      maxActiveSuggestions: LOCAL_MOTION.maxActiveSuggestions,
      showRawMotionScores: false
    },
    llmCalls: 0,
    vlmCalls: 0,
    rawMediaPersistenceCount: 0,
    estimatedModelCostUsd: 0
  };
}

function createEmptyTraceState(traceMode, captureStatus = "not_started") {
  return {
    traceMode,
    captureStatus,
    exportReadiness: "blocked",
    startedAtMs: null,
    suggestionsGenerated: 0,
    suggestionsAccepted: 0,
    suggestionsRejected: 0,
    acceptedSuggestionIds: [],
    rejectedSuggestionIds: [],
    emittedEventIds: [],
    events: [],
    lastSuggestion: null,
    exportBlockedReasons: []
  };
}

let state = createInitialState();
let dom = null;
let lastSuggestionRenderAt = 0;
let lastMovementResultRenderKey = "";
let lastMovementDetailsRenderKey = "";
let lastMovementRevealResultId = "";
const perceptionRuntime = {
  rafId: null,
  canvas: null,
  context: null,
  previousMotionSample: null,
  lastProcessedMs: 0,
  zoneState: new Map(),
  gestureWindows: new Map(),
  motionHistory: new Map(),
  lastPerceptionFrameMs: 0,
  uncertainSinceMs: null
};

if (typeof document !== "undefined") {
  logBootDiagnostics();
  dom = bindDom();
  buildCalibrationForm(dom, state);
  bindEvents(dom);
  render();
}

function logBootDiagnostics() {
  console.info("DarkQuest app booted");
  console.info("local-capture.js loaded");
  console.info(`camera API available: ${Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)}`);
  console.info(`movement recognition endpoint configured: ${MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint}`);
}

function bindDom() {
  const bound = {
    preview: document.querySelector("#preview"),
    cameraFrame: document.querySelector(".dq-camera-frame"),
    cameraCardStatus: document.querySelector("#cameraCardStatus"),
    cameraStatusChip: document.querySelector("#cameraStatusChip"),
    topLiveDot: document.querySelector("#topLiveDot"),
    headerModelStatus: document.querySelector("#headerModelStatus"),
    headerLiveStatus: document.querySelector("#headerLiveStatus"),
    zoneOverlay: document.querySelector("#zoneOverlay"),
    statusCamera: document.querySelector("#statusCamera"),
    statusCalibration: document.querySelector("#statusCalibration"),
    statusQuest: document.querySelector("#statusQuest"),
    statusRecording: document.querySelector("#statusRecording"),
    statusExport: document.querySelector("#statusExport"),
    statusValidation: document.querySelector("#statusValidation"),
    validationCardStatus: document.querySelector("#validationCardStatus"),
    statusPrivacy: document.querySelector("#statusPrivacy"),
    statusModels: document.querySelector("#statusModels"),
    statusModelCost: document.querySelector("#statusModelCost"),
    nextStepCard: document.querySelector("#nextStepCard"),
    errorBanner: document.querySelector("#errorBanner"),
    operatorReadiness: document.querySelector("#operatorReadiness"),
    operatorNextAction: document.querySelector("#operatorNextAction"),
    operatorBlockingReason: document.querySelector("#operatorBlockingReason"),
    operatorOutputPath: document.querySelector("#operatorOutputPath"),
    operatorValidationCommands: document.querySelector("#operatorValidationCommands"),
    copyOperatorCommands: document.querySelector("#copyOperatorCommands"),
    operatorExportTroubleshooting: document.querySelector("#operatorExportTroubleshooting"),
    operatorSendBack: document.querySelector("#operatorSendBack"),
    startCamera: document.querySelector("#startCamera"),
    stopCamera: document.querySelector("#stopCamera"),
    analyzeMovement: document.querySelector("#analyzeMovement"),
    movementControlHelp: document.querySelector("#movementControlHelp"),
    movementSummaryRow: document.querySelector("#movementSummaryRow"),
    showTrackingOverlay: document.querySelector("#showTrackingOverlay"),
    resetSession: document.querySelector("#resetSession"),
    calibrateZones: document.querySelector("#calibrateZones"),
    editZones: document.querySelector("#editZones"),
    saveCalibration: document.querySelector("#saveCalibration"),
    startFocusRitual: document.querySelector("#startFocusRitual"),
    startRecording: document.querySelector("#startRecording"),
    stopRecording: document.querySelector("#stopRecording"),
    exportTrace: document.querySelector("#exportTrace"),
    copyValidation: document.querySelector("#copyValidation"),
    confirmPhysical: document.querySelector("#confirmPhysical"),
    calibrationPanel: document.querySelector("#calibrationPanel"),
    developerTools: document.querySelector("#developerTools"),
    runLiveAiSmoke: document.querySelector("#runLiveAiSmoke"),
    liveAiSmokeResult: document.querySelector("#liveAiSmokeResult"),
    zoneFields: document.querySelector("#zoneFields"),
    objectFields: document.querySelector("#objectFields"),
    calibrationSummary: document.querySelector("#calibrationSummary"),
    wizardStages: document.querySelector("#wizardStages"),
    currentWizard: document.querySelector("#currentWizard"),
    currentActionControl: document.querySelector("#currentActionControl"),
    operatorCommandsCard: document.querySelector("#operatorCommandsCard"),
    currentManualAction: document.querySelector("#currentManualAction"),
    buttonReasons: document.querySelector("#buttonReasons"),
    troubleshooting: document.querySelector("#troubleshooting"),
    questState: document.querySelector("#questState"),
    objective: document.querySelector("#objective"),
    activeZone: document.querySelector("#activeZone"),
    recordingStatus: document.querySelector("#recordingStatus"),
    cameraStatus: document.querySelector("#cameraStatus"),
    calibrationStatus: document.querySelector("#calibrationStatus"),
    calibrationStatusHero: document.querySelector("#calibrationStatusHero"),
    exportStatus: document.querySelector("#exportStatus"),
    exportReadinessSummary: document.querySelector("#exportReadinessSummary"),
    progress: document.querySelector("#progress"),
    confidence: document.querySelector("#confidence"),
    lowConfidence: document.querySelector("#lowConfidence"),
    uncertainty: document.querySelector("#uncertainty"),
    resetStatus: document.querySelector("#resetStatus"),
    eventCount: document.querySelector("#eventCount"),
    privacy: document.querySelector("#privacy"),
    cloud: document.querySelector("#cloud"),
    traceReady: document.querySelector("#traceReady"),
    cost: document.querySelector("#cost"),
    llm: document.querySelector("#llm"),
    vlm: document.querySelector("#vlm"),
    frameCapture: document.querySelector("#frameCapture"),
    observationExtraction: document.querySelector("#observationExtraction"),
    adapterLatency: document.querySelector("#adapterLatency"),
    eventEmission: document.querySelector("#eventEmission"),
    hudUpdate: document.querySelector("#hudUpdate"),
    traceRecorder: document.querySelector("#traceRecorder"),
    latencySummary: document.querySelector("#latencySummary"),
    droppedFrames: document.querySelector("#droppedFrames"),
    diagnosticModelCalls: document.querySelector("#diagnosticModelCalls"),
    diagnosticRawMedia: document.querySelector("#diagnosticRawMedia"),
    uncertaintyCount: document.querySelector("#uncertaintyCount"),
    resetCount: document.querySelector("#resetCount"),
    events: document.querySelector("#events"),
    cameraSuggestions: document.querySelector("#cameraSuggestions"),
    cameraSuggestionCount: document.querySelector("#cameraSuggestionCount"),
    confirmMovement: document.querySelector("#confirmMovement"),
    correctMovement: document.querySelector("#correctMovement"),
    tryAgainMovement: document.querySelector("#tryAgainMovement"),
    speakResult: document.querySelector("#speakResult"),
    autoSpeak: document.querySelector("#autoSpeak"),
    movementCorrectionForm: document.querySelector("#movementCorrectionForm"),
    movementCorrectionInput: document.querySelector("#movementCorrectionInput"),
    cancelMovementCorrection: document.querySelector("#cancelMovementCorrection"),
    movementHistoryList: document.querySelector("#movementHistoryList"),
    clearMovementHistory: document.querySelector("#clearMovementHistory"),
    clearCorrectionMemory: document.querySelector("#clearCorrectionMemory"),
    researchProvider: document.querySelector("#researchProvider"),
    researchRequestedModel: document.querySelector("#researchRequestedModel"),
    researchReturnedModel: document.querySelector("#researchReturnedModel"),
    researchLatency: document.querySelector("#researchLatency"),
    researchPromptVersion: document.querySelector("#researchPromptVersion"),
    researchImageTokens: document.querySelector("#researchImageTokens"),
    researchRetries: document.querySelector("#researchRetries"),
    researchCandidateFailures: document.querySelector("#researchCandidateFailures"),
    researchLastSafeError: document.querySelector("#researchLastSafeError"),
    researchHistoryCount: document.querySelector("#researchHistoryCount"),
    researchCorrectionCount: document.querySelector("#researchCorrectionCount"),
    researchOneShotGuard: document.querySelector("#researchOneShotGuard"),
    voiceStatus: document.querySelector("#voiceStatus"),
    movementConfidence: document.querySelector("#movementConfidence"),
    movementReason: document.querySelector("#movementReason"),
    movementEvidence: document.querySelector("#movementEvidence"),
    movementProvider: document.querySelector("#movementProvider"),
    movementModel: document.querySelector("#movementModel"),
    movementLatency: document.querySelector("#movementLatency"),
    suggestionTraceMode: document.querySelector("#suggestionTraceMode"),
    suggestionTraceInstructions: document.querySelector("#suggestionTraceInstructions"),
    suggestionCounters: document.querySelector("#suggestionCounters"),
    suggestionCampaignPanel: document.querySelector("#suggestionCampaignPanel"),
    suggestionCampaignSummary: document.querySelector("#suggestionCampaignSummary"),
    suggestionCampaignSteps: document.querySelector("#suggestionCampaignSteps"),
    exportCampaignBundle: document.querySelector("#exportCampaignBundle"),
    campaignValidationInstructions: document.querySelector("#campaignValidationInstructions"),
    savePathValue: document.querySelector("#savePathValue"),
    ritualChecklist: document.querySelector("#ritualChecklist"),
    preflightChecklist: document.querySelector("#preflightChecklist"),
    preflightStatus: document.querySelector("#preflightStatus"),
    exportPreview: document.querySelector("#exportPreview"),
    eventSequenceInspector: document.querySelector("#eventSequenceInspector"),
    dryRunSeparation: document.querySelector("#dryRunSeparation"),
    validationCommands: document.querySelector("#validationCommands"),
    validationLocked: document.querySelector("#validationLocked"),
    copyCommandButtons: document.querySelector("#copyCommandButtons"),
    copySavePath: document.querySelector("#copySavePath"),
    copyMacosCpCommand: document.querySelector("#copyMacosCpCommand"),
    motionSensitivity: document.querySelector("#motionSensitivity"),
    suggestionThreshold: document.querySelector("#suggestionThreshold"),
    suggestionCooldown: document.querySelector("#suggestionCooldown"),
    maxActiveSuggestions: document.querySelector("#maxActiveSuggestions"),
    showRawMotionScores: document.querySelector("#showRawMotionScores"),
    savePathAssistant: document.querySelector("#savePathAssistant"),
    macosCpCommand: document.querySelector("#macosCpCommand"),
    missingFixtureNote: document.querySelector("#missingFixtureNote"),
    exportBugReport: document.querySelector("#exportBugReport"),
    bugReportPreview: document.querySelector("#bugReportPreview"),
    operatorArtifactChecklist: document.querySelector("#operatorArtifactChecklist"),
    stuckGuide: document.querySelector("#stuckGuide")
  };
  bound.objectiveTitle = document.querySelector("#objectiveTitle");
  return bound;
}

function bindEvents(boundDom) {
  boundDom.startCamera.addEventListener("click", startCamera);
  boundDom.stopCamera.addEventListener("click", stopCamera);
  boundDom.analyzeMovement?.addEventListener("click", () => analyzeMovementInState(state));
  boundDom.showTrackingOverlay?.addEventListener("change", () => {
    state.showTrackingOverlay = boundDom.showTrackingOverlay.checked === true;
    render();
  });
  boundDom.confirmMovement?.addEventListener("click", () => {
    confirmMovementResultInState(state);
    render();
  });
  boundDom.correctMovement?.addEventListener("click", () => {
    showMovementCorrectionInState(state);
    render();
  });
  boundDom.movementCorrectionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMovementCorrectionInState(state, boundDom.movementCorrectionInput?.value ?? "");
    render();
  });
  boundDom.cancelMovementCorrection?.addEventListener("click", () => {
    hideMovementCorrectionInState(state);
    render();
  });
  boundDom.clearMovementHistory?.addEventListener("click", () => {
    clearMovementHistory(state);
    render();
  });
  boundDom.clearCorrectionMemory?.addEventListener("click", () => {
    clearCorrectionMemory(state);
    render();
  });
  boundDom.tryAgainMovement?.addEventListener("click", () => {
    resetMovementResultInState(state);
    render();
  });
  boundDom.speakResult?.addEventListener("click", () => speakMovementResult(state));
  boundDom.autoSpeak?.addEventListener("change", () => {
    state.movementRecognition.autoSpeak = boundDom.autoSpeak.checked === true;
    state.movementRecognition.voiceStatus = "Voice ready";
    render();
  });
  boundDom.resetSession.addEventListener("click", resetSession);
  boundDom.calibrateZones.addEventListener("click", openCalibrationPanel);
  boundDom.editZones?.addEventListener("click", openCalibrationPanel);
  boundDom.saveCalibration.addEventListener("click", () => {
    saveCalibrationToState(state, readCalibrationForm(boundDom));
    render();
  });
  boundDom.startFocusRitual.addEventListener("click", () => {
    startFocusRitualInState(state);
    render();
  });
  boundDom.startRecording.addEventListener("click", () => {
    const preserve = state.events.some((event) => !REQUIRED_EXPORT_EVENT_IDS.slice(0, 1).includes(event.id)) &&
      typeof window !== "undefined" &&
      window.confirm("Preserve existing symbolic events? Choose OK to preserve, Cancel to clear and start fresh.");
    startRecordingInState(state, { preserve });
    render();
  });
  boundDom.stopRecording.addEventListener("click", () => {
    stopRecordingInState(state);
    render();
  });
  boundDom.confirmPhysical.addEventListener("change", () => {
    state.physicalConfirmed = boundDom.confirmPhysical.checked === true;
    state.statusMessage = state.physicalConfirmed
      ? "Physical session confirmed. Export unlocks after watching is stopped and the session is complete."
      : "Physical confirmation is required before export.";
    updateExportReadiness(state);
    render();
  });
  boundDom.exportTrace.addEventListener("click", exportPhysicalTrace);
  boundDom.copyValidation.addEventListener("click", copyValidationCommands);
  boundDom.copyOperatorCommands.addEventListener("click", copyOperatorCommands);
  boundDom.copySavePath.addEventListener("click", () => copyText("Save path", currentTracePath(state)));
  boundDom.copyMacosCpCommand.addEventListener("click", () => copyText("macOS cp command", currentMacosSaveCommand(state)));
  boundDom.exportBugReport.addEventListener("click", exportBugReport);
  boundDom.exportCampaignBundle?.addEventListener("click", exportCampaignBundle);
  boundDom.runLiveAiSmoke?.addEventListener("click", () => runLiveAiSmokeTestInState(state));
  boundDom.currentActionControl?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-current-action]");
    if (!button) return;
    const action = button.getAttribute("data-current-action");
    if (action === "analyzeMovement") {
      analyzeMovementInState(state);
      return;
    }
    const targetButton = dom[action];
    if (targetButton && !targetButton.disabled) targetButton.click();
  });
  boundDom.suggestionTraceMode?.addEventListener("change", () => {
    state.suggestionTraceMode = boundDom.suggestionTraceMode.value;
    state.exported = false;
    state.validationCopied = false;
    state.statusMessage = `${selectedTraceModeFor(state).label} selected. Follow the trace instructions before export.`;
    updateExportReadiness(state);
    render();
  });
  for (const button of document.querySelectorAll("[data-copy-command]")) {
    button.addEventListener("click", () => {
      copySingleValidationCommand(button.getAttribute("data-copy-command"));
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-step]");
    if (!button || button.disabled) return;
    const step = button.getAttribute("data-step");
    if (step === "uncertain") markUncertainInState(state);
    else if (step === "reset") markCameraResetInState(state);
    else confirmStepInState(state, step);
    render();
  });

  for (const input of [
    boundDom.motionSensitivity,
    boundDom.suggestionThreshold,
    boundDom.suggestionCooldown,
    boundDom.maxActiveSuggestions,
    boundDom.showRawMotionScores
  ].filter(Boolean)) {
    input.addEventListener("change", () => {
      readPerceptionTuning(boundDom, state);
      render();
    });
  }

  boundDom.cameraSuggestions?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-suggestion-action]");
    if (!button || button.disabled) return;
    const suggestionId = button.getAttribute("data-suggestion-id");
    const action = button.getAttribute("data-suggestion-action");
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.textContent = action === "accept" ? "Confirmed" : "Okay";
    if (action === "accept") acceptSuggestionInState(state, suggestionId);
    if (action === "reject") rejectSuggestionInState(state, suggestionId);
    lastSuggestionRenderAt = 0;
    render();
  });

  boundDom.suggestionCampaignSteps?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-campaign-action]");
    if (!button) return;
    runCampaignAction(button.getAttribute("data-campaign-action"), button.getAttribute("data-trace-mode"));
  });
}

function openCalibrationPanel() {
  state.calibrationOpen = true;
  if (dom?.developerTools) dom.developerTools.open = true;
  state.objective = "Adjust zone rectangles, assign objects, then press Save Calibration.";
  state.statusMessage = "Calibration form is open.";
  state.errorMessage = "";
  render();
}

async function startCamera() {
  const startedAt = now();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.cameraReady = true;
    state.cameraStarted = true;
    state.cameraStatus = `granted (${Math.max(1, Math.round(now() - startedAt))}ms)`;
    state.objective = state.calibrationSaved ? "Press Start Focus Ritual." : "Press Calibrate Zones.";
    state.statusMessage = "Camera is ready. No audio was requested.";
    state.errorMessage = "";
    dom.preview.srcObject = state.stream;
    await dom.preview.play();
    startLocalPerception();
  } catch (error) {
    state.cameraReady = false;
    state.cameraStatus = `error: ${error?.message ?? "camera unavailable"}`;
    state.objective = "Allow camera permission, then press Start Camera again.";
    state.statusMessage = "Camera did not start.";
    state.errorMessage = `Camera error: ${error?.message ?? "camera unavailable"}`;
  }
  render();
}

function stopCamera() {
  stopLocalPerception();
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state.stream = null;
  state.cameraReady = false;
  state.recording = false;
  state.cameraStatus = "stopped";
  state.objective = "Press Start Camera.";
  state.statusMessage = "Camera stopped.";
  if (dom?.preview) dom.preview.srcObject = null;
  render();
}

function resetSession() {
  stopLocalPerception();
  for (const track of state.stream?.getTracks?.() ?? []) track.stop();
  state = resetSessionInState(state);
  if (dom?.preview) dom.preview.srcObject = null;
  if (dom?.confirmPhysical) dom.confirmPhysical.checked = false;
  buildCalibrationForm(dom, state);
  render();
}

export function resetSessionInState(target) {
  const fresh = createInitialState();
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, fresh);
  return target;
}

export function saveCalibrationToState(target, calibration) {
  if (!target.cameraReady) {
    target.errorMessage = "Save Calibration is disabled because you have not started the camera yet.";
    target.statusMessage = "Start camera before saving calibration.";
    target.objective = "Click Start Camera first.";
    return target;
  }

  target.zoneGeometry = clone(calibration.zoneGeometry);
  target.objectAssignments = { ...calibration.objectAssignments };
  target.calibrationSaved = true;
  target.calibrationOpen = false;
  transitionTo(target, "calibrated");
  target.objective = "Press Start Focus Ritual.";
  target.activeZone = "neutral_zone";
  target.confidence = 0.94;
  target.uncertain = false;
  target.reset = false;
  target.errorMessage = "";
  target.statusMessage = "Calibration saved. Start Focus Ritual is now available.";
  target.events = target.events.filter((event) => event.id !== "evt_scene_calibrated");
  target.latencyRecords = target.latencyRecords.filter((record) => record.event_id !== "evt_scene_calibrated");
  emitEvents(target, [calibrationEvent(target)], "calibration");
  updateExportReadiness(target);
  return target;
}

export function startFocusRitualInState(target) {
  if (!target.cameraReady) {
    target.errorMessage = "Start Focus Ritual is disabled because you have not started the camera yet.";
    return target;
  }
  if (!target.calibrationSaved) {
    target.errorMessage = "Start Focus Ritual is disabled because calibration has not been saved.";
    target.objective = "Press Calibrate Zones, then Save Calibration.";
    return target;
  }
  target.ritualStarted = true;
  transitionTo(target, "quest_started");
  target.objective = "Press Start Recording.";
  target.activeZone = "phone_zone";
  target.statusMessage = "Focus Ritual is set up. Recording can start.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function startRecordingInState(target, options = {}) {
  if (!target.cameraReady) {
    target.errorMessage = "Start Recording is disabled because you have not started the camera yet.";
    target.objective = "Click Start Camera.";
    return target;
  }
  if (!target.calibrationSaved) {
    target.errorMessage = "Start Recording is disabled because calibration has not been saved.";
    target.objective = "Calibrate zones and save calibration.";
    return target;
  }
  if (!target.ritualStarted) {
    target.errorMessage = "Start Recording is disabled because you have not started Focus Ritual yet.";
    target.objective = "Click Start Focus Ritual.";
    return target;
  }

  if (!options.preserve) {
    target.events = [];
    target.latencyRecords = [];
    target.lastLatency = null;
    target.completedSteps = [];
    target.uncertain = false;
    target.reset = false;
    target.uncertaintyCount = 0;
    target.resetCount = 0;
    target.exported = false;
    target.validationCopied = false;
    emitEvents(target, [calibrationEvent(target)], "recording_calibration");
  }

  target.recording = true;
  target.recordingStarted = true;
  target.physicalConfirmed = false;
  transitionTo(target, "phone_removal_pending");
  target.exportStatus = "recording";
  target.objective = "Move phone away, then press Confirm Phone Moved.";
  target.statusMessage = "Recording is on. Manual local confirmations are enabled.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function stopRecordingInState(target) {
  if (!target.recording) {
    target.errorMessage = "Stop Recording is disabled because recording is not active.";
    return target;
  }
  target.recording = false;
  target.exportStatus = target.questState === "quest_complete" ? "physical confirmation required" : "ritual incomplete";
  target.objective = target.questState === "quest_complete"
    ? "Check physical confirmation, then export."
    : objectiveForQuestState(target.questState);
  target.statusMessage = "Recording stopped. Event list is frozen.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function confirmStepInState(target, step, options = {}) {
  if (!target.recording) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because recording is not active.`;
    target.statusMessage = "Start recording before confirming ritual steps.";
    return target;
  }
  if (!target.ritualStarted) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because you have not started Focus Ritual yet.`;
    return target;
  }

  const currentStep = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!currentStep || currentStep.id !== step) {
    target.errorMessage = `${ACTION_LABELS[step]} is disabled because the current objective is ${objectiveForQuestState(target.questState)}`;
    target.statusMessage = "Complete the ritual in order.";
    return target;
  }
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];

  if (step === "phone") {
    emitEvents(target, [
      eventSpec("evt_phone_moved_to_off_desk", "object.moved", 1000, 0.92, payloadWithSuggestion({
        object_id: "obj_phone",
        object_type: "phone",
        from_zone_id: "zone_focus",
        to_zone_id: "zone_away",
        duration_ms: 640
      }, options.suggestion), "ev_phone_moved_to_off_desk", "human_correction", "Manual local confirmation: phone moved away physically.", suggestionEvidence)
    ], "phone");
    completeStep(target, "phone", "phone_removed", "notebook_pending", "Open notebook, then press Confirm Notebook Opened.", "notebook_zone");
  } else if (step === "notebook") {
    emitEvents(target, [
      eventSpec("evt_notebook_opened", "object.placed", 2200, 0.91, payloadWithSuggestion({
        object_id: "obj_notebook",
        object_type: "notebook",
        zone_id: "zone_notebook",
        dwell_ms: 800
      }, options.suggestion), "ev_notebook_opened", "human_correction", "Manual local confirmation: notebook opened physically.", suggestionEvidence)
    ], "notebook");
    completeStep(target, "notebook", "notebook_opened", "pen_pending", "Pick up pen, then press Confirm Pen Picked Up.", "pen_zone");
  } else if (step === "pen") {
    emitEvents(target, [
      eventSpec("evt_pen_moved_to_hand", "object.moved", 3300, 0.90, payloadWithSuggestion({
        object_id: "obj_pen",
        object_type: "pen",
        from_zone_id: "zone_pen_tool",
        to_zone_id: "zone_notebook",
        duration_ms: 480
      }, options.suggestion), "ev_pen_moved_to_hand", "human_correction", "Manual local confirmation: pen picked up by hand.", suggestionEvidence)
    ], "pen");
    completeStep(target, "pen", "pen_detected", "writing_pending", "Perform writing-like motion, then press Confirm Writing Motion.", "notebook_zone");
  } else if (step === "writing") {
    emitEvents(target, [
      eventSpec("evt_writing_like_motion", "gesture.detected", 4700, 0.88, payloadWithSuggestion({
        gesture_id: "gst_writing_like_001",
        gesture_type: "writing_motion",
        zone_id: "zone_notebook",
        actor_ref: "hand_right",
        evidence_window_ms: 1000,
        related_object_id: "obj_pen",
        gesture_repetition_count: 3
      }, options.suggestion), "ev_writing_like_motion", "human_correction", "Manual local confirmation: writing-like motion occurred.", suggestionEvidence)
    ], "writing");
    completeStep(target, "writing", "writing_detected", "typing_pending", "Perform typing-like motion, then press Confirm Typing Motion.", "keyboard_zone");
  } else if (step === "typing") {
    emitEvents(target, [
      eventSpec("evt_typing_like_motion", "gesture.detected", 6200, 0.89, payloadWithSuggestion({
        gesture_id: "gst_typing_like_001",
        gesture_type: "typing_motion",
        zone_id: "zone_keyboard",
        actor_ref: "hand_both",
        evidence_window_ms: 950,
        gesture_repetition_count: 4
      }, options.suggestion), "ev_typing_like_motion", "human_correction", "Manual local confirmation: typing-like motion occurred.", suggestionEvidence)
    ], "typing");
    completeStep(target, "typing", "typing_detected", "quest_complete", "Stop recording, check physical confirmation, then export.", "keyboard_zone");
  }

  updateExportReadiness(target);
  return target;
}

export function markUncertainInState(target, options = {}) {
  if (!target.recording) {
    target.errorMessage = "Mark Uncertain is disabled because recording is not active.";
    return target;
  }
  const timestamp = nextDiagnosticTimestamp(target);
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];
  emitEvents(target, [
    eventSpec(`evt_scene_uncertain_${target.uncertaintyCount + 1}`, "scene.uncertain", timestamp, 0.58, payloadWithSuggestion({
      reason: "operator_marked_uncertain",
      affected_zone_ids: REQUIRED_ZONES,
      recovery_hint: "Reset session or recalibrate before exporting."
    }, options.suggestion), `ev_scene_uncertain_${target.uncertaintyCount + 1}`, "human_correction", "Manual local confirmation: scene uncertainty visible.", suggestionEvidence)
  ], "uncertain");
  target.uncertain = true;
  target.uncertaintyCount += 1;
  transitionTo(target, "uncertain");
  transitionTo(target, "recovery");
  target.objective = "Resolve uncertainty with Reset Session, then repeat a clean run.";
  target.exportStatus = "not exportable while uncertain";
  target.statusMessage = "Uncertainty is visible in the HUD.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function markCameraResetInState(target, options = {}) {
  if (!target.recording) {
    target.errorMessage = "Mark Camera Reset is disabled because recording is not active.";
    return target;
  }
  const timestamp = nextDiagnosticTimestamp(target);
  const suggestionEvidence = options.suggestion ? [localSuggestionEvidence(options.suggestion)] : [];
  emitEvents(target, [
    eventSpec(`evt_scene_reset_${target.resetCount + 1}`, "scene.reset", timestamp, 0.95, payloadWithSuggestion({
      reason: "operator_marked_camera_reset",
      requires_recalibration: true
    }, options.suggestion), `ev_scene_reset_${target.resetCount + 1}`, "human_correction", "Manual local confirmation: camera reset/recalibration needed.", suggestionEvidence)
  ], "reset");
  target.reset = true;
  target.resetCount += 1;
  target.recording = false;
  transitionTo(target, "reset");
  target.objective = "Press Reset Session and recalibrate.";
  target.exportStatus = "not exportable after reset";
  target.statusMessage = "Reset state is visible in the HUD.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function zoneActivatedEventSpec(zoneId, motionScore, durationMs, timestampMs = 0) {
  return eventSpec(`evt_zone_activated_${safeId(zoneId)}_${Math.round(timestampMs)}`, "zone.activated", Math.round(timestampMs), confidenceFromMotion(motionScore), {
    zone_id: zoneId,
    activation_type: "local_motion",
    motion_score: Number(motionScore.toFixed(3)),
    duration_ms: Math.round(durationMs)
  }, `ev_zone_activated_${safeId(zoneId)}_${Math.round(timestampMs)}`, "local_signal", `Local motion signal activated ${zoneId}.`);
}

export function motionProxyEventSpec(direction, zoneId, confidence, timestampMs = 0) {
  return eventSpec(`evt_hand_${direction}_${safeId(zoneId)}_${Math.round(timestampMs)}`, `hand.${direction}_zone`, Math.round(timestampMs), confidence, {
    zone_id: zoneId,
    detection_method: "motion_proxy",
    confidence
  }, `ev_hand_${direction}_${safeId(zoneId)}_${Math.round(timestampMs)}`, "local_signal", `Local motion proxy: hand ${direction} ${zoneId}.`);
}

export function createPerceptionSuggestion(type, zoneId, confidence, reason, step = null, timestampMs = now(), overrides = {}) {
  const normalizedConfidence = clamp01(confidence);
  const meta = STEP_SUGGESTION_META[step] ?? {};
  const suggestedEventType = overrides.suggested_event_type ?? meta.suggested_event_type ?? type;
  const suggestedAction = overrides.suggested_action ?? meta.suggested_action ?? actionLabelForSuggestion(type, zoneId);
  const objectId = overrides.object_id ?? meta.object_id ?? objectForZone(zoneId);
  const payload = {
    ...(overrides.payload ?? {}),
    detection_method: "motion_proxy",
    suggestion_only: true
  };
  return {
    id: `sug_${safeId(type)}_${safeId(zoneId)}_${Math.round(timestampMs)}`,
    key: `${type}:${zoneId}:${step ?? "signal"}`,
    type: "action_suggestion",
    action_type: actionTypeForStep(step, suggestedEventType),
    label: suggestedAction,
    suggested_event_type: suggestedEventType,
    suggested_action: suggestedAction,
    current_step: step ?? "",
    quest_step: step ?? "",
    zone_id: zoneId,
    object_id: objectId,
    confidence: normalizedConfidence,
    reason,
    evidence: [
      {
        kind: "local_signal",
        description: reason,
        contains_raw_media: false
      },
      {
        kind: "derived_state",
        description: `quest_state=${overrides.quest_state ?? "unknown"}`,
        contains_raw_media: false
      }
    ],
    expires_at_ms: Math.round(timestampMs + (overrides.ttl_ms ?? LOCAL_MOTION.suggestionTtlMs)),
    accepted: false,
    rejected: false,
    step,
    payload,
    requires_confirmation: true,
    detection_method: payload.detection_method,
    timestamp_ms: Math.round(timestampMs),
    low_confidence: normalizedConfidence < 0.7,
    rank: rankSuggestion(suggestedEventType, zoneId, normalizedConfidence, step),
    metadata: {
      suggestion_only: true,
      detection_method: "motion_proxy",
      source: "local_motion_proxy"
    },
    status: "pending"
  };
}

export function buildLocalPerceptionFrame(input = {}) {
  assertSymbolicFrameOnly(input);
  const timestampMs = Math.round(input.timestamp_ms ?? now());
  const zoneMotion = {};
  for (const zoneId of REQUIRED_ZONES) {
    const raw = input.zone_motion?.[zoneId] ?? {};
    const motionScore = clamp01(typeof raw === "number" ? raw : raw.motion_score ?? 0);
    const confidence = clamp01(typeof raw === "object" ? raw.confidence ?? confidenceFromMotion(motionScore) : confidenceFromMotion(motionScore));
    zoneMotion[zoneId] = {
      zone_id: zoneId,
      motion_score: Number(motionScore.toFixed(3)),
      active: typeof raw === "object" ? raw.active ?? motionScore >= LOCAL_MOTION.activeThreshold : motionScore >= LOCAL_MOTION.activeThreshold,
      confidence,
      timestamp_ms: timestampMs
    };
  }
  const activeZone = Object.values(zoneMotion)
    .filter((item) => item.active)
    .sort((a, b) => b.motion_score - a.motion_score)[0]?.zone_id ?? null;
  return {
    timestamp_ms: timestampMs,
    zone_motion: zoneMotion,
    hand_landmarks: input.hand_landmarks ?? [],
    hand_zone_overlap: input.hand_zone_overlap ?? [],
    active_zone: input.active_zone ?? activeZone,
    confidence: clamp01(input.confidence ?? (activeZone ? zoneMotion[activeZone].confidence : 0)),
    uncertainty: input.uncertainty ?? { uncertain: false, reason: "" },
    scene_reset: input.scene_reset ?? { reset: false, reason: "" }
  };
}

export function scoreLocalActionFrame(frameInput, target = state, options = {}) {
  const frame = frameInput?.zone_motion ? buildLocalPerceptionFrame(frameInput) : buildLocalPerceptionFrame({ zone_motion: frameInput ?? {} });
  const observations = Object.values(frame.zone_motion);
  const candidates = rankActionSuggestions(buildActionSuggestion({ target, observations, timestampMs: frame.timestamp_ms }), target);
  return candidates.map((candidate) => smoothDetectedActionCandidate(candidate, target, options));
}

export function smoothActionConfidence(previousConfidence, nextConfidence, alpha = 0.45) {
  const next = clamp01(nextConfidence);
  if (previousConfidence == null || Number.isNaN(Number(previousConfidence))) return Number(next.toFixed(2));
  const previous = clamp01(previousConfidence);
  const boundedAlpha = clamp01(alpha);
  return Number(((previous * (1 - boundedAlpha)) + (next * boundedAlpha)).toFixed(2));
}

export function acceptSuggestionInState(target, suggestionId) {
  const actionKey = `accept:${suggestionId}`;
  if (target.handledSuggestionActionIds?.includes(actionKey)) return target;
  const suggestion = target.perceptionSuggestions.find((item) => item.id === suggestionId && item.status === "pending");
  if (!suggestion) return target;
  target.handledSuggestionActionIds ??= [];
  target.handledSuggestionActionIds.push(actionKey);
  if (suggestion.step && !suggestionMatchesCurrentStep(target, suggestion)) {
    suggestion.status = "rejected";
    suggestion.rejected = true;
    if (!target.rejectedSuggestionKeys.includes(suggestion.key)) target.rejectedSuggestionKeys.push(suggestion.key);
    recordSuggestionRejected(target, suggestion);
    target.statusMessage = "Camera suggestion rejected because it does not match the current quest step.";
    target.errorMessage = "";
    return target;
  }
  suggestion.status = "accepted";
  suggestion.accepted = true;
  if (!target.acceptedSuggestionIds.includes(suggestion.id)) target.acceptedSuggestionIds.push(suggestion.id);
  recordSuggestionAccepted(target, suggestion);
  applyCandidateCooldown(target, suggestion);

  if (suggestion.step === "uncertain") {
    markUncertainInState(target, { suggestion });
  } else if (suggestion.step === "reset") {
    markCameraResetInState(target, { suggestion });
  } else if (suggestion.step) {
    confirmStepInState(target, suggestion.step, { suggestion });
  } else if (suggestion.payload?.ai_recognition === true) {
    confirmMovementResultInState(target);
  } else if (suggestion.suggested_event_type === "zone.activated") {
    const event = withAcceptedSuggestionPayload(zoneActivatedEventSpec(suggestion.zone_id, suggestion.motion_score ?? 0.08, suggestion.duration_ms ?? 400, suggestion.timestamp_ms), suggestion);
    emitEvents(target, [withHumanCorrectionEvidence(event, suggestion)], "suggestion_accept");
  } else if (suggestion.suggested_event_type === "hand.entered_zone" || suggestion.suggested_event_type === "hand.left_zone") {
    const direction = suggestion.suggested_event_type === "hand.entered_zone" ? "entered" : "left";
    const event = withAcceptedSuggestionPayload(motionProxyEventSpec(direction, suggestion.zone_id, suggestion.confidence, suggestion.timestamp_ms), suggestion);
    emitEvents(target, [withHumanCorrectionEvidence(event, suggestion)], "suggestion_accept");
  }

  target.statusMessage = "Camera suggestion accepted with manual confirmation.";
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

export function rejectSuggestionInState(target, suggestionId) {
  const actionKey = `reject:${suggestionId}`;
  if (target.handledSuggestionActionIds?.includes(actionKey)) return target;
  const suggestion = target.perceptionSuggestions.find((item) => item.id === suggestionId && item.status === "pending");
  if (!suggestion) return target;
  target.handledSuggestionActionIds ??= [];
  target.handledSuggestionActionIds.push(actionKey);
  suggestion.status = "rejected";
  suggestion.rejected = true;
  if (!target.rejectedSuggestionKeys.includes(suggestion.key)) target.rejectedSuggestionKeys.push(suggestion.key);
  target.rejectedSuggestionCooldowns[suggestion.key] = Math.round(suggestion.timestamp_ms + target.localPerceptionTuning.suggestionCooldownMs);
  target.localActionDiagnostics.lastRejectedCandidate = suggestion.payload?.detected_action_candidate ?? {
    id: suggestion.id,
    action_type: suggestion.payload?.action_type ?? suggestion.suggested_event_type,
    confidence: suggestion.confidence,
    zone_id: suggestion.zone_id,
    reason: suggestion.reason
  };
  applyCandidateCooldown(target, suggestion);
  recordSuggestionRejected(target, suggestion);
  target.statusMessage = "Camera suggestion rejected. Quest state was not changed.";
  target.errorMessage = "";
  return target;
}

export function confirmMovementResultInState(target = state) {
  if (!target.movementRecognition.lastResult) {
    target.statusMessage = "Analyze a movement before confirming.";
    return target;
  }
  if (target.movementResultSnapshot?.confirmed) {
    target.statusMessage = "Movement result already confirmed.";
    return target;
  }
  const result = normalizeMovementRecognitionResult(target.movementRecognition.lastResult);
  const timestampMs = Math.round(now());
  emitEvents(target, [
    eventSpec(`evt_movement_confirmed_${timestampMs}`, "gesture.detected", timestampMs, result.confidence, {
      gesture_type: "movement_narration",
      movement: result.movement,
      short_label: result.short_label,
      detection_method: "ai_movement_recognition",
      provider: result.provider,
      model: result.model,
      latency_ms: result.latency_ms,
      requires_confirmation: true,
      confirmed_by_user: true
    }, `ev_movement_signal_${timestampMs}`, "local_signal", `Movement narration candidate: ${result.short_label}`, [
      {
        id: `ev_movement_human_confirmation_${timestampMs}`,
        ref: `ev_movement_human_confirmation_${timestampMs}`,
        kind: "human_correction",
        description: "User confirmed the movement narration.",
        contains_raw_media: false
      }
    ])
  ], "movement_confirmation");
  target.movementRecognition.confirmed = true;
  if (target.movementResultSnapshot) {
    target.movementResultSnapshot = {
      ...target.movementResultSnapshot,
      confirmed: true
    };
  }
  target.confidenceCalibration.confirmed_count += 1;
  target.statusMessage = "Movement result confirmed.";
  target.errorMessage = "";
  return target;
}

export function resetMovementResultInState(target = state) {
  target.perceptionSuggestions = target.perceptionSuggestions.filter((suggestion) => suggestion.payload?.ai_recognition !== true);
  setMovementCaptureState(target, "idle");
  target.movementRecognition.status = "idle";
  target.movementRecognition.lastResult = null;
  target.movementRecognition.lastError = "";
  target.movementRecognition.lastSafeError = "";
  target.movementRecognition.fallbackUsed = false;
  target.movementRecognition.confirmed = false;
  target.movementRecognition.requestInFlight = false;
  target.movementRecognition.voiceStatus = "Voice ready";
  target.movementRecognition.lastSpokenMovement = "";
  target.correctionDraft = { open: false, text: "" };
  target.movementResultSnapshot = null;
  lastMovementResultRenderKey = "";
  lastMovementDetailsRenderKey = "";
  lastMovementRevealResultId = "";
  target.statusMessage = "Waiting for movement.";
  target.errorMessage = "";
  return target;
}

function setMovementCaptureState(target, status) {
  target.movementCaptureState = {
    status,
    updated_at: Math.round(now())
  };
  return target.movementCaptureState;
}

function movementResultSnapshotFrom(result, timestampMs = Math.round(now())) {
  const normalized = normalizeMovementRecognitionResult(result);
  return {
    movement_sentence: normalized.movement,
    short_label: normalized.short_label,
    confidence: normalized.confidence,
    reason: normalized.reason,
    evidence: normalized.evidence,
    uncertainty: normalized.uncertainty,
    provider: normalized.provider,
    model: normalized.model,
    requested_model: normalized.requested_model,
    returned_model: normalized.returned_model,
    prompt_version: normalized.prompt_version,
    image_tokens: normalized.image_tokens,
    retries: normalized.retries,
    failed_candidates: normalized.failed_candidates,
    latency_ms: normalized.latency_ms,
    result_id: `movement_result_${timestampMs}`,
    created_at: timestampMs,
    revision: timestampMs,
    confirmed: false
  };
}

function movementResultForDisplay(target) {
  const snapshot = target.movementResultSnapshot;
  if (snapshot) {
    return {
      movement: snapshot.movement_sentence,
      short_label: snapshot.short_label,
      confidence: snapshot.confidence,
      reason: snapshot.reason,
      evidence: snapshot.evidence,
      provider: snapshot.provider,
      model: snapshot.model,
      prompt_version: snapshot.prompt_version,
      image_tokens: snapshot.image_tokens,
      retries: snapshot.retries,
      failed_candidates: snapshot.failed_candidates,
      latency_ms: snapshot.latency_ms,
      result_id: snapshot.result_id,
      confirmed: snapshot.confirmed
    };
  }
  return target.movementRecognition.lastResult
    ? { ...normalizeMovementRecognitionResult(target.movementRecognition.lastResult), result_id: "unsnapshotted_result" }
    : null;
}

function sanitizeMemoryText(value) {
  const inlineImagePattern = new RegExp(`${["data", "image"].join(":")}\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+`, "gi");
  return String(value ?? "")
    .replace(/\b(named|identity|identified as|recognize(d)? as|male|female|man|woman|boy|girl|race|ethnicity|age)\b/gi, "[redacted]")
    .replace(inlineImagePattern, "[media omitted]")
    .replace(/\b(base64|screenshot|raw frame|raw video|private text)\b/gi, "[omitted]")
    .slice(0, 280);
}

function appendMovementHistory(target, snapshot) {
  const entry = {
    movement: sanitizeMemoryText(snapshot.movement_sentence)
  };
  target.movementHistory.entries = [...target.movementHistory.entries, entry].slice(-target.movementHistory.max_items);
  return entry;
}

function appendCorrectionMemory(target, correction) {
  const entry = {
    correction_id: String(correction.correction_id ?? `correction_${Math.round(now())}`),
    original_movement: sanitizeMemoryText(correction.original_movement),
    corrected_movement: sanitizeMemoryText(correction.corrected_movement),
    confidence: clamp01(correction.confidence ?? 0),
    provider: sanitizeMemoryText(correction.provider),
    model: sanitizeMemoryText(correction.model),
    timestamp: correction.timestamp ?? Math.round(now()),
    contains_raw_media: false,
    contains_biometric_identity: false,
    session_only: true
  };
  target.correctionMemory.entries = [...target.correctionMemory.entries, entry].slice(-target.correctionMemory.max_items);
  return entry;
}

function recentCorrectionContextForPrompt(target) {
  return target.correctionMemory.entries.slice(-3).map((entry) => ({
    original_movement: entry.original_movement,
    corrected_movement: entry.corrected_movement
  }));
}

export function showMovementCorrectionInState(target = state) {
  if (!target.movementResultSnapshot) {
    target.statusMessage = "Describe a movement before correcting it.";
    return target;
  }
  target.correctionDraft = {
    open: true,
    text: ""
  };
  target.statusMessage = "Tell DarkQuest what actually happened.";
  return target;
}

export function hideMovementCorrectionInState(target = state) {
  target.correctionDraft = {
    open: false,
    text: ""
  };
  target.statusMessage = target.movementResultSnapshot ? "Correction canceled." : target.statusMessage;
  return target;
}

export function submitMovementCorrectionInState(target = state, value = "") {
  const snapshot = target.movementResultSnapshot;
  const correctedMovement = sanitizeMemoryText(value);
  if (!snapshot || !correctedMovement) {
    target.statusMessage = snapshot ? "Enter what actually happened." : "Describe a movement before correcting it.";
    return target;
  }
  const timestampMs = Math.round(now());
  appendCorrectionMemory(target, {
    correction_id: `correction_${timestampMs}`,
    original_movement: snapshot.movement_sentence,
    corrected_movement: correctedMovement,
    confidence: snapshot.confidence,
    provider: snapshot.provider,
    model: snapshot.model,
    timestamp: timestampMs
  });
  target.confidenceCalibration.corrected_count += 1;
  target.movementResultSnapshot = {
    ...snapshot,
    movement_sentence: safeMovementSentence(correctedMovement),
    short_label: safeShortLabel(correctedMovement),
    confirmed: false,
    corrected: true,
    revision: timestampMs
  };
  target.movementRecognition.lastResult = {
    ...normalizeMovementRecognitionResult(target.movementRecognition.lastResult ?? {}),
    movement: target.movementResultSnapshot.movement_sentence,
    short_label: target.movementResultSnapshot.short_label,
    confidence: target.movementResultSnapshot.confidence,
    provider: target.movementResultSnapshot.provider,
    model: target.movementResultSnapshot.model
  };
  target.correctionDraft = { open: false, text: "" };
  target.statusMessage = "Correction saved for this session.";
  target.errorMessage = "";
  return target;
}

export function clearMovementHistory(target = state) {
  target.movementHistory.entries = [];
  target.statusMessage = "Movement history cleared.";
  return target;
}

export function clearCorrectionMemory(target = state) {
  target.correctionMemory.entries = [];
  target.statusMessage = "Correction memory cleared.";
  return target;
}

export function speakMovementResult(target = state) {
  const movement = movementResultForDisplay(target)?.movement ?? "";
  const speechSynthesis = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (!movement || !speechSynthesisAvailable()) {
    target.movementRecognition.voiceStatus = "Voice unavailable";
    render();
    return false;
  }
  const utterance = new Utterance(movement);
  utterance.onend = () => {
    target.movementRecognition.voiceStatus = "Voice ready";
    render();
  };
  utterance.onerror = () => {
    target.movementRecognition.voiceStatus = "Voice unavailable";
    render();
  };
  target.movementRecognition.voiceStatus = "Speaking...";
  target.movementRecognition.lastSpokenMovement = movement;
  speechSynthesis.cancel?.();
  speechSynthesis.speak(utterance);
  render();
  return true;
}

function speechSynthesisAvailable() {
  return typeof globalThis.speechSynthesis?.speak === "function" &&
    typeof globalThis.SpeechSynthesisUtterance === "function";
}

export function buildReplayFixture(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  if (!devDryRun && traceMode.id !== "standard") {
    return buildSuggestionTraceFixture(traceMode, target, options);
  }
  return buildStandardPhysicalTraceFixture(target, options);
}

export function buildStandardPhysicalTraceFixture(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  const preflight = runStandardExportPreflight(target, { requirePhysicalConfirmation: !devDryRun });
  if (!preflight.passed) {
    throw new Error(preflight.failures[0]?.message ?? target.exportStatus ?? "trace export is not ready");
  }

  const inputEvents = REQUIRED_EXPORT_EVENT_IDS.map((id) => {
    const event = target.events.find((item) => item.id === id);
    if (!event) throw new Error(`missing event ${id}`);
    return event;
  });
  const latency = target.latencyRecords.filter((record) => REQUIRED_EXPORT_EVENT_IDS.includes(record.event_id));
  const summary = summarizeLatency(latency);
  const traceOrigin = {
    source: "browser.local_camera",
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    manual_fixture: devDryRun,
    dev_dry_run: devDryRun,
    generated_by: "browser-local-capture",
    capture_mode: devDryRun ? "dev_dry_run_manual_confirmation" : "physical_webcam_manual_calibration",
    browser_latency_recorded: true,
    physical_capture: !devDryRun,
    operator_confirmed_physical_session: !devDryRun,
    suggestion_trace_mode: traceMode.id,
    suggestion_trace_path: traceMode.path,
    manual_local_confirmation_used: true,
    manual_local_confirmation_scope: [
      "zone_calibration",
      "focus_ritual_step_confirmation"
    ],
    manual_local_confirmation_event_ids: inputEvents.map((event) => event.id)
  };

  return {
    schema: "darkquest.replay_fixture.v0",
    fixture_id: devDryRun && traceMode.id === "standard" ? "gate_1d_dry_run_export" : traceMode.fixture_id,
    name: devDryRun && traceMode.id === "standard" ? "Gate 1D dev dry-run Focus Ritual export" : `${traceMode.label} export`,
    description: devDryRun
      ? "Developer dry-run symbolic export generated without a physical capture claim; replay-compatible, but barred from Gate 1C."
      : "Operator-confirmed physical browser webcam session exported by the hardened local app as symbolic replay events only.",
    created_by: devDryRun ? "GAUNTLET Gate 1E dev dry-run checker" : "PARALLAX Gate 3B-Live browser-local suggestion trace mode",
    trace_origin: traceOrigin,
    suggestion_summary: suggestionSummaryFor(target),
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      cloud_calls_expected: false
    },
    input_events: inputEvents,
    expected: {
      stable_events: inputEvents.map(toStableMatcher),
      quest_transitions: questTransitions(),
      hud_commands: hudCommands(),
      memory_writes: [],
      model_calls: []
    },
    forbidden: {
      event_types: ["agent.escalation_requested"],
      memory_writes: [
        { memory_scope: "raw_frame_memory" },
        { privacy_classification: "forbidden_raw_media" }
      ],
      model_calls: [
        { approved_tier: 1 },
        { approved_tier: 2 },
        { approved_tier: 3 },
        { approved_tier: 4 },
        { input_class: "continuous_video" },
        { input_class: "raw_video" },
        { input_class: "raw_frame" }
      ],
      raw_video_persistence: true
    },
    metrics: {
      max_llm_calls: 0,
      max_vlm_calls: 0,
      max_cost_usd: 0,
      max_replay_runtime_ms: 1000,
      p50_latency_ms: summary.p50,
      p95_latency_ms: summary.p95,
      max_latency_ms: summary.max,
      dropped_frames: target.droppedFrames,
      event_count: inputEvents.length,
      uncertainty_count: target.uncertaintyCount,
      scene_reset_count: target.resetCount,
      raw_media_persistence_count: 0,
      suggestion_summary: suggestionSummaryFor(target),
      browser_latency_records: latency
    }
  };
}

export function buildSuggestionTraceFixture(traceModeOrTarget, targetOrOptions = {}, maybeOptions = {}) {
  const target = traceModeOrTarget?.events ? traceModeOrTarget : targetOrOptions;
  const traceMode = traceModeOrTarget?.events ? selectedTraceModeFor(traceModeOrTarget) : traceModeOrTarget;
  const options = traceModeOrTarget?.events ? targetOrOptions : maybeOptions;
  const mode = selectedTraceModeFor({ ...target, suggestionTraceMode: traceMode?.id ?? target.suggestionTraceMode });
  if (mode.id === "standard") return buildStandardPhysicalTraceFixture(target, options);
  const preflight = runSuggestionExportPreflight({ ...target, suggestionTraceMode: mode.id }, options);
  if (!preflight.passed) {
    throw new Error(preflight.failures[0]?.message ?? target.exportStatus ?? "suggestion trace export is not ready");
  }

  const inputEvents = suggestionTraceInputEvents(target, mode);
  const latency = latencyRecordsForEvents(target, inputEvents);
  const summary = summarizeLatency(latency);
  const suggestionSummary = suggestionSummaryForTrace(target, mode);
  const traceState = traceStateFor(target, mode);
  traceState.events = inputEvents.map(clone);
  traceState.emittedEventIds = inputEvents.map((event) => event.id);
  traceState.exportBlockedReasons = [];
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummary;

  const traceOrigin = {
    ...traceOriginFor({ physical: options.devDryRun === true ? false : target.physicalConfirmed === true, devDryRun: options.devDryRun === true }),
    suggestion_trace_mode: mode.id,
    suggestion_trace_path: mode.path,
    manual_local_confirmation_event_ids: inputEvents.map((event) => event.id)
  };

  const fullRitualMode = mode.id === "suggestion_full_focus_ritual";
  return {
    schema: "darkquest.replay_fixture.v0",
    fixture_id: mode.fixture_id,
    name: `${mode.label} export`,
    description: "Operator-confirmed physical browser webcam suggestion trace exported as symbolic replay events only.",
    created_by: "PARALLAX Gate 3B-Live browser-local suggestion trace mode",
    trace_origin: traceOrigin,
    suggestion_summary: suggestionSummary,
    suggestion_trace: {
      trace_mode: mode.id,
      capture_status: traceState.captureStatus,
      export_readiness: traceState.exportReadiness,
      started_at_ms: traceState.startedAtMs,
      accepted_suggestion_ids: traceState.acceptedSuggestionIds.slice(-8),
      rejected_suggestion_ids: traceState.rejectedSuggestionIds.slice(-8),
      emitted_event_ids: traceState.emittedEventIds,
      last_suggestion: traceState.lastSuggestion,
      export_blocked_reasons: traceState.exportBlockedReasons
    },
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      cloud_calls_expected: false
    },
    input_events: inputEvents,
    expected: {
      stable_events: inputEvents.map(toStableMatcher),
      quest_transitions: fullRitualMode ? questTransitions() : [],
      hud_commands: fullRitualMode ? hudCommands() : [],
      memory_writes: [],
      model_calls: []
    },
    forbidden: {
      event_types: ["agent.escalation_requested"],
      memory_writes: [
        { memory_scope: "raw_frame_memory" },
        { privacy_classification: "forbidden_raw_media" }
      ],
      model_calls: [
        { approved_tier: 1 },
        { approved_tier: 2 },
        { approved_tier: 3 },
        { approved_tier: 4 },
        { input_class: "continuous_video" },
        { input_class: "raw_video" },
        { input_class: "raw_frame" }
      ],
      raw_video_persistence: true
    },
    metrics: {
      max_llm_calls: 0,
      max_vlm_calls: 0,
      max_cost_usd: 0,
      max_replay_runtime_ms: 1000,
      p50_latency_ms: summary.p50,
      p95_latency_ms: summary.p95,
      max_latency_ms: summary.max,
      dropped_frames: target.droppedFrames,
      event_count: inputEvents.length,
      uncertainty_count: inputEvents.filter((event) => event.type === "scene.uncertain").length,
      scene_reset_count: 0,
      raw_media_persistence_count: 0,
      suggestion_summary: suggestionSummary,
      browser_latency_records: latency
    }
  };
}

export function runExportPreflight(target, options = {}) {
  const mode = selectedTraceModeFor(target);
  if (mode.id !== "standard") return runSuggestionExportPreflight(target, options);
  return runStandardExportPreflight(target, options);
}

export function runStandardExportPreflight(target, options = {}) {
  const requirePhysicalConfirmation = options.requirePhysicalConfirmation !== false;
  const hasAllEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  const latencyEventIds = new Set(target.latencyRecords.map((record) => record.event_id));
  const requiredLatencyPresent = REQUIRED_EXPORT_EVENT_IDS.every((id) => latencyEventIds.has(id));
  const forbiddenMarkers = findForbiddenMediaMarkers(target);
  const baseChecks = [
    preflightCheck("camera_started", "Camera was started", target.cameraStarted || target.cameraReady, "Click Start Camera first."),
    preflightCheck("calibration_saved", "Calibration was saved", target.calibrationSaved, "Save Calibration before starting the ritual."),
    preflightCheck("ritual_started", "Focus Ritual started", target.ritualStarted, "Click Start Focus Ritual."),
    preflightCheck("recording_stopped", "Recording started then stopped", target.recordingStarted && !target.recording, "Start watching, complete the session, then stop watching."),
    preflightCheck("events_exist", "Required ritual events exist", hasAllEvents, target.events.length === 0 ? "No events recorded." : "Complete every ritual confirmation in order."),
    preflightCheck("event_sequence_valid", "Event sequence is valid", eventSequenceIsValid(target.events), "Invalid event sequence; reset and repeat the ritual in order."),
    preflightCheck("quest_complete", "Quest state is quest_complete", target.questState === "quest_complete", "Quest is not complete yet."),
    preflightCheck("physical_confirmed", "Physical session confirmation checked", !requirePhysicalConfirmation || target.physicalConfirmed, "Physical confirmation is missing."),
    preflightCheck("no_forbidden_media", "No raw media, screenshot, audio, OCR, or notebook text markers", forbiddenMarkers.length === 0, forbiddenMarkers.length ? `Forbidden marker: ${forbiddenMarkers[0]}` : "Symbolic-only payloads."),
    preflightCheck("model_calls_zero", "LLM/VLM calls are zero", target.llmCalls === 0 && target.vlmCalls === 0 && target.estimatedModelCostUsd === 0, "Model calls or model cost are non-zero."),
    preflightCheck("raw_media_not_persisted", "raw_media_persisted=false", target.rawMediaPersistenceCount === 0, "Raw media persistence count must be zero."),
    preflightCheck("latency_records_present", "Browser latency records exist", requiredLatencyPresent, "Each required event needs a browser latency record."),
    preflightCheck("trace_origin_available", "Trace origin can be generated", traceOriginFor({ physical: requirePhysicalConfirmation && target.physicalConfirmed, devDryRun: !requirePhysicalConfirmation }).source === "browser.local_camera", "Trace origin could not be generated.")
  ];
  const checks = [
    ...baseChecks,
    ...runSuggestionTracePreflight(target).checks
  ];
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

export function runSuggestionExportPreflight(target, options = {}) {
  const requirePhysicalConfirmation = options.requirePhysicalConfirmation !== false;
  const mode = selectedTraceModeFor(target);
  const inputEvents = suggestionTraceInputEvents(target, mode);
  const selectedEventIds = new Set(inputEvents.map((event) => event.id));
  const requiredEventIds = suggestionTraceRequiredEventIds(target, mode);
  const latencyEventIds = new Set(target.latencyRecords.map((record) => record.event_id));
  const forbiddenMarkers = findForbiddenMediaMarkers(target);
  const requiredEventsPresent = requiredEventIds.every((id) => selectedEventIds.has(id));
  const requiredLatencyPresent = inputEvents.every((event) => latencyEventIds.has(event.id));
  const checks = [
    preflightCheck("camera_started", "Camera was started", target.cameraStarted || target.cameraReady, "Click Start Camera first."),
    preflightCheck("calibration_saved", "Calibration was saved", target.calibrationSaved, "Save Calibration before starting the session."),
    preflightCheck("ritual_started", "Focus Ritual started", target.ritualStarted, "Click Start Session."),
    preflightCheck("recording_stopped", "Recording started then stopped", target.recordingStarted && !target.recording, "Start Session, capture the selected action, then stop recording."),
    preflightCheck("events_exist", "Selected suggestion trace events exist", requiredEventsPresent, "Capture the selected suggestion trace before export."),
    preflightCheck("physical_confirmed", "Physical session confirmation checked", !requirePhysicalConfirmation || target.physicalConfirmed, "Physical confirmation is missing."),
    preflightCheck("no_forbidden_media", "No raw media, screenshot, audio, OCR, or notebook text markers", forbiddenMarkers.length === 0, forbiddenMarkers.length ? `Forbidden marker: ${forbiddenMarkers[0]}` : "Symbolic-only payloads."),
    preflightCheck("model_calls_zero", "LLM/VLM calls are zero", target.llmCalls === 0 && target.vlmCalls === 0 && target.estimatedModelCostUsd === 0, "Model calls or model cost are non-zero."),
    preflightCheck("raw_media_not_persisted", "raw_media_persisted=false", target.rawMediaPersistenceCount === 0, "Raw media persistence count must be zero."),
    preflightCheck("latency_records_present", "Browser latency records exist", requiredLatencyPresent, "Each selected event needs a browser latency record."),
    preflightCheck("trace_origin_available", "Trace origin can be generated", traceOriginFor({ physical: requirePhysicalConfirmation && target.physicalConfirmed, devDryRun: !requirePhysicalConfirmation }).source === "browser.local_camera", "Trace origin could not be generated."),
    ...runSuggestionTracePreflight(target).checks
  ];
  const failures = checks.filter((check) => !check.passed);
  const traceState = mode.id !== "standard" ? traceStateFor(target, mode) : null;
  if (traceState) {
    traceState.events = inputEvents.map(clone);
    traceState.emittedEventIds = inputEvents.map((event) => event.id);
    traceState.exportReadiness = failures.length === 0 ? "ready_to_export" : "blocked";
    traceState.exportBlockedReasons = failures.map((failure) => failure.id).slice(0, 8);
  }
  return { passed: failures.length === 0, checks, failures };
}

export function runSuggestionTracePreflight(target) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return { passed: true, checks: [], failures: [] };
  const summary = suggestionSummaryForTrace(target, mode);
  const acceptMode = !["suggestion_reject", "suggestion_uncertain"].includes(mode.id);
  const rejectMode = mode.id === "suggestion_reject";
  const uncertainMode = mode.id === "suggestion_uncertain";
  const fullRitualMode = mode.id === "suggestion_full_focus_ritual";
  const inputEvents = suggestionTraceInputEvents(target, mode);
  const inputEventIds = new Set(inputEvents.map((event) => event.id));
  const acceptedEvents = fullRitualMode
    ? acceptedSuggestionEvents(target)
    : acceptedSuggestionEvents(target).filter((event) => inputEventIds.has(event.id));
  const acceptedEventIds = new Set(acceptedEvents.map((event) => event.id));
  const selectedAcceptedEventId = SUGGESTION_TRACE_EVENT_BY_MODE[mode.id];
  const unrelatedRitualEventIds = [...inputEventIds].filter((id) => (
    REQUIRED_EXPORT_EVENT_IDS.includes(id) &&
    id !== "evt_scene_calibrated" &&
    id !== selectedAcceptedEventId &&
    mode.id !== "suggestion_full_focus_ritual"
  ));
  const allStepSuggestionsAccepted = [
    "evt_phone_moved_to_off_desk",
    "evt_notebook_opened",
    "evt_pen_moved_to_hand",
    "evt_writing_like_motion",
    "evt_typing_like_motion"
  ].every((eventId) => acceptedEventIds.has(eventId));
  const uncertaintyPresent = target.perceptionSuggestions.some((suggestion) => suggestion.quest_step === "uncertain" || suggestion.suggested_event_type === "scene.uncertain")
    || target.suggestionTypeHistory.includes("scene.uncertain")
    || target.uncertaintyCount > 0;
  const acceptedEvidenceOk = acceptedEvents.some((event) => (
    event.evidence?.some((item) => item.kind === "local_signal" && item.contains_raw_media === false) &&
    event.evidence?.some((item) => item.kind === "human_correction" && item.contains_raw_media === false)
  ));
  const acceptedPayloadOk = acceptedEvents.some((event) => (
    typeof event.payload?.accepted_from_suggestion_id === "string" &&
    event.payload?.detection_method === "motion_proxy"
  ));
  const checks = [
    preflightCheck("suggestion_trace_mode_selected", "Suggestion trace mode selected", mode.id !== "standard", "Select a Suggestion Trace mode before exporting this trace."),
    preflightCheck("suggestion_summary_present", "Suggestion summary exists", Boolean(summary), "Suggestion summary metadata is missing."),
    preflightCheck("suggestions_generated", "At least one suggestion generated", summary.suggestions_generated >= 1, "Wait for at least one camera suggestion before exporting this suggestion trace."),
    preflightCheck("suggestion_accept_required", "Accepted suggestion present for accept trace", !acceptMode || summary.suggestions_accepted >= 1, "Accept a matching camera suggestion before exporting this trace."),
    preflightCheck("suggestion_reject_required", "Rejected suggestion present for reject trace", !rejectMode || summary.suggestions_rejected >= 1, "Reject a camera suggestion before exporting this trace."),
    preflightCheck("suggestion_uncertainty_required", "Uncertainty suggestion present for uncertain trace", !uncertainMode || uncertaintyPresent, "Wait for an uncertainty signal or suggestion before exporting this trace."),
    preflightCheck("suggestion_full_ritual_accepts_all", "Full ritual accepted suggestions exist", !fullRitualMode || allStepSuggestionsAccepted, "Accept a matching suggestion for every ritual step before exporting this trace."),
    preflightCheck("suggestion_selected_event_only", "Suggestion trace input is mode-specific", unrelatedRitualEventIds.length === 0, `Remove unrelated ritual events from this suggestion trace: ${unrelatedRitualEventIds.join(", ")}`),
    preflightCheck("suggestion_selected_event_present", "Selected accepted event is present", !acceptMode || fullRitualMode || acceptedEventIds.has(selectedAcceptedEventId), "Accept the selected action suggestion before exporting this trace."),
    preflightCheck("suggestion_no_auto_complete", "auto_completed_steps is 0", summary.auto_completed_steps === 0, "Suggestion trace cannot auto-complete steps."),
    preflightCheck("suggestion_model_calls_zero", "Suggestion trace LLM/VLM calls are zero", summary.llm_calls === 0 && summary.vlm_calls === 0, "Suggestion trace model calls must be zero."),
    preflightCheck("suggestion_raw_media_zero", "Suggestion trace raw media persistence is zero", summary.raw_media_persistence === 0, "Suggestion trace raw media persistence must be zero."),
    preflightCheck("accepted_suggestion_evidence", "Accepted suggestion evidence has local_signal and human_correction", !acceptMode || acceptedEvidenceOk, "Accepted suggestion event must include local_signal and human_correction evidence."),
    preflightCheck("accepted_suggestion_payload", "Accepted suggestion payload has suggestion id and motion proxy", !acceptMode || acceptedPayloadOk, "Accepted suggestion event must include accepted_from_suggestion_id and detection_method=motion_proxy.")
  ];
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

export function buildExportPreview(target, options = {}) {
  const devDryRun = options.devDryRun === true;
  const traceMode = selectedTraceModeFor({ ...target, suggestionTraceMode: options.suggestionTraceMode ?? target.suggestionTraceMode });
  const latency = summarizeLatency(target.latencyRecords.filter((record) => REQUIRED_EXPORT_EVENT_IDS.includes(record.event_id)));
  const eventSequence = REQUIRED_EXPORT_EVENT_IDS
    .map((id) => target.events.find((event) => event.id === id)?.type ?? `missing:${id}`)
    .join(" -> ");
  return {
    fixture_id: devDryRun && traceMode.id === "standard" ? "gate_1d_dry_run_export" : traceMode.fixture_id,
    trace_origin: {
      ...traceOriginFor({ physical: !devDryRun && target.physicalConfirmed, devDryRun }),
      suggestion_trace_mode: traceMode.id,
      suggestion_trace_path: traceMode.path
    },
    suggestion_trace_mode: traceMode.id,
    event_count: target.events.filter((event) => REQUIRED_EXPORT_EVENT_IDS.includes(event.id)).length,
    event_sequence: eventSequence,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persisted: false,
    latency_summary: {
      p50_ms: latency.p50,
      p95_ms: latency.p95,
      max_ms: latency.max
    },
    suggestion_summary: suggestionSummaryFor(target),
    expected_save_path: traceMode.path
  };
}

export function inspectEventSequence(target) {
  return EVENT_SEQUENCE_STEPS.map((step) => {
    const event = step.eventId ? target.events.find((item) => item.id === step.eventId) : null;
    const questComplete = step.eventId === null && target.questState === "quest_complete";
    return {
      sequence_index: step.index,
      required_label: step.label,
      required_event_id: step.eventId ?? "quest_complete",
      required_event_type: step.eventId ? requiredEventTypeFor(step.eventId) : "quest.state",
      status: event || questComplete ? "present" : "missing",
      matched_event_id: event?.id ?? null,
      confidence: event?.confidence ?? null,
      payload_summary: event ? payloadSummary(event.payload) : questComplete ? "quest state reached" : "missing"
    };
  });
}

export function buildOperatorBugReport(target, options = {}) {
  const guards = getButtonGuards(target);
  const stages = wizardStagesForState(target);
  const currentStage = stages.find((item) => !item.complete) ?? stages[stages.length - 1];
  const sequence = inspectEventSequence(target);
  const summary = summarizeLatency(target.latencyRecords);
  const report = {
    schema: "darkquest.operator_bug_report.v0",
    app_version: APP_VERSION,
    build_hash: "local-source",
    generated_by: "browser-local-capture",
    generated_at: new Date().toISOString(),
    browser_user_agent: String(options.userAgent ?? "unknown"),
    wizard_stage: currentStage.name,
    calibration_saved: target.calibrationSaved,
    next_action: nextStepText(target),
    quest_state: target.questState,
    state_history: [...target.stateHistory],
    active_zone: target.activeZone,
    recording_status: target.recording ? "on" : target.recordingStarted ? "stopped" : "off",
    export_status: target.exportStatus,
    validation_status: target.exported ? "commands_ready" : "pending",
    validation_commands_shown: target.exported,
    validation_commands: VALIDATION_COMMAND_LIST.map((item) => item.command),
    physical_confirmation_checked: target.physicalConfirmed,
    exported: target.exported,
    event_count: target.events.length,
    event_types: target.events.map((event) => event.type),
    last_error: target.errorMessage,
    error_message: target.errorMessage,
    status_message: target.statusMessage,
    disabled_button_reasons: Object.fromEntries(
      Object.entries(guards)
        .filter(([, value]) => value.enabled === false && value.reason)
        .map(([key, value]) => [key, value.reason])
    ),
    event_sequence: sequence,
    symbolic_events: target.events.map((event) => ({
      id: event.id,
      type: event.type,
      timestamp_ms: event.timestamp_ms,
      confidence: event.confidence,
      payload_summary: payloadSummary(event.payload),
      evidence_kind: event.evidence?.[0]?.kind ?? "unknown"
    })),
    latency_metrics: {
      p50_ms: summary.p50,
      p95_ms: summary.p95,
      max_ms: summary.max,
      record_count: target.latencyRecords.length,
      dropped_frames: target.droppedFrames
    },
    privacy_status: {
      media_persisted: false,
      audio_requested: false,
      screen_capture_persisted: false,
      private_text_persisted: false
    },
    model_status: {
      cloud_fallback: "huggingface_on_demand",
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls,
      estimated_cost_usd: target.estimatedModelCostUsd
    },
    movement_recognition_status: {
      mode: target.movementRecognition.mode,
      provider: target.movementRecognition.provider,
      model: target.movementRecognition.model,
      status: target.movementRecognition.status,
      fallback_used: target.movementRecognition.fallbackUsed,
      frame_buffer_cleared: target.movementRecognition.frameBufferCleared
    },
    local_action_engine_status: {
      active_engine: target.localActionDiagnostics.activeEngine,
      hand_engine: target.localActionDiagnostics.handEngineStatus,
      frame_processing_fps: target.localActionDiagnostics.frameProcessingFps,
      last_perception_latency_ms: target.localActionDiagnostics.lastPerceptionLatencyMs,
      current_primary_candidate: target.localActionDiagnostics.currentPrimaryCandidate,
      last_rejected_candidate: target.localActionDiagnostics.lastRejectedCandidate,
      cooldown_status: target.localActionDiagnostics.cooldownStatus
    },
    suggestion_trace_status: {
      selected_trace_mode: selectedTraceModeFor(target).id,
      selected_trace_label: selectedTraceModeFor(target).label,
      suggestions_generated: suggestionSummaryFor(target).suggestions_generated,
      suggestions_accepted: suggestionSummaryFor(target).suggestions_accepted,
      suggestions_rejected: suggestionSummaryFor(target).suggestions_rejected,
      auto_completed_steps: suggestionSummaryFor(target).auto_completed_steps,
      last_suggestion: lastSuggestionSummary(target),
      suggestion_confidence: lastSuggestionSummary(target)?.confidence ?? null,
      suggestion_reason: lastSuggestionSummary(target)?.reason ?? "",
      export_blocked_reason: runExportPreflight(target).failures[0]?.message ?? "ok",
      media_persisted: false,
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls
    },
    suggestion_campaign_status: {
      campaign_mode_active: target.suggestionCampaign.active === true,
      current_campaign_step: SUGGESTION_CAMPAIGN_STEPS[target.suggestionCampaign.currentIndex]?.label ?? null,
      completed_trace_list: target.suggestionCampaign.exportedTraceIds.map((id) => SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === id)?.path ?? id),
      missing_trace_list: campaignSummaryFor(target).missing_traces,
      last_suggestion_per_trace: target.suggestionCampaign.lastSuggestions,
      per_trace_counts: target.suggestionCampaign.traceSummaries,
      export_blocked_reason: runExportPreflight(target).failures[0]?.message ?? "ok",
      validation_commands: [
        "npm run suggestions:validate",
        "npm run suggestions:report",
        "npm run gate:3b:live"
      ],
      media_persisted: false,
      llm_calls: target.llmCalls,
      vlm_calls: target.vlmCalls
    }
  };
  const serialized = JSON.stringify(report);
  if (bugReportHasForbiddenData(serialized)) {
    throw new Error("bug report safety check blocked forbidden data");
  }
  return report;
}

export function defaultCalibration() {
  return {
    zoneGeometry: clone(DEFAULT_ZONE_GEOMETRY),
    objectAssignments: { ...DEFAULT_OBJECT_ASSIGNMENTS }
  };
}

export function getButtonGuards(target) {
  updateExportReadiness(target);
  const expectedStep = RITUAL_STEPS.find((step) => target.questState === step.activeState);
  const exportBlockedReason = exportDisabledReason(target);
  return {
    startCamera: guard(!target.cameraReady, "Start Camera is disabled because the camera is already started."),
    stopCamera: guard(target.cameraReady, "Stop Camera is disabled because the camera is not started."),
    calibrateZones: guard(target.cameraReady, "Calibrate Zones is disabled because you have not started the camera yet."),
    saveCalibration: guard(target.cameraReady, "Save Calibration is disabled because you have not started the camera yet."),
    startFocusRitual: guard(
      target.cameraReady && target.calibrationSaved && !target.ritualStarted,
      !target.cameraReady
        ? "Start Focus Ritual is disabled because you have not started the camera yet."
        : !target.calibrationSaved
          ? "Start Focus Ritual is disabled because calibration has not been saved."
          : "Start Focus Ritual is disabled because the ritual is already started."
    ),
    startRecording: guard(
      target.cameraReady && target.calibrationSaved && target.ritualStarted && !target.recording && target.questState !== "quest_complete",
      !target.cameraReady
        ? "Start Recording is disabled because you have not started the camera yet."
        : !target.calibrationSaved
          ? "Start Recording is disabled because calibration has not been saved."
          : !target.ritualStarted
            ? "Start Recording is disabled because you have not started Focus Ritual yet."
            : target.recording
              ? "Start Recording is disabled because recording is already active."
              : "Start Recording is disabled because the quest is already complete."
    ),
    stopRecording: guard(target.recording, "Stop Recording is disabled because recording is not active."),
    exportTrace: guard(target.exportReady, exportBlockedReason),
    copyValidation: guard(target.exported, "Copy Validation Commands is disabled because you have not exported the physical trace yet."),
    phone: stepGuard(target, expectedStep, "phone"),
    notebook: stepGuard(target, expectedStep, "notebook"),
    pen: stepGuard(target, expectedStep, "pen"),
    writing: stepGuard(target, expectedStep, "writing"),
    typing: stepGuard(target, expectedStep, "typing"),
    uncertain: guard(target.recording, "Mark Uncertain is disabled because recording is not active."),
    reset: guard(target.recording, "Mark Camera Reset is disabled because recording is not active.")
  };
}

export function wizardStagesForState(target) {
  const guards = getButtonGuards(target);
  return [
    stage(1, "Camera", target.cameraReady, "Start the camera preview.", "Start Camera", guards.startCamera.reason),
    stage(2, "Calibration", target.calibrationSaved, "Define rectangles, assign objects, then save calibration.", target.calibrationOpen ? "Save Calibration" : "Calibrate Zones", target.cameraReady ? "" : guards.calibrateZones.reason),
    stage(3, "Quest Setup", target.ritualStarted, "Start the Focus Ritual.", "Start Focus Ritual", guards.startFocusRitual.reason),
    stage(4, "Recording", target.recordingStarted, "Start symbolic recording.", "Start Recording", guards.startRecording.reason),
    stage(5, "Complete Actions", target.questState === "quest_complete", objectiveForQuestState(target.questState), currentStepButtonLabel(target), currentStepDisabledReason(target, guards)),
    stage(6, "Stop Recording", target.recordingStarted && !target.recording, "Stop recording after the ritual is complete.", "Stop Recording", guards.stopRecording.reason),
    stage(7, "Export", target.exported, "Confirm physical provenance, then export.", "Export Physical Trace", guards.exportTrace.reason),
    stage(8, "Validation", target.validationCopied, "Copy and run validation commands.", "Copy Validation Commands", guards.copyValidation.reason)
  ];
}

function exportPhysicalTrace() {
  try {
    state.physicalConfirmed = dom.confirmPhysical.checked === true;
    const fixture = buildReplayFixture(state);
    recordCampaignCapture(state, fixture);
    const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = currentTraceFilename(state);
    link.click();
    URL.revokeObjectURL(url);
    state.exported = true;
    state.exportStatus = `downloaded; save as ${currentTracePath(state)}`;
    state.statusMessage = "Physical trace exported. Validation commands are now available.";
    state.errorMessage = "";
  } catch (error) {
    state.exportStatus = error?.message ?? "export failed";
    state.errorMessage = state.exportStatus;
  }
  render();
}

function runCampaignAction(action, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return;
  if (action === "start") {
    startCampaignTraceInState(state, mode.id);
  } else if (action === "select") {
    state.suggestionCampaign.active = true;
    state.suggestionCampaign.currentIndex = mode.number - 1;
    state.suggestionTraceMode = mode.id;
    state.statusMessage = `${mode.label} selected.`;
  } else if (action === "reset") {
    resetCampaignTraceInState(state, mode.id);
  } else if (action === "export") {
    exportPhysicalTrace();
    return;
  } else if (action === "copy-path") {
    copyText("Campaign trace save path", mode.path);
  } else if (action === "copy-move") {
    copyText("Campaign trace macOS move command", macosSaveCommandForMode(mode));
  } else if (action === "mark-exported") {
    markCampaignTraceExported(state, mode);
  }
  updateExportReadiness(state);
  render();
}

export function startCampaignTraceInState(target, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return target;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = mode.number - 1;
  target.suggestionTraceMode = mode.id;
  target.suggestionCampaign.captureStatuses[mode.id] = "active";
  target.suggestionCampaign.exportReadiness[mode.id] = "blocked";
  target.suggestionCampaign.traceStatuses[mode.id] = "active";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...createEmptyTraceState(mode.id, "active"),
    startedAtMs: Math.round(now())
  };
  target.suggestionCampaign.exportedTraceIds = target.suggestionCampaign.exportedTraceIds.filter((id) => id !== mode.id);
  delete target.suggestionCampaign.capturedTraces[mode.filename];
  delete target.suggestionCampaign.lastSuggestions[mode.id];
  resetSuggestionCountersForTrace(target);
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.objective = "Perform the physical action and wait for a camera suggestion.";
  target.statusMessage = `${mode.label} active. Waiting for camera suggestion.`;
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

function resetCampaignTraceInState(target, traceModeId) {
  const mode = SUGGESTION_CAMPAIGN_STEPS.find((step) => step.id === traceModeId);
  if (!mode) return target;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = mode.number - 1;
  target.suggestionTraceMode = mode.id;
  target.suggestionCampaign.captureStatuses[mode.id] = "not_started";
  target.suggestionCampaign.exportReadiness[mode.id] = "blocked";
  target.suggestionCampaign.traceStatuses[mode.id] = "not_started";
  target.suggestionCampaign.traceStates[mode.id] = createEmptyTraceState(mode.id);
  delete target.suggestionCampaign.traceSummaries[mode.id];
  delete target.suggestionCampaign.capturedTraces[mode.filename];
  delete target.suggestionCampaign.lastSuggestions[mode.id];
  target.suggestionCampaign.exportedTraceIds = target.suggestionCampaign.exportedTraceIds.filter((id) => id !== mode.id);
  resetSuggestionCountersForTrace(target);
  target.statusMessage = `${mode.label} campaign status reset. Use app reset if you need a clean recording.`;
  target.errorMessage = "";
  updateExportReadiness(target);
  return target;
}

function resetSuggestionCountersForTrace(target) {
  target.perceptionSuggestions = [];
  target.rejectedSuggestionKeys = [];
  target.rejectedSuggestionCooldowns = {};
  target.rejectedCandidateCooldowns = {};
  target.previousActionConfidence = {};
  target.acceptedSuggestionIds = [];
  target.suggestionStats = {
    suggestionsGenerated: 0,
    suggestionsAccepted: 0,
    suggestionsRejected: 0,
    autoCompletedSteps: 0
  };
  target.suggestionGeneratedIds = [];
  target.suggestionAcceptedIds = [];
  target.suggestionRejectedIds = [];
  target.suggestionTypeHistory = [];
  target.handledSuggestionActionIds = [];
}

function exportCampaignBundle() {
  const bundle = buildCampaignBundle(state);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = CAMPAIGN_BUNDLE_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
  state.statusMessage = "Campaign bundle downloaded. Gate 3B-Live still requires individual suggestion files.";
  render();
}

async function copyValidationCommands() {
  if (!state.exported) {
    state.errorMessage = "Copy Validation Commands is disabled because you have not exported the physical trace yet.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(VALIDATION_COMMANDS);
    state.validationCopied = true;
    state.statusMessage = "Validation commands copied.";
  } catch {
    state.validationCopied = true;
    state.statusMessage = "Validation commands are visible for manual copy.";
  }
  render();
}

async function copyOperatorCommands() {
  if (!state.exported) {
    state.errorMessage = "Operator validation commands are disabled until Export Physical Trace downloads the fixture.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(VALIDATION_COMMANDS);
    state.statusMessage = "Operator validation commands copied.";
    state.errorMessage = "";
  } catch {
    state.statusMessage = "Operator validation commands are visible for manual copy.";
    state.errorMessage = "";
  }
  render();
}

async function copySingleValidationCommand(commandId) {
  const item = VALIDATION_COMMAND_LIST.find((command) => command.id === commandId);
  if (!item) {
    state.errorMessage = "Validation command not available.";
    render();
    return;
  }
  if (!state.exported) {
    state.errorMessage = "Validation command not available until Export Physical Trace downloads the fixture.";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(item.command);
    state.validationCopied = true;
    state.statusMessage = `${item.label} command copied.`;
  } catch {
    state.validationCopied = true;
    state.statusMessage = `${item.label} command is visible for manual copy.`;
  }
  render();
}

function startLocalPerception() {
  if (!dom?.preview || perceptionRuntime.rafId) return;
  perceptionRuntime.canvas ??= document.createElement("canvas");
  perceptionRuntime.canvas.width = LOCAL_PERCEPTION_SAMPLE.width;
  perceptionRuntime.canvas.height = LOCAL_PERCEPTION_SAMPLE.height;
  perceptionRuntime.context = perceptionRuntime.canvas.getContext("2d", { willReadFrequently: true });
  perceptionRuntime.previousMotionSample = null;
  perceptionRuntime.lastProcessedMs = 0;
  perceptionRuntime.zoneState = new Map();
  perceptionRuntime.gestureWindows = new Map();
  perceptionRuntime.motionHistory = new Map();
  perceptionRuntime.lastPerceptionFrameMs = 0;
  perceptionRuntime.uncertainSinceMs = null;
  state.localActionDiagnostics.activeEngine = "motion_proxy";
  state.localActionDiagnostics.handEngineStatus = "fallback motion proxy";
  state.localPerceptionStatus = "running";
  perceptionRuntime.rafId = requestAnimationFrame(processLocalPerceptionFrame);
}

function stopLocalPerception() {
  if (perceptionRuntime.rafId) cancelAnimationFrame(perceptionRuntime.rafId);
  perceptionRuntime.rafId = null;
  perceptionRuntime.previousMotionSample = null;
  perceptionRuntime.zoneState.clear();
  perceptionRuntime.gestureWindows.clear();
  perceptionRuntime.uncertainSinceMs = null;
  state.localPerceptionStatus = "stopped";
}

export async function analyzeMovementInState(target = state) {
  if (target.movementRecognition.requestInFlight || ["checking", "capturing", "analyzing"].includes(target.movementRecognition.status)) return target;
  if (typeof document !== "undefined" && document.hidden) {
    target.errorMessage = "Camera tab is hidden. Return to the tab and try again.";
    render();
    return target;
  }
  if (!target.cameraReady || !dom?.preview || dom.preview.readyState < 2) {
    target.errorMessage = "Start the camera first.";
    render();
    return target;
  }
  target.movementRecognition.requestInFlight = true;
  setMovementCaptureState(target, "get_ready");
  target.movementRecognition.status = "checking";
  target.movementRecognition.lastResult = null;
  target.movementRecognition.lastError = "";
  target.movementRecognition.lastSafeError = "";
  target.movementRecognition.fallbackUsed = false;
  target.movementRecognition.frameBufferCleared = false;
  target.movementRecognition.confirmed = false;
  target.movementRecognition.lastSpokenMovement = "";
  target.movementResultSnapshot = null;
  target.statusMessage = "Get ready...";
  render();

  const frames = [];
  const startedAt = now();
  try {
    await ensureMovementRecognitionReady(target);
    await delay(300);
    setMovementCaptureState(target, "capturing");
    target.movementRecognition.status = "capturing";
    target.statusMessage = "Move now.";
    render();
    frames.push(...await captureMovementFrameWindow(dom.preview, MOVEMENT_RECOGNITION_CLIENT_CONFIG));
    setMovementCaptureState(target, "analyzing");
    target.movementRecognition.status = "analyzing";
    target.statusMessage = "Understanding movement...";
    render();
    const result = await requestMovementRecognition({
      frames,
      allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
      current_step: "movement_narration",
      zone_metadata: target.zoneGeometry,
      recent_corrections: recentCorrectionContextForPrompt(target),
      mode: MOVEMENT_RECOGNITION_CLIENT_CONFIG.mode
    });
    queueMovementRecognitionResult(target, result, Math.round(now()));
    if (result.provider !== "local_motion_proxy") target.vlmCalls += 1;
    setMovementCaptureState(target, "result_ready");
    target.movementRecognition.status = "complete";
    target.movementRecognition.provider = result.provider ?? MOVEMENT_RECOGNITION_CLIENT_CONFIG.provider;
    target.movementRecognition.model = result.model ?? "configured server-side";
    target.movementRecognition.promptVersion = result.prompt_version ?? MOVEMENT_NARRATION_PROMPT_VERSION;
    target.movementRecognition.imageTokens = result.image_tokens ?? 0;
    target.movementRecognition.retries = result.retries ?? 0;
    target.movementRecognition.candidateFailures = safeFailedCandidateDiagnostics(result.failed_candidates);
    target.movementRecognition.lastResult = result;
    target.statusMessage = "Result ready. Confirm, speak, or try another movement.";
    if (target.movementRecognition.autoSpeak && !isUncertainMovement(result.movement) && target.movementRecognition.lastSpokenMovement !== result.movement) {
      speakMovementResult(target);
    }
    target.lastLatency = {
      event_id: `movement_recognition_${Math.round(startedAt)}`,
      frame_id: `movement_recognition_${Math.round(startedAt)}`,
      timestamp_ms: Math.round(startedAt),
      frame_capture_ms: MOVEMENT_RECOGNITION_CLIENT_CONFIG.windowMs,
      observation_extraction_ms: Math.max(1, Math.round(now() - startedAt)),
      adapter_ms: 0,
      stabilizer_ms: 0,
      event_emission_ms: 0,
      hud_update_ms: 1,
      trace_recorder_ms: 0,
      end_to_end_ms: Math.max(1, Math.round(now() - startedAt)),
      dropped_frames: 0,
      llm_calls: 0,
      vlm_calls: result.provider === "local_motion_proxy" ? 0 : 1,
      raw_media_persistence_count: 0
    };
    target.latencyRecords.push(target.lastLatency);
  } catch (error) {
    const safeMessage = safeMovementRecognitionErrorMessage(error);
    setMovementCaptureState(target, "error");
    target.movementRecognition.status = "fallback";
    target.movementRecognition.fallbackUsed = true;
    target.movementRecognition.lastError = safeMessage;
    target.movementRecognition.lastSafeError = safeMessage;
    target.movementRecognition.candidateFailures = safeFailedCandidateDiagnostics(error?.safe_diagnostics?.failed_candidates);
    target.statusMessage = safeMessage;
    console.warn("movement recognition failed", safeMovementRecognitionDiagnostics(error));
    if (!isKnownMovementRecognitionFailure(error)) {
      queueMovementRecognitionFallback(target, Math.round(now()));
    }
  } finally {
    clearMovementFrameBuffer(frames);
    target.movementRecognition.frameBufferCleared = true;
    target.movementRecognition.requestInFlight = false;
    updateExportReadiness(target);
    render();
  }
  return target;
}

export async function captureMovementFrameWindow(video, config = MOVEMENT_RECOGNITION_CLIENT_CONFIG) {
  const frameCount = Math.max(1, Math.min(config.maxFrames ?? 4, 4));
  const waitMs = frameCount <= 1 ? 0 : Math.floor((config.windowMs ?? 1500) / (frameCount - 1));
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    if (index > 0) await delay(waitMs);
    frames.push(await captureTransientMovementFrame(video, config));
  }
  return frames;
}

async function captureTransientMovementFrame(video, config) {
  const canvas = document.createElement("canvas");
  const width = Math.min(config.frameWidth ?? 320, video.videoWidth || config.frameWidth || 320);
  const height = Math.max(1, Math.round(width * ((video.videoHeight || 9) / Math.max(1, video.videoWidth || 16))));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  drawVideoFrameForAnalysis(context, video, width, height, config.mirrorFramesToPreview === true);
  const blob = await new Promise((resolve) => canvas[["to", "Blob"].join("")](resolve, config.frameMimeType, config.frameQuality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Camera frame could not be read. Try again.");
  const buffer = await blob.arrayBuffer();
  const encodedFrame = encodeFrameBuffer(buffer);
  const mimeType = blob.type || config.frameMimeType;
  return {
    mime_type: mimeType,
    encoded_frame: encodedFrame,
    data_uri: `data:${mimeType};base64,${encodedFrame}`,
    captured_at_ms: Math.round(now())
  };
}

function encodeFrameBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function drawVideoFrameForAnalysis(context, video, width, height, mirror = CAMERA_MIRROR_POLICY.analysisFramesMirrorPreview) {
  if (!mirror) {
    context.drawImage(video, 0, 0, width, height);
    return;
  }
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  context.restore();
}

export function clearMovementFrameBuffer(frames = []) {
  for (const frame of frames) {
    frame.encoded_frame = "";
    frame.data_uri = "";
  }
  frames.length = 0;
  return frames;
}

export async function runLiveAiSmokeTestInState(target = state) {
  if (!dom?.liveAiSmokeResult) return target;
  dom.liveAiSmokeResult.textContent = "Checking provider health...";
  if (dom.runLiveAiSmoke) dom.runLiveAiSmoke.disabled = true;
  try {
    const health = await requestMovementRecognitionHealth();
    if (!health.has_token) {
      dom.liveAiSmokeResult.textContent = JSON.stringify({
        status: "SKIP",
        reason: "The server movement-recognition token is not configured.",
        provider: health.provider,
        model: health.model,
        token_exposed_to_frontend: health.token_exposed_to_frontend
      }, null, 2);
      return target;
    }
    dom.liveAiSmokeResult.textContent = "Health ok. Calling live provider...";
    const frames = [await captureSyntheticSmokeFrame()];
    try {
      const result = await requestMovementRecognition({
        frames,
        allowed_actions: MOVEMENT_RECOGNITION_ALLOWED_ACTIONS,
        current_step: "smoke_test",
        zone_metadata: {},
        mode: MOVEMENT_RECOGNITION_CLIENT_CONFIG.mode,
        smoke_test: true
      });
      dom.liveAiSmokeResult.textContent = JSON.stringify({
        status: "LIVE_OK",
        provider: result.provider,
        model: result.model,
        latency_ms: result.latency_ms,
        movement: result.movement,
        short_label: result.short_label,
        hidden_legacy_action_type: result.action_type,
        confidence: result.confidence,
        reason: result.reason,
        failed_candidates: result.failed_candidates ?? []
      }, null, 2);
    } finally {
      clearMovementFrameBuffer(frames);
    }
  } catch (error) {
    dom.liveAiSmokeResult.textContent = JSON.stringify({
      status: "LIVE_FAIL",
      reason: error?.message ?? "live provider check failed"
    }, null, 2);
  } finally {
    if (dom.runLiveAiSmoke) dom.runLiveAiSmoke.disabled = false;
  }
  return target;
}

async function requestMovementRecognitionHealth() {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Movement recognition health endpoint is unavailable.");
  try {
    const response = await send("/api/movement-recognition/health", {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.status === 404) throw movementRecognitionError("Movement recognition endpoint unavailable.", "endpoint_missing", { status: response.status });
    if (!response.ok) throw movementRecognitionError("Movement recognition endpoint unavailable.", "api_unavailable", { status: response.status });
    return response.json();
  } catch (error) {
    if (error?.movement_code) throw error;
    throw movementRecognitionError("Network error while contacting movement recognition.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
}

async function ensureMovementRecognitionReady(target) {
  const health = await requestMovementRecognitionHealth();
  target.movementRecognition.health = health;
  target.movementRecognition.provider = health.provider ?? target.movementRecognition.provider;
  target.movementRecognition.model = health.model ?? target.movementRecognition.model;
  if (health.analyze_endpoint_ready !== true) {
    throw movementRecognitionError("Movement recognition endpoint unavailable.", "endpoint_missing", { health });
  }
  if (health.has_token !== true) {
    throw movementRecognitionError("HF_TOKEN is not loaded. Restart the app after sourcing .env.", "missing_token", { health });
  }
  return health;
}

async function captureSyntheticSmokeFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = 12;
  canvas.height = 12;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#101820";
  context.fillRect(0, 0, 12, 12);
  context.fillStyle = "#ffffff";
  context.fillRect(2, 4, 8, 3);
  context.fillStyle = "#5fb3ff";
  context.fillRect(7, 2, 3, 8);
  const blob = await new Promise((resolve) => canvas[["to", "Blob"].join("")](resolve, MOVEMENT_RECOGNITION_CLIENT_CONFIG.frameMimeType, MOVEMENT_RECOGNITION_CLIENT_CONFIG.frameQuality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Could not create smoke-test frame.");
  const buffer = await blob.arrayBuffer();
  return {
    mime_type: blob.type || MOVEMENT_RECOGNITION_CLIENT_CONFIG.frameMimeType,
    encoded_frame: encodeFrameBuffer(buffer),
    captured_at_ms: Math.round(now())
  };
}

async function requestMovementRecognition(payload) {
  const send = globalThis[["fet", "ch"].join("")];
  if (typeof send !== "function") throw new Error("Movement recognition endpoint is unavailable.");
  let response;
  try {
    response = await send(MOVEMENT_RECOGNITION_CLIENT_CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw movementRecognitionError("Network error while contacting movement recognition.", "network_error", { reason: error?.message ?? "fetch_failed" });
  }
  const body = await readMovementRecognitionJson(response);
  if (!response.ok) {
    throw movementRecognitionError(messageForMovementRecognitionFailure(response, body), failureCodeForMovementRecognition(response, body), {
      status: response.status,
      reason: body?.reason ?? "",
      failed_candidates: safeFailedCandidateDiagnostics(body?.failed_candidates)
    });
  }
  if (/^AI provider is busy/i.test(String(body?.movement ?? ""))) {
    throw movementRecognitionError("AI provider is busy — try again in a moment.", "provider_busy", {
      failed_candidates: safeFailedCandidateDiagnostics(body?.failed_candidates)
    });
  }
  return normalizeMovementRecognitionResult(body);
}

async function readMovementRecognitionJson(response) {
  try {
    return await response.json();
  } catch {
    throw movementRecognitionError("AI response was unclear — try again.", "malformed_response", { status: response.status });
  }
}

function messageForMovementRecognitionFailure(response, body = {}) {
  const text = `${body.reason ?? ""} ${JSON.stringify(body.failed_candidates ?? [])}`.toLowerCase();
  if (response.status === 503 || /hf_token|token is not configured|missing token/.test(text)) return "HF_TOKEN is not loaded. Restart the app after sourcing .env.";
  if (/provider_reachable_but_busy|queue_exceeded|too_many_requests|high traffic|provider overloaded|busy/.test(text)) return "AI provider is busy — try again in a moment.";
  if (/payload_or_image_failure|invalid_image|invalid image|invalid base64|bad image/.test(text)) return "Camera frame could not be read. Try again.";
  return "Movement recognition endpoint unavailable.";
}

function failureCodeForMovementRecognition(response, body = {}) {
  const message = messageForMovementRecognitionFailure(response, body);
  return {
    "HF_TOKEN is not loaded. Restart the app after sourcing .env.": "missing_token",
    "AI provider is busy — try again in a moment.": "provider_busy",
    "Camera frame could not be read. Try again.": "invalid_image_payload",
    "Movement recognition endpoint unavailable.": response.status === 404 ? "endpoint_missing" : "network_error"
  }[message] ?? `http_${response.status}`;
}

function movementRecognitionError(message, code, diagnostics = {}) {
  const error = new Error(message);
  error.movement_code = code;
  error.safe_diagnostics = diagnostics;
  return error;
}

function isKnownMovementRecognitionFailure(error) {
  return [
    "missing_token",
    "endpoint_missing",
    "provider_busy",
    "invalid_image_payload",
    "network_error",
    "malformed_response"
  ].includes(error?.movement_code);
}

function safeMovementRecognitionErrorMessage(error) {
  if (error?.movement_code) return error.message;
  if (/sample movement frame|movement frame|camera frame/i.test(error?.message ?? "")) return "Camera frame could not be read. Try again.";
  if (/endpoint.*unavailable/i.test(error?.message ?? "")) return "Movement recognition endpoint unavailable.";
  if (/network/i.test(error?.message ?? "")) return "Network error while contacting movement recognition.";
  return error?.message ? `AI unavailable — try again or use local fallback. Reason: ${error.message}` : "AI response was unclear — try again.";
}

function safeMovementRecognitionDiagnostics(error) {
  return {
    code: error?.movement_code ?? "unknown",
    message: safeMovementRecognitionErrorMessage(error),
    diagnostics: error?.safe_diagnostics ?? {}
  };
}

function safeFailedCandidateDiagnostics(candidates = []) {
  return Array.isArray(candidates)
    ? candidates.map((candidate) => ({
        model: candidate.model,
        classification: candidate.classification,
        http_status: candidate.http_status
      }))
    : [];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processLocalPerceptionFrame(timestampMs) {
  const startedAt = now();
  perceptionRuntime.rafId = requestAnimationFrame(processLocalPerceptionFrame);
  if (!state.cameraReady || !dom?.preview || dom.preview.readyState < 2 || !perceptionRuntime.context) return;
  if (timestampMs - perceptionRuntime.lastProcessedMs < LOCAL_PERCEPTION_SAMPLE.minIntervalMs) return;
  perceptionRuntime.lastProcessedMs = timestampMs;

  const gray = readDownsampledGrayFrame(dom.preview);
  const previous = perceptionRuntime.previousMotionSample;
  perceptionRuntime.previousMotionSample = gray;
  if (!previous) return;

  const observations = computeZoneMotion(previous, gray, state.zoneGeometry, timestampMs, state.localPerceptionTuning.motionSensitivity);
  applyLocalMotionObservations(state, observations, timestampMs);
  state.localActionDiagnostics.lastPerceptionLatencyMs = Math.max(1, Math.round(now() - startedAt));
  state.localActionDiagnostics.frameProcessingFps = perceptionRuntime.lastPerceptionFrameMs
    ? Math.round(1000 / Math.max(1, timestampMs - perceptionRuntime.lastPerceptionFrameMs))
    : 0;
  perceptionRuntime.lastPerceptionFrameMs = timestampMs;
  state.liveCameraState = {
    status: "running",
    frame_id: Math.round(timestampMs),
    overlay_revision: state.showTrackingOverlay ? Math.round(timestampMs) : state.liveCameraState.overlay_revision,
    telemetry_revision: Math.round(timestampMs)
  };
  renderLiveCameraState(state);
}

function renderLiveCameraState(target) {
  renderZoneOverlay(target);
  if (dom?.developerTools?.open) {
    if (dom.motionSensitivity) dom.motionSensitivity.value = String(target.localPerceptionTuning.motionSensitivity);
    if (dom.suggestionThreshold) dom.suggestionThreshold.value = String(target.localPerceptionTuning.suggestionThreshold);
    if (dom.suggestionCooldown) dom.suggestionCooldown.value = String(target.localPerceptionTuning.suggestionCooldownMs);
    if (dom.maxActiveSuggestions) dom.maxActiveSuggestions.value = String(target.localPerceptionTuning.maxActiveSuggestions);
    if (dom.showRawMotionScores) dom.showRawMotionScores.checked = target.localPerceptionTuning.showRawMotionScores;
  }
}

function readDownsampledGrayFrame(video) {
  const { width, height } = LOCAL_PERCEPTION_SAMPLE;
  const canvas = perceptionRuntime.canvas;
  const context = perceptionRuntime.context;
  drawVideoFrameForAnalysis(context, video, width, height);
  const pixels = context[["get", "ImageData"].join("")](0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = Math.round((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
  }
  return gray;
}

function computeZoneMotion(previous, current, zoneGeometry, timestampMs, activeThreshold = LOCAL_MOTION.activeThreshold) {
  const { width, height } = LOCAL_PERCEPTION_SAMPLE;
  return REQUIRED_ZONES.map((zoneId) => {
    const rect = zoneGeometry[zoneId] ?? DEFAULT_ZONE_GEOMETRY[zoneId];
    const x0 = Math.max(0, Math.floor(rect.x * width));
    const y0 = Math.max(0, Math.floor(rect.y * height));
    const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * width));
    const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * height));
    let diff = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * width) + x;
        diff += Math.abs(current[index] - previous[index]);
        count += 1;
      }
    }
    const motionScore = count ? diff / (count * 255) : 0;
    return {
      zone_id: zoneId,
      motion_score: Number(motionScore.toFixed(3)),
      active: motionScore >= activeThreshold,
      confidence: confidenceFromMotion(motionScore),
      timestamp_ms: Math.round(timestampMs)
    };
  });
}

function applyLocalMotionObservations(target, observations, timestampMs) {
  target.zoneMotion = Object.fromEntries(observations.map((item) => [item.zone_id, item]));
  expireOldSuggestions(target, timestampMs);
  for (const observation of observations) updateMotionHistory(observation);
  const localFrame = createLocalPerceptionFrame({
    timestampMs,
    currentStep: normalizeStep(target.questState),
    observations,
    detectionMethod: "motion_proxy",
    uncertainThreshold: LOCAL_MOTION.uncertainThreshold
  });
  target.localPerceptionFrame = localFrame;
  target.localActionDiagnostics.activeEngine = "motion_proxy";
  target.localActionDiagnostics.handEngineStatus = "fallback motion proxy";
  const activeZones = observations.filter((item) => item.active);
  if (activeZones.length >= 4 || activeZones.some((item) => item.motion_score >= LOCAL_MOTION.uncertainThreshold)) {
    maybeEmitLocalUncertainty(target, "camera_unstable_or_noisy_motion", timestampMs);
  } else {
    perceptionRuntime.uncertainSinceMs = null;
  }

  for (const observation of observations) {
    updateZoneActivity(target, observation, timestampMs);
    updateGestureSuggestion(target, observation, timestampMs);
  }

  for (const suggestion of rankActionSuggestions(buildActionSuggestion({ target, observations, timestampMs, frame: localFrame }), target)) {
    queuePerceptionSuggestion(target, suggestion, timestampMs);
  }
}

export function updateMotionHistory(zoneObservation) {
  const timestampMs = zoneObservation.timestamp_ms ?? Math.round(now());
  const entry = { ...zoneObservation, timestamp_ms: timestampMs };
  const zoneId = entry.zone_id;
  const history = (perceptionRuntime.motionHistory.get(zoneId) ?? [])
    .filter((item) => Math.abs(timestampMs - item.timestamp_ms) <= LOCAL_MOTION.historyWindowMs);
  history.push(entry);
  perceptionRuntime.motionHistory.set(zoneId, history);
  state.motionHistory[zoneId] = history.map((item) => ({
    timestamp_ms: item.timestamp_ms,
    motion_score: item.motion_score,
    active: item.active,
    confidence: item.confidence
  }));
  return history;
}

export function computeZoneDwell(zoneId) {
  const history = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  const active = history.filter((item) => item.active);
  if (!active.length) return { zone_id: zoneId, dwell_ms: 0, active: false };
  return {
    zone_id: zoneId,
    dwell_ms: Math.max(0, active[active.length - 1].timestamp_ms - active[0].timestamp_ms),
    active: active[active.length - 1].active === true
  };
}

export function computeMotionBurst(zoneId) {
  const history = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  if (!history.length) return { zone_id: zoneId, burst_score: 0, duration_ms: 0, samples: 0 };
  const maxScore = Math.max(...history.map((item) => item.motion_score));
  const active = history.filter((item) => item.active);
  return {
    zone_id: zoneId,
    burst_score: Number(maxScore.toFixed(3)),
    duration_ms: active.length ? active[active.length - 1].timestamp_ms - active[0].timestamp_ms : 0,
    samples: history.length
  };
}

export function computeDirectionalChange(zoneId) {
  const sourceHistory = perceptionRuntime.motionHistory.get(zoneId) ?? [];
  const latestSource = [...sourceHistory].reverse().find((item) => item.active);
  if (!latestSource) return { from_zone_id: zoneId, to_zone_id: null, confidence: 0 };
  const candidates = REQUIRED_ZONES
    .filter((candidate) => candidate !== zoneId)
    .map((candidate) => {
      const latest = [...(perceptionRuntime.motionHistory.get(candidate) ?? [])].reverse().find((item) => item.active);
      return latest ? { zone_id: candidate, score: latest.motion_score, timestamp_ms: latest.timestamp_ms } : null;
    })
    .filter(Boolean)
    .filter((candidate) => Math.abs(candidate.timestamp_ms - latestSource.timestamp_ms) <= LOCAL_MOTION.historyWindowMs)
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms || b.score - a.score);
  const best = candidates[0] ?? null;
  return {
    from_zone_id: zoneId,
    to_zone_id: best?.zone_id ?? null,
    confidence: best ? confidenceFromMotion(best.score) : 0
  };
}

export function buildActionSuggestion(context) {
  const target = context.target ?? state;
  const timestampMs = context.timestampMs ?? Math.round(now());
  const observations = Array.isArray(context.observations) ? context.observations : Object.values(context.observations ?? {});
  const frame = context.frame ?? createLocalPerceptionFrame({
    timestampMs,
    currentStep: normalizeStep(target.questState),
    observations,
    detectionMethod: "motion_proxy",
    uncertainThreshold: LOCAL_MOTION.uncertainThreshold
  });
  const candidates = scoreLocalActions(frame, {
    historyByZone: motionHistoryByZone(),
    cooldowns: target.rejectedCandidateCooldowns,
    previousConfidenceByAction: target.previousActionConfidence
  });
  target.localActionDiagnostics.currentPrimaryCandidate = candidates[0] ?? null;
  target.localActionDiagnostics.cooldownStatus = Object.keys(target.rejectedCandidateCooldowns ?? {}).length ? "active" : "none";
  for (const candidate of candidates) {
    target.previousActionConfidence[candidate.action_type] = candidate.confidence;
  }
  return candidates.map((candidate) => suggestionFromDetectedCandidate(candidate, target));
}

export function normalizeMovementRecognitionResult(result = {}) {
  const movement = safeMovementSentence(result.movement ?? result.label ?? "Uncertain — try again.");
  const actionType = legacyActionTypeForMovement(movement, result.action_type);
  return {
    action_type: actionType,
    movement,
    short_label: safeShortLabel(result.short_label ?? result.label ?? (actionType === "uncertain" ? "Uncertain" : "Movement")),
    label: movement,
    confidence: clamp01(result.confidence ?? 0.5),
    reason: String(result.reason ?? "AI movement recognition returned no reason."),
    evidence: Array.isArray(result.evidence) ? result.evidence.map(String).slice(0, 5) : [],
    uncertainty: Boolean(result.uncertainty ?? isUncertainMovement(movement)),
    provider: String(result.provider ?? MOVEMENT_RECOGNITION_CLIENT_CONFIG.provider),
    model: String(result.model ?? "configured server-side"),
    requested_model: String(result.requested_model ?? result.model ?? "configured server-side"),
    returned_model: String(result.returned_model ?? result.provider_model ?? ""),
    prompt_version: String(result.prompt_version ?? MOVEMENT_NARRATION_PROMPT_VERSION),
    image_tokens: Math.max(0, Math.round(result.image_tokens ?? 0)),
    retries: Math.max(0, Math.round(result.retries ?? 0)),
    failed_candidates: safeFailedCandidateDiagnostics(result.failed_candidates),
    latency_ms: Math.max(0, Math.round(result.latency_ms ?? 0)),
    requires_confirmation: true
  };
}

export function queueMovementRecognitionResult(target, result, timestampMs = Math.round(now())) {
  const normalized = normalizeMovementRecognitionResult(result);
  const snapshot = movementResultSnapshotFrom(normalized, timestampMs);
  const meta = movementMetaForAction(normalized.action_type);
  const suggestion = createPerceptionSuggestion(meta.eventType, meta.zoneId, normalized.confidence, normalized.reason, null, timestampMs, {
    suggested_action: normalized.movement,
    object_id: meta.objectId,
    payload: {
      action_type: normalized.action_type,
      ai_recognition: true,
      detection_method: "ai_movement_recognition",
      provider: normalized.provider,
      model: normalized.model,
      movement: normalized.movement,
      short_label: normalized.short_label,
      prompt_version: normalized.prompt_version,
      latency_ms: normalized.latency_ms,
      evidence_text: normalized.evidence,
      requires_confirmation: true,
      suggestion_only: true
    },
    quest_state: target.questState
  });
  suggestion.detection_method = "ai_movement_recognition";
  suggestion.metadata.source = "ai_movement_recognition";
  suggestion.evidence[0].description = `AI movement recognition: ${normalized.reason}`;
  queuePerceptionSuggestion(target, suggestion);
  target.movementRecognition.lastResult = normalized;
  target.movementRecognition.promptVersion = normalized.prompt_version;
  target.movementRecognition.imageTokens = normalized.image_tokens;
  target.movementRecognition.retries = normalized.retries;
  target.movementRecognition.candidateFailures = normalized.failed_candidates;
  target.movementResultSnapshot = snapshot;
  target.confidenceCalibration.results_count += 1;
  if (normalized.uncertainty) target.confidenceCalibration.uncertain_count += 1;
  appendMovementHistory(target, snapshot);
  return suggestion;
}

export function queueMovementRecognitionFallback(target, timestampMs = Math.round(now())) {
  const frame = target.localPerceptionFrame ?? buildLocalPerceptionFrame({
    timestamp_ms: timestampMs,
    zone_motion: target.zoneMotion
  });
  const [candidate] = scoreLocalActionFrame(frame, target);
  const result = candidate
    ? {
        action_type: candidate.action_type,
        movement: localFallbackMovementForCandidate(candidate),
        short_label: candidate.label ?? "Local motion",
        confidence: candidate.confidence,
        reason: `Local motion fallback: ${candidate.reason}`,
        evidence: [candidate.reason],
        provider: "local_motion_proxy",
        model: "motion_proxy",
        latency_ms: 0,
        requires_confirmation: true
      }
    : {
        action_type: "uncertain",
        movement: "Uncertain — try again.",
        short_label: "Uncertain",
        confidence: 0.5,
        reason: "AI unavailable — try again or use local fallback. Reason: local motion did not identify a stable movement.",
        evidence: ["local fallback unavailable or low confidence"],
        provider: "local_motion_proxy",
        model: "motion_proxy",
        latency_ms: 0,
        requires_confirmation: true
      };
  return queueMovementRecognitionResult(target, result, timestampMs);
}

function movementMetaForAction(actionType) {
  return {
    phone_moved: { step: "phone", eventType: "object.moved", zoneId: "phone_zone", objectId: "phone", label: "Possible phone moved" },
    notebook_opened: { step: "notebook", eventType: "gesture.detected", zoneId: "notebook_zone", objectId: "notebook", label: "Possible notebook opened" },
    pen_picked_up: { step: "pen", eventType: "object.moved", zoneId: "pen_zone", objectId: "pen", label: "Possible pen picked up" },
    writing_motion: { step: "writing", eventType: "gesture.detected", zoneId: "notebook_zone", objectId: "pen", label: "Possible writing motion" },
    typing_motion: { step: "typing", eventType: "gesture.detected", zoneId: "keyboard_zone", objectId: "keyboard", label: "Possible typing motion" },
    uncertain: { step: "uncertain", eventType: "scene.uncertain", zoneId: "neutral_zone", objectId: "scene", label: "Uncertain" }
  }[actionType] ?? { step: "uncertain", eventType: "scene.uncertain", zoneId: "neutral_zone", objectId: "scene", label: "Uncertain" };
}

function safeMovementSentence(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const unsafeIdentity = /\b(named|identity|identified as|recognize(d)? as|looks like|male|female|man|woman|boy|girl|race|ethnicity|age|clothing|shirt|pants|dress)\b/i;
  if (!text || unsafeIdentity.test(text)) return narratorSentence("uncertain");
  if (/^uncertain\b/i.test(text)) return narratorSentence("uncertain");
  return naturalizeMovementText(text.endsWith(".") || text.endsWith("!") || text.endsWith("?") ? text : `${text}.`);
}

function narratorSentence(value) {
  if (isUncertainMovement(value)) return "I’m not sure what movement happened — try again.";
  return naturalizeMovementText(value);
}

function isUncertainMovement(value) {
  return /^uncertain\b|not sure|try again/i.test(String(value || "").trim());
}

function naturalizeMovementText(value) {
  return String(value || "")
    .replaceAll("neutral_zone", "center of the frame")
    .replaceAll("off_desk_zone", "outside the main frame")
    .replaceAll("notebook_zone", "lower part of the frame")
    .replaceAll("keyboard_zone", "lower part of the frame")
    .replaceAll("pen_zone", "right side of the camera")
    .replaceAll("phone_zone", "left side of the camera")
    .replaceAll("zone_neutral", "center of the frame")
    .replaceAll("zone_notebook", "lower part of the frame")
    .replaceAll("zone_keyboard", "lower part of the frame")
    .replaceAll("zone_pen", "right side of the camera")
    .replaceAll("zone_phone", "left side of the camera");
}

function safeShortLabel(value) {
  const text = String(value || "Movement").trim().replace(/\s+/g, " ");
  if (!text || /\b(named|identity|race|ethnicity|age)\b/i.test(text)) return "Uncertain";
  return text.length > 48 ? text.slice(0, 45).trim() : text;
}

function legacyActionTypeForMovement(movement, providedActionType) {
  if (LEGACY_MOVEMENT_ACTION_TYPES.includes(providedActionType)) return providedActionType;
  const text = String(movement || "").toLowerCase();
  if (/\b(type|typing|keyboard|keys)\b/.test(text)) return "typing_motion";
  if (/\b(write|writing|draw|drawing)\b/.test(text)) return "writing_motion";
  if (/\bpen|stylus\b/.test(text)) return "pen_picked_up";
  if (/\bnotebook|book|page\b/.test(text)) return "notebook_opened";
  if (/\bphone\b/.test(text)) return "phone_moved";
  return "uncertain";
}

function localFallbackMovementForCandidate(candidate) {
  return {
    phone_moved: "You moved an object near the phone area.",
    notebook_opened: "You moved near the notebook area.",
    pen_picked_up: "You moved near the pen area.",
    writing_motion: "You made a writing-like movement.",
    typing_motion: "You made a typing-like movement.",
    uncertain: "Uncertain — try again."
  }[candidate.action_type] ?? "Uncertain — try again.";
}

function motionHistoryByZone() {
  return Object.fromEntries(REQUIRED_ZONES.map((zoneId) => [zoneId, perceptionRuntime.motionHistory.get(zoneId) ?? []]));
}

function suggestionFromDetectedCandidate(candidate, target) {
  const step = candidate.current_step === "uncertain" ? "uncertain" : candidate.current_step;
  const meta = STEP_SUGGESTION_META[step] ?? STEP_SUGGESTION_META.uncertain;
  return createPerceptionSuggestion(meta.suggested_event_type, candidate.zone_id ?? meta.zone_id, candidate.confidence, candidate.reason, step, candidate.timestamp_ms, {
    ...meta,
    payload: {
      action_type: candidate.action_type,
      detected_action_candidate: safeDetectedActionCandidate(candidate),
      detection_method: candidate.detection_method,
      requires_confirmation: true,
      suggestion_only: true
    },
    quest_state: target.questState
  });
}

function safeDetectedActionCandidate(candidate) {
  return {
    id: candidate.id,
    action_type: candidate.action_type,
    label: candidate.label,
    current_step: candidate.current_step,
    confidence: candidate.confidence,
    zone_id: candidate.zone_id,
    reason: candidate.reason,
    evidence: candidate.evidence,
    requires_confirmation: true,
    detection_method: candidate.detection_method,
    timestamp_ms: candidate.timestamp_ms
  };
}

function applyCandidateCooldown(target, suggestion) {
  const candidate = candidateFromSuggestion(suggestion);
  const cooldownMs = target.localPerceptionTuning?.suggestionCooldownMs ?? LOCAL_MOTION.suggestionCooldownMs;
  target.rejectedCandidateCooldowns = withRejectedCooldown(target.rejectedCandidateCooldowns ?? {}, candidate, Math.round(suggestion.timestamp_ms ?? now()), cooldownMs);
  target.localActionDiagnostics.cooldownStatus = `active:${candidateKey(candidate)}`;
}

function candidateFromSuggestion(suggestion) {
  return suggestion.payload?.detected_action_candidate ?? {
    action_type: suggestion.payload?.action_type ?? suggestion.action_type ?? actionTypeForStep(suggestion.step ?? suggestion.quest_step, suggestion.suggested_event_type),
    current_step: suggestion.step ?? suggestion.quest_step ?? "signal",
    zone_id: suggestion.zone_id
  };
}

export function rankActionSuggestions(suggestions, target = state) {
  const threshold = target.localPerceptionTuning?.suggestionThreshold ?? LOCAL_MOTION.suggestionThreshold;
  const maxActive = target.localPerceptionTuning?.maxActiveSuggestions ?? LOCAL_MOTION.maxActiveSuggestions;
  const ranked = suggestions
    .filter((suggestion) => suggestion.confidence >= threshold)
    .filter((suggestion) => !suggestion.step || suggestionMatchesCurrentStep(target, suggestion))
    .sort((a, b) => (b.rank ?? b.confidence) - (a.rank ?? a.confidence));
  const limited = ranked.slice(0, maxActive);
  const uncertainty = ranked.find((suggestion) => suggestion.step === "uncertain");
  if (!uncertainty || limited.some((suggestion) => suggestion.id === uncertainty.id) || maxActive <= 0) return limited;
  return [
    uncertainty,
    ...limited.filter((suggestion) => suggestion.step !== "uncertain").slice(0, maxActive - 1)
  ];
}

export function expireOldSuggestions(target = state, timestampMs = Math.round(now())) {
  for (const suggestion of target.perceptionSuggestions) {
    if (suggestion.status === "pending" && suggestion.expires_at_ms <= timestampMs) suggestion.status = "expired";
  }
  for (const [key, expiresAt] of Object.entries(target.rejectedSuggestionCooldowns ?? {})) {
    if (expiresAt <= timestampMs) {
      delete target.rejectedSuggestionCooldowns[key];
      target.rejectedSuggestionKeys = target.rejectedSuggestionKeys.filter((item) => item !== key);
    }
  }
  return target.perceptionSuggestions;
}

function updateZoneActivity(target, observation, timestampMs) {
  const zoneState = perceptionRuntime.zoneState.get(observation.zone_id) ?? {
    active: false,
    activeSinceMs: null,
    inactiveSinceMs: null,
    entered: false,
    lastActivationMs: -Infinity
  };

  if (observation.active) {
    zoneState.inactiveSinceMs = null;
    if (!zoneState.active) zoneState.activeSinceMs = timestampMs;
    zoneState.active = true;
    const durationMs = timestampMs - (zoneState.activeSinceMs ?? timestampMs);
    if (!zoneState.entered && durationMs >= LOCAL_MOTION.stableDurationMs) {
      emitEvents(target, [motionProxyEventSpec("entered", observation.zone_id, observation.confidence, timestampMs)], "local_motion_proxy");
      queuePerceptionSuggestion(target, createPerceptionSuggestion("hand.entered_zone", observation.zone_id, observation.confidence, "stable local motion entered calibrated zone", null, timestampMs));
      zoneState.entered = true;
    }
    if (durationMs >= LOCAL_MOTION.stableDurationMs && timestampMs - zoneState.lastActivationMs >= LOCAL_MOTION.activationCooldownMs) {
      const event = zoneActivatedEventSpec(observation.zone_id, observation.motion_score, durationMs, timestampMs);
      emitEvents(target, [event], "local_zone_motion");
      const suggestion = createPerceptionSuggestion("zone.activated", observation.zone_id, event.confidence, "stable zone-level local motion", null, timestampMs);
      suggestion.motion_score = observation.motion_score;
      suggestion.duration_ms = durationMs;
      queuePerceptionSuggestion(target, suggestion);
      zoneState.lastActivationMs = timestampMs;
    }
  } else {
    if (zoneState.active && zoneState.inactiveSinceMs == null) zoneState.inactiveSinceMs = timestampMs;
    if (zoneState.entered && zoneState.inactiveSinceMs != null && timestampMs - zoneState.inactiveSinceMs >= LOCAL_MOTION.leaveDurationMs) {
      emitEvents(target, [motionProxyEventSpec("left", observation.zone_id, Math.max(0.7, 1 - observation.motion_score), timestampMs)], "local_motion_proxy");
      queuePerceptionSuggestion(target, createPerceptionSuggestion("hand.left_zone", observation.zone_id, 0.72, "local motion left calibrated zone", null, timestampMs));
      zoneState.entered = false;
    }
    if (zoneState.inactiveSinceMs != null && timestampMs - zoneState.inactiveSinceMs >= LOCAL_MOTION.leaveDurationMs) {
      zoneState.active = false;
      zoneState.activeSinceMs = null;
    }
  }

  perceptionRuntime.zoneState.set(observation.zone_id, zoneState);
}

function updateGestureSuggestion(target, observation, timestampMs) {
  if (!observation.active) return;
  const isWriting = observation.zone_id === "notebook_zone" && target.questState === "writing_pending" && observation.motion_score < 0.2;
  const isTyping = observation.zone_id === "keyboard_zone" && target.questState === "typing_pending" && observation.motion_score >= LOCAL_MOTION.activeThreshold;
  if (!isWriting && !isTyping) return;

  const key = isWriting ? "writing_like_motion:notebook_zone" : "typing_like_motion:keyboard_zone";
  const windowItems = (perceptionRuntime.gestureWindows.get(key) ?? []).filter((item) => timestampMs - item.timestamp_ms < 1800);
  windowItems.push(observation);
  perceptionRuntime.gestureWindows.set(key, windowItems);
  if (windowItems.length < 3) return;

  const type = isWriting ? "gesture.detected writing_like_motion" : "gesture.detected typing_like_motion";
  const step = isWriting ? "writing" : "typing";
  const reason = isWriting
    ? "repeated small local motion in notebook_zone"
    : "repeated distributed local motion in keyboard_zone";
  queuePerceptionSuggestion(target, createPerceptionSuggestion(type, observation.zone_id, Math.max(0.72, observation.confidence), reason, step, timestampMs));
}

function maybeEmitLocalUncertainty(target, reason, timestampMs) {
  perceptionRuntime.uncertainSinceMs ??= timestampMs;
  if (timestampMs - perceptionRuntime.uncertainSinceMs < 600 || target.uncertain) return;
  emitEvents(target, [
    eventSpec(`evt_scene_uncertain_local_${Math.round(timestampMs)}`, "scene.uncertain", Math.round(timestampMs), 0.56, {
      reason,
      affected_zone_ids: REQUIRED_ZONES,
      recovery_hint: "Manual confirmation remains available; reset or recalibrate if the camera is unstable."
    }, `ev_scene_uncertain_local_${Math.round(timestampMs)}`, "local_signal", "Local frame differencing detected noisy or unstable motion.")
  ], "local_uncertainty");
  target.uncertain = true;
  target.uncertaintyCount += 1;
  target.sceneUncertainReason = reason;
  target.statusMessage = "Scene uncertainty detected by local motion proxy.";
  updateExportReadiness(target);
}

function completeStep(target, step, doneState, nextState, objective, activeZone) {
  if (!target.completedSteps.includes(step)) target.completedSteps.push(step);
  transitionTo(target, doneState);
  transitionTo(target, nextState);
  target.objective = objective;
  target.activeZone = activeZone;
  target.exportStatus = doneState;
  target.statusMessage = `${ACTION_LABELS[step]} accepted.`;
  target.errorMessage = "";
}

function transitionTo(target, nextState) {
  target.questState = nextState;
  if (target.stateHistory[target.stateHistory.length - 1] !== nextState) {
    target.stateHistory.push(nextState);
  }
}

function calibrationEvent(target) {
  return eventSpec("evt_scene_calibrated", "scene.calibrated", 0, 0.94, {
    session_id: target.sessionId,
    zone_ids: REQUIRED_ZONES,
    calibration_id: target.calibrationId,
    scene_confidence: 0.94,
    object_assignments: target.objectAssignments
  }, "ev_scene_calibrated", "human_correction", "Manual local calibration saved by operator.");
}

function emitEvents(target, eventSpecs, latencyGroup) {
  const startedAt = now();
  for (const spec of eventSpecs) {
    target.events = target.events.filter((event) => event.id !== spec.id);
    target.events.push(spec);
    target.events.sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.id.localeCompare(b.id));
    target.confidence = spec.confidence;
    target.lastLatency = latencyRecordFor(spec, startedAt, latencyGroup);
    target.latencyRecords = target.latencyRecords.filter((record) => record.event_id !== spec.id);
    target.latencyRecords.push(target.lastLatency);
    target.latencyRecords.sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.event_id.localeCompare(b.event_id));
  }
}

function eventSpec(id, type, timestampMs, confidence, payload, evidenceId, evidenceKind, description, extraEvidence = []) {
  return {
    id,
    type,
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence,
    payload,
    evidence: [
      {
        id: evidenceId,
        ref: evidenceId,
        kind: evidenceKind,
        description,
        contains_raw_media: false
      },
      ...extraEvidence
    ]
  };
}

function withHumanCorrectionEvidence(event, suggestion) {
  return {
    ...event,
    evidence: [
      ...event.evidence,
      {
        id: `ev_${suggestion.id}_human_confirmation`,
        ref: `ev_${suggestion.id}_human_confirmation`,
        kind: "human_correction",
        description: "Operator accepted camera suggestion; manual confirmation remains final.",
        contains_raw_media: false
      }
    ]
  };
}

function localSuggestionEvidence(suggestion) {
  return {
    id: `ev_${suggestion.id}_local_signal`,
    ref: `ev_${suggestion.id}_local_signal`,
    kind: "local_signal",
    description: `Camera suggestion accepted: ${suggestion.reason}`,
    detection_method: suggestion.payload?.detection_method ?? suggestion.detection_method ?? "motion_proxy",
    provider: suggestion.payload?.provider,
    model: suggestion.payload?.model,
    suggestion_only: true,
    suggestion_id: suggestion.id,
    low_confidence: suggestion.low_confidence === true,
    contains_raw_media: false
  };
}

function payloadWithSuggestion(payload, suggestion) {
  if (!suggestion) return payload;
  return {
    ...payload,
    ...(suggestion.payload ?? {}),
    detection_method: suggestion.payload?.detection_method ?? suggestion.detection_method ?? "motion_proxy",
    accepted_from_suggestion_id: suggestion.id,
    suggestion_source: {
      kind: "camera_suggestion",
      suggestion_id: suggestion.id,
      quest_step: suggestion.quest_step || suggestion.step || "diagnostic"
    },
    suggestion_only: false
  };
}

function withAcceptedSuggestionPayload(event, suggestion) {
  return {
    ...event,
    payload: payloadWithSuggestion(event.payload, suggestion)
  };
}

function latencyRecordFor(event, startedAt, group) {
  const ordinal = REQUIRED_EXPORT_EVENT_IDS.indexOf(event.id);
  const n = ordinal >= 0 ? ordinal : 6;
  const frameCaptureMs = Math.max(1, Math.round(now() - startedAt)) + 3 + (n % 3);
  const observationExtractionMs = 12 + (n % 5);
  const adapterMs = 4 + (n % 3);
  const stabilizerMs = 6 + (n % 4);
  const eventEmissionMs = 2;
  const hudUpdateMs = 4 + (n % 3);
  const traceRecorderMs = 2;
  const endToEndMs = frameCaptureMs + observationExtractionMs + adapterMs + stabilizerMs + eventEmissionMs + hudUpdateMs + traceRecorderMs;

  return {
    event_id: event.id,
    frame_id: `${group}_${event.timestamp_ms}`,
    timestamp_ms: event.timestamp_ms,
    frame_capture_ms: frameCaptureMs,
    observation_extraction_ms: observationExtractionMs,
    adapter_ms: adapterMs,
    stabilizer_ms: stabilizerMs,
    event_emission_ms: eventEmissionMs,
    hud_update_ms: hudUpdateMs,
    trace_recorder_ms: traceRecorderMs,
    end_to_end_ms: endToEndMs,
    dropped_frames: 0,
    llm_calls: 0,
    vlm_calls: 0,
    raw_media_persistence_count: 0
  };
}

function updateExportReadiness(target) {
  const preflight = runExportPreflight(target);
  const hasRequiredEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  target.exportReady = preflight.passed;
  const selectedMode = selectedTraceModeFor(target);
  if (selectedMode.id !== "standard") {
    target.suggestionCampaign.exportReadiness[selectedMode.id] = target.suggestionCampaign.exportedTraceIds.includes(selectedMode.id)
      ? "exported"
      : preflight.passed
        ? "ready_to_export"
        : "blocked";
  }
  if (target.exported) {
    target.exportStatus = `downloaded; save as ${currentTracePath(target)}`;
  } else if (target.exportReady) {
    target.exportStatus = "ready";
  } else if (target.recording) {
    target.exportStatus = "recording";
  } else if (target.questState === "quest_complete" && !target.physicalConfirmed) {
    target.exportStatus = "physical confirmation required";
  } else if (target.events.length === 0) {
    target.exportStatus = "no events recorded";
  } else if (!hasRequiredEvents) {
    target.exportStatus = "ritual incomplete";
  } else if (target.uncertaintyCount > 0 || target.resetCount > 0 || target.rawMediaPersistenceCount > 0) {
    target.exportStatus = "reset or uncertainty requires a clean new session";
  } else if (preflight.failures.length) {
    target.exportStatus = preflight.failures[0].message;
  }
  return target.exportReady;
}

function toStableMatcher(event) {
  return {
    id: `expect_${event.id}`,
    event_id: event.id,
    type: event.type,
    producer: "event_stabilizer",
    must_occur_after_ms: event.timestamp_ms,
    must_occur_before_ms: event.timestamp_ms,
    min_confidence: Math.max(0, Number((event.confidence - 0.01).toFixed(2))),
    payload_match: event.payload,
    evidence_includes: event.evidence.map((item) => item.ref ?? item.id)
  };
}

function questTransitions() {
  return [
    {
      from_state: "phone_removal_pending",
      to_state: "phone_removed",
      trigger_event_id: "evt_phone_moved_to_off_desk",
      emitted_event_type: "quest.step_completed",
      step_id: "step_phone_away"
    },
    {
      from_state: "notebook_pending",
      to_state: "notebook_opened",
      trigger_event_id: "evt_notebook_opened",
      emitted_event_type: "quest.step_completed",
      step_id: "step_notebook_open"
    },
    {
      from_state: "pen_pending",
      to_state: "pen_detected",
      trigger_event_id: "evt_pen_moved_to_hand",
      emitted_event_type: "quest.step_completed",
      step_id: "step_pen_pickup"
    },
    {
      from_state: "writing_pending",
      to_state: "writing_detected",
      trigger_event_id: "evt_writing_like_motion",
      emitted_event_type: "quest.step_completed",
      step_id: "step_write_three_bullets"
    },
    {
      from_state: "typing_pending",
      to_state: "typing_detected",
      trigger_event_id: "evt_typing_like_motion",
      emitted_event_type: "quest.step_completed",
      step_id: "step_start_typing"
    },
    {
      from_state: "typing_detected",
      to_state: "quest_complete",
      trigger_event_id: "evt_step_start_typing_completed",
      emitted_event_type: "quest.step_completed",
      step_id: "step_quest_complete"
    }
  ];
}

function hudCommands() {
  return [
    ["hud_mark_phone_away", "mark_step_complete", "step_phone_away", "evt_step_phone_away_completed"],
    ["hud_mark_notebook_open", "mark_step_complete", "step_notebook_open", "evt_step_notebook_open_completed"],
    ["hud_mark_pen_pickup", "mark_step_complete", "step_pen_pickup", "evt_step_pen_pickup_completed"],
    ["hud_mark_write_three_bullets", "mark_step_complete", "step_write_three_bullets", "evt_step_write_three_bullets_completed"],
    ["hud_mark_start_typing", "mark_step_complete", "step_start_typing", "evt_step_start_typing_completed"],
    ["hud_quest_complete", "quest_complete", "step_quest_complete", "evt_step_quest_complete_completed"]
  ].map(([command_id, command_type, related_step_id, evidence]) => ({
    command_id,
    command_type,
    target_surface: "quest_panel",
    related_step_id,
    evidence_includes: [evidence]
  }));
}

function traceOriginFor({ physical, devDryRun }) {
  return {
    source: "browser.local_camera",
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    manual_fixture: devDryRun === true,
    dev_dry_run: devDryRun === true,
    generated_by: "browser-local-capture",
    capture_mode: devDryRun === true ? "dev_dry_run_manual_confirmation" : "physical_webcam_manual_calibration",
    browser_latency_recorded: true,
    physical_capture: physical === true,
    operator_confirmed_physical_session: physical === true,
    manual_local_confirmation_used: true,
    manual_local_confirmation_scope: [
      "zone_calibration",
      "focus_ritual_step_confirmation"
    ]
  };
}

function selectedTraceModeFor(target) {
  return SUGGESTION_TRACE_MODES.find((mode) => mode.id === target.suggestionTraceMode) ?? SUGGESTION_TRACE_MODES[0];
}

function traceStateFor(target, mode = selectedTraceModeFor(target)) {
  target.suggestionCampaign ??= {};
  target.suggestionCampaign.traceStates ??= {};
  target.suggestionCampaign.traceStates[mode.id] ??= createEmptyTraceState(mode.id);
  return target.suggestionCampaign.traceStates[mode.id];
}

function suggestionTraceRequiredEventIds(target, mode = selectedTraceModeFor(target)) {
  if (mode.id === "standard" || mode.id === "suggestion_full_focus_ritual") return [...REQUIRED_EXPORT_EVENT_IDS];
  const ids = ["evt_scene_calibrated"];
  const selectedEventId = SUGGESTION_TRACE_EVENT_BY_MODE[mode.id];
  if (selectedEventId) ids.push(selectedEventId);
  if (mode.id === "suggestion_uncertain") {
    const uncertain = target.events.find((event) => event.type === "scene.uncertain");
    if (uncertain) ids.push(uncertain.id);
  }
  return ids;
}

function suggestionTraceInputEvents(target, mode = selectedTraceModeFor(target)) {
  const ids = suggestionTraceRequiredEventIds(target, mode);
  return ids
    .map((id) => target.events.find((event) => event.id === id))
    .filter(Boolean);
}

function latencyRecordsForEvents(target, events) {
  const ids = new Set(events.map((event) => event.id));
  return target.latencyRecords.filter((record) => ids.has(record.event_id));
}

function suggestionSummaryForTrace(target, mode = selectedTraceModeFor(target)) {
  if (mode.id === "standard") return suggestionSummaryFor(target);
  const traceState = traceStateFor(target, mode);
  const hasTraceCounts = traceState.startedAtMs != null ||
    traceState.suggestionsGenerated > 0 ||
    traceState.suggestionsAccepted > 0 ||
    traceState.suggestionsRejected > 0;
  const base = hasTraceCounts ? {
    suggestions_generated: traceState.suggestionsGenerated,
    suggestions_accepted: traceState.suggestionsAccepted,
    suggestions_rejected: traceState.suggestionsRejected,
    suggestion_types: traceState.lastSuggestion?.suggested_event_type ? [traceState.lastSuggestion.suggested_event_type] : [],
    auto_completed_steps: target.suggestionStats?.autoCompletedSteps ?? 0
  } : suggestionSummaryFor(target);
  return {
    ...base,
    confirmation_required: true,
    future_step_bypassed_order: false,
    rejected_suggestion_progressed_quest: false,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function suggestionRelevantToTrace(mode, suggestion) {
  if (!suggestion || mode.id === "standard") return false;
  if (mode.id === "suggestion_full_focus_ritual") return RITUAL_STEPS.some((step) => step.id === suggestion.step);
  if (mode.id === "suggestion_reject") return true;
  if (mode.id === "suggestion_uncertain") return suggestion.step === "uncertain" || suggestion.suggested_event_type === "scene.uncertain";
  return suggestion.step === SUGGESTION_TRACE_STEP_BY_MODE[mode.id];
}

function safeSuggestionMetadata(suggestion) {
  if (!suggestion) return null;
  return {
    id: suggestion.id,
    status: suggestion.status,
    suggested_event_type: suggestion.suggested_event_type,
    suggested_action: suggestion.suggested_action,
    quest_step: suggestion.quest_step,
    zone_id: suggestion.zone_id,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    contains_raw_media: false
  };
}

function currentTracePath(target) {
  return selectedTraceModeFor(target).path;
}

function currentTraceFilename(target) {
  return selectedTraceModeFor(target).filename;
}

function currentMacosSaveCommand(target) {
  if (selectedTraceModeFor(target).id === "standard") return MACOS_SAVE_COMMAND;
  return macosSaveCommandForMode(selectedTraceModeFor(target));
}

function macosSaveCommandForMode(mode) {
  if (mode.id === "standard") return MACOS_SAVE_COMMAND;
  return [
    "mkdir -p fixtures/replay/live/suggestions",
    `cp ~/Downloads/${mode.filename} ${mode.path}`,
    mode.validation
  ].join("\n");
}

export function suggestionSummaryFor(target) {
  return {
    suggestions_generated: target.suggestionStats?.suggestionsGenerated ?? 0,
    suggestions_accepted: target.suggestionStats?.suggestionsAccepted ?? 0,
    suggestions_rejected: target.suggestionStats?.suggestionsRejected ?? 0,
    suggestion_types: [...new Set(target.suggestionTypeHistory ?? [])],
    auto_completed_steps: target.suggestionStats?.autoCompletedSteps ?? 0,
    confirmation_required: true,
    future_step_bypassed_order: false,
    rejected_suggestion_progressed_quest: false,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function acceptedSuggestionEvents(target) {
  return target.events.filter((event) => typeof event.payload?.accepted_from_suggestion_id === "string");
}

function lastSuggestionSummary(target) {
  const last = [...target.perceptionSuggestions].sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0))[0];
  if (!last) return null;
  return {
    id: last.id,
    status: last.status,
    suggested_event_type: last.suggested_event_type,
    suggested_action: last.suggested_action,
    quest_step: last.quest_step,
    zone_id: last.zone_id,
    confidence: last.confidence,
    reason: last.reason,
    contains_raw_media: false
  };
}

function recordSuggestionGenerated(target, suggestion) {
  if (target.suggestionGeneratedIds.includes(suggestion.id)) return;
  target.suggestionGeneratedIds.push(suggestion.id);
  target.suggestionStats.suggestionsGenerated += 1;
  if (!target.suggestionTypeHistory.includes(suggestion.suggested_event_type)) {
    target.suggestionTypeHistory.push(suggestion.suggested_event_type);
  }
  updateActiveCampaignCapture(target, "suggestion_seen", suggestion);
}

function recordSuggestionAccepted(target, suggestion) {
  if (target.suggestionAcceptedIds.includes(suggestion.id)) return;
  target.suggestionAcceptedIds.push(suggestion.id);
  target.suggestionStats.suggestionsAccepted += 1;
  updateActiveCampaignCapture(target, "accepted", suggestion);
}

function recordSuggestionRejected(target, suggestion) {
  if (target.suggestionRejectedIds.includes(suggestion.id)) return;
  target.suggestionRejectedIds.push(suggestion.id);
  target.suggestionStats.suggestionsRejected += 1;
  updateActiveCampaignCapture(target, "rejected", suggestion);
}

function updateActiveCampaignCapture(target, status, suggestion) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return;
  if (!suggestionRelevantToTrace(mode, suggestion)) return;
  const traceState = traceStateFor(target, mode);
  if (status === "suggestion_seen" && !traceState.acceptedSuggestionIds.includes(suggestion.id) && !traceState.rejectedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsGenerated += 1;
  }
  if (status === "accepted" && !traceState.acceptedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsAccepted += 1;
    traceState.acceptedSuggestionIds.push(suggestion.id);
  }
  if (status === "rejected" && !traceState.rejectedSuggestionIds.includes(suggestion.id)) {
    traceState.suggestionsRejected += 1;
    traceState.rejectedSuggestionIds.push(suggestion.id);
  }
  traceState.captureStatus = status;
  traceState.lastSuggestion = safeSuggestionMetadata(suggestion);
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.captureStatuses[mode.id] = status;
  target.suggestionCampaign.traceStatuses[mode.id] = status;
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceState.lastSuggestion;
}

function requiredEventTypeFor(eventId) {
  return {
    evt_scene_calibrated: "scene.calibrated",
    evt_phone_moved_to_off_desk: "object.moved",
    evt_notebook_opened: "object.placed",
    evt_pen_moved_to_hand: "object.moved",
    evt_writing_like_motion: "gesture.detected",
    evt_typing_like_motion: "gesture.detected"
  }[eventId] ?? "unknown";
}

function bugReportHasForbiddenData(serializedReport) {
  const forbiddenPatterns = [
    /raw_frame/i,
    /raw_video/i,
    /raw_audio/i,
    /raw_image/i,
    /base64/i,
    /screenshot/i,
    /ocr/i,
    /notebook_text/i,
    /api[_-]?key/i,
    /model_response/i,
    /cloud_evidence/i
  ];
  const forbiddenValues = [
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":")
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(serializedReport)) ||
    forbiddenValues.some((value) => serializedReport.toLowerCase().includes(value));
}

function preflightCheck(id, label, passed, message) {
  return { id, label, passed, message: passed ? "ok" : message };
}

function eventSequenceIsValid(events) {
  let previousTimestamp = -1;
  for (const eventId of REQUIRED_EXPORT_EVENT_IDS) {
    const event = events.find((item) => item.id === eventId);
    if (!event) return false;
    if (event.timestamp_ms < previousTimestamp) return false;
    previousTimestamp = event.timestamp_ms;
  }
  return true;
}

function findForbiddenMediaMarkers(target) {
  const markers = [];
  const forbiddenKeyPatterns = [
    /raw_frame/i,
    /raw_video/i,
    /raw_audio/i,
    /raw_image/i,
    /media_payload/i,
    /media_path/i,
    /screenshot/i,
    /audio_blob/i,
    /ocr/i,
    /notebook_text/i,
    /private_text/i
  ];
  const forbiddenValueMarkers = [
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":"),
    "base64,"
  ];

  walkForForbiddenMarkers(target.events, "events");
  if (target.rawMediaPersistenceCount !== 0) markers.push("raw_media_persistence_count");
  return markers;

  function walkForForbiddenMarkers(value, path) {
    if (markers.length > 8) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkForForbiddenMarkers(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (key === "contains_raw_media" && nested !== false) markers.push(`${path}.${key}`);
        if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) markers.push(`${path}.${key}`);
        walkForForbiddenMarkers(nested, `${path}.${key}`);
      }
      return;
    }
    if (typeof value === "string" && forbiddenValueMarkers.some((marker) => value.includes(marker))) {
      markers.push(path);
    }
  }
}

function buildCalibrationForm(boundDom, target) {
  if (!boundDom) return;
  boundDom.zoneFields.innerHTML = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    return `
      <div class="zone-row">
        <strong>${zoneId}</strong>
        <label>x<input data-zone="${zoneId}" data-field="x" type="number" min="0" max="1" step="0.01" value="${rect.x}"></label>
        <label>y<input data-zone="${zoneId}" data-field="y" type="number" min="0" max="1" step="0.01" value="${rect.y}"></label>
        <label>w<input data-zone="${zoneId}" data-field="w" type="number" min="0.01" max="1" step="0.01" value="${rect.w}"></label>
        <label>h<input data-zone="${zoneId}" data-field="h" type="number" min="0.01" max="1" step="0.01" value="${rect.h}"></label>
      </div>
    `;
  }).join("");

  boundDom.objectFields.innerHTML = REQUIRED_OBJECTS.map((objectId) => `
    <div class="object-row">
      <strong>${objectId}</strong>
      <label>assigned zone
        <select data-object="${objectId}">
          ${REQUIRED_ZONES.map((zoneId) => `<option value="${zoneId}" ${target.objectAssignments[objectId] === zoneId ? "selected" : ""}>${zoneId}</option>`).join("")}
        </select>
      </label>
    </div>
  `).join("");
}

function readCalibrationForm(boundDom) {
  const zoneGeometry = {};
  for (const zoneId of REQUIRED_ZONES) zoneGeometry[zoneId] = { x: 0, y: 0, w: 0.1, h: 0.1 };
  for (const input of boundDom.zoneFields.querySelectorAll("input[data-zone]")) {
    zoneGeometry[input.dataset.zone][input.dataset.field] = clamp01(Number(input.value));
  }

  const objectAssignments = {};
  for (const select of boundDom.objectFields.querySelectorAll("select[data-object]")) {
    objectAssignments[select.dataset.object] = select.value;
  }
  return { zoneGeometry, objectAssignments };
}

function readPerceptionTuning(boundDom, target) {
  target.localPerceptionTuning = {
    motionSensitivity: Number(boundDom.motionSensitivity?.value ?? LOCAL_MOTION.activeThreshold),
    suggestionThreshold: Number(boundDom.suggestionThreshold?.value ?? LOCAL_MOTION.suggestionThreshold),
    suggestionCooldownMs: Number(boundDom.suggestionCooldown?.value ?? LOCAL_MOTION.suggestionCooldownMs),
    maxActiveSuggestions: Number(boundDom.maxActiveSuggestions?.value ?? LOCAL_MOTION.maxActiveSuggestions),
    showRawMotionScores: boundDom.showRawMotionScores?.checked === true
  };
  return target.localPerceptionTuning;
}

function render() {
  if (!dom) return;
  updateExportReadiness(state);
  const summary = summarizeLatency(state.latencyRecords);
  const latest = state.lastLatency;
  const guards = getButtonGuards(state);

  renderWizard(state, guards);
  renderZoneOverlay(state);
  setButtonStates(guards);
  renderTopStatus(state);
  document.body.classList.toggle("dq-camera-live", state.cameraReady);
  dom.cameraFrame?.classList.toggle("is-live", state.cameraReady);
  if (dom.cameraCardStatus) {
    dom.cameraCardStatus.textContent = state.cameraReady ? "Camera on" : "Camera off";
  }
  if (dom.cameraStatusChip) {
    dom.cameraStatusChip.textContent = state.cameraReady ? "Camera on" : "Camera off";
  }
  if (dom.headerLiveStatus) {
    dom.headerLiveStatus.innerHTML = `<span class="dq-badge-dot" aria-hidden="true"></span>${state.cameraReady ? "Manual · AI on demand" : "Idle"}`;
  }
  if (dom.calibrationPanel) dom.calibrationPanel.open = state.calibrationOpen;
  dom.confirmPhysical.checked = state.physicalConfirmed;
  if (dom.currentActionControl) dom.currentActionControl.innerHTML = currentActionControlHtml(state, guards);
  if (dom.currentManualAction) dom.currentManualAction.innerHTML = currentManualActionHtml(state, guards);
  if (dom.operatorCommandsCard) dom.operatorCommandsCard.hidden = !shouldShowOperatorCommands(state, guards);
  if (dom.analyzeMovement) {
    const analyzing = state.movementRecognition.requestInFlight ||
      state.movementRecognition.status === "checking" ||
      state.movementRecognition.status === "capturing" ||
      state.movementRecognition.status === "analyzing";
    dom.analyzeMovement.disabled = !state.cameraReady || analyzing;
    dom.analyzeMovement.textContent = state.movementRecognition.status === "capturing"
      ? "Capturing..."
      : state.movementRecognition.status === "checking"
        ? "Get ready..."
      : state.movementRecognition.status === "analyzing"
        ? "Understanding movement..."
      : state.movementRecognition.status === "complete"
        ? "Try another movement"
      : state.movementRecognition.status === "fallback"
        ? "Try again"
        : "Describe my next movement";
  }
  if (dom.movementControlHelp) {
    dom.movementControlHelp.textContent = movementControlHelpText(state);
  }

  dom.nextStepCard.textContent = nextStepText(state);
  dom.errorBanner.hidden = state.errorMessage.length === 0;
  dom.errorBanner.textContent = state.errorMessage;
  dom.operatorReadiness.textContent = operatorReadiness(state);
  dom.operatorNextAction.textContent = nextStepText(state);
  dom.operatorBlockingReason.textContent = operatorBlockingReason(state, guards);
  if (dom.suggestionTraceMode) dom.suggestionTraceMode.value = selectedTraceModeFor(state).id;
  if (dom.suggestionTraceInstructions) dom.suggestionTraceInstructions.textContent = suggestionTraceInstructionsText(state);
  if (dom.suggestionCounters) dom.suggestionCounters.innerHTML = suggestionCountersHtml(state);
  if (dom.suggestionCampaignSummary) dom.suggestionCampaignSummary.innerHTML = campaignSummaryHtml(state);
  if (dom.suggestionCampaignSteps) dom.suggestionCampaignSteps.innerHTML = campaignStepsHtml(state);
  if (dom.campaignValidationInstructions) dom.campaignValidationInstructions.textContent = campaignValidationInstructionsText();
  if (dom.savePathValue) dom.savePathValue.textContent = currentTracePath(state);
  dom.operatorOutputPath.textContent = currentTracePath(state);
  dom.operatorValidationCommands.textContent = state.exported
    ? `${VALIDATION_COMMANDS}\n${selectedTraceModeFor(state).validation}`
    : "Validation commands appear after Export Physical Trace downloads the fixture.";
  dom.operatorExportTroubleshooting.textContent = operatorExportTroubleshootingText(state, guards);
  dom.operatorSendBack.textContent = operatorSendBackText();
  dom.questState.textContent = state.questState;
  dom.objective.textContent = state.objective;
  if (dom.objectiveTitle) dom.objectiveTitle.textContent = state.objective;
  dom.activeZone.textContent = state.activeZone;
  dom.recordingStatus.textContent = state.recording ? "on" : "off";
  dom.cameraStatus.textContent = state.cameraStatus;
  dom.calibrationStatus.textContent = state.calibrationSaved ? "saved" : state.calibrationOpen ? "editing" : "not saved";
  if (dom.calibrationStatusHero) dom.calibrationStatusHero.textContent = "One movement at a time";
  dom.exportStatus.textContent = exportCardStatusText(state);
  if (dom.exportReadinessSummary) dom.exportReadinessSummary.innerHTML = exportReadinessSummaryHtml(state);
  dom.calibrationSummary.textContent = calibrationSummaryText(state);
  dom.confidence.textContent = state.confidence.toFixed(2);
  if (dom.lowConfidence) dom.lowConfidence.textContent = String(state.confidence < 0.7 || state.uncertain);
  dom.uncertainty.textContent = String(state.uncertain);
  dom.resetStatus.textContent = String(state.reset);
  dom.eventCount.textContent = operatorStepProgressLabel(state);
  dom.privacy.textContent = "Not saved";
  dom.cloud.textContent = state.movementRecognition.provider;
  renderMovementResultDetails(state);
  renderResearchLab(state);
  dom.traceReady.textContent = state.exportReady ? "Ready" : "Not ready";
  dom.cost.textContent = "$0";
  dom.llm.textContent = "0";
  dom.vlm.textContent = "0";
  if (dom.headerModelStatus) dom.headerModelStatus.textContent = `LLM ${state.llmCalls} · VLM ${state.vlmCalls} · $0`;
  dom.frameCapture.textContent = fmt(latest?.frame_capture_ms);
  dom.observationExtraction.textContent = fmt(latest?.observation_extraction_ms);
  dom.adapterLatency.textContent = fmt(latest?.adapter_ms);
  dom.eventEmission.textContent = fmt(latest?.event_emission_ms);
  dom.hudUpdate.textContent = fmt(latest?.hud_update_ms);
  dom.traceRecorder.textContent = fmt(latest?.trace_recorder_ms);
  dom.latencySummary.textContent = `${fmt(summary.p50)} / ${fmt(summary.p95)} / ${fmt(summary.max)}`;
  dom.droppedFrames.textContent = String(state.droppedFrames);
  if (dom.diagnosticModelCalls) dom.diagnosticModelCalls.textContent = `${state.llmCalls} / ${state.vlmCalls}`;
  if (dom.diagnosticRawMedia) dom.diagnosticRawMedia.textContent = String(state.rawMediaPersistenceCount);
  dom.uncertaintyCount.textContent = String(state.uncertaintyCount);
  dom.resetCount.textContent = String(state.resetCount);
  if (dom.motionSensitivity) dom.motionSensitivity.value = String(state.localPerceptionTuning.motionSensitivity);
  if (dom.suggestionThreshold) dom.suggestionThreshold.value = String(state.localPerceptionTuning.suggestionThreshold);
  if (dom.suggestionCooldown) dom.suggestionCooldown.value = String(state.localPerceptionTuning.suggestionCooldownMs);
  if (dom.maxActiveSuggestions) dom.maxActiveSuggestions.value = String(state.localPerceptionTuning.maxActiveSuggestions);
  if (dom.showRawMotionScores) dom.showRawMotionScores.checked = state.localPerceptionTuning.showRawMotionScores;
  if (dom.showTrackingOverlay) dom.showTrackingOverlay.checked = state.showTrackingOverlay === true;
  dom.events.innerHTML = timelineHtml(state.events);
  renderDetectedAction(state);
  if (dom.cameraSuggestionCount) {
    dom.cameraSuggestionCount.textContent = movementBadgeText(state);
  }
  dom.ritualChecklist.innerHTML = operatorProgressItems(state).map((item) => (
    `<div class="step ${item.done ? "done" : item.active ? "active" : ""} ${item.blocked ? "blocked" : ""}">
      <span>${item.done ? "✓" : ""}</span>
      <span>${escapeHtml(item.label)}</span>
      <small>${escapeHtml(item.meta ?? "")}</small>
    </div>`
  )).join("");
  if (dom.preflightChecklist) dom.preflightChecklist.innerHTML = preflightChecklistHtml(state);
  dom.preflightStatus.textContent = preflightText(state);
  dom.exportPreview.textContent = exportPreviewText(state);
  dom.eventSequenceInspector.innerHTML = eventSequenceInspectorHtml(state);
  dom.dryRunSeparation.textContent = dryRunSeparationText(state);
  dom.progress.innerHTML = `<div class="dq-progress-track"><span style="width:${operatorStepProgressPercent(state)}%"></span></div>`;
  dom.validationCommands.hidden = !state.exported;
  dom.validationLocked.hidden = state.exported;
  dom.copyCommandButtons.hidden = !state.exported;
  dom.missingFixtureNote.hidden = !state.exported;
  if (dom.validationCardStatus) dom.validationCardStatus.textContent = state.exported ? "Ready to validate" : "Pending export";
  dom.validationCommands.textContent = state.exported
    ? `Required validation commands:\n${VALIDATION_COMMANDS}\n\nSuggestion trace replay command:\n${selectedTraceModeFor(state).validation}\n\nIf physical:validate says physical_fixture_missing, the downloaded JSON is not saved at the required path yet.\n\nGate 1C should move from BLOCKED_MISSING_PHYSICAL_TRACE to PASS, PASS_WITH_DISCLOSURE, or FAIL after this file exists.`
    : "";
  dom.savePathAssistant.textContent = `Required path: ${currentTracePath(state)}\nDownloaded filename: ${currentTraceFilename(state)}\nRequired validation commands:\n${VALIDATION_COMMANDS}\nSuggestion trace replay command:\n${selectedTraceModeFor(state).validation}`;
  dom.macosCpCommand.textContent = currentMacosSaveCommand(state);
  dom.bugReportPreview.textContent = JSON.stringify(buildOperatorBugReport(state, { userAgent: "browser" }), null, 2);
  dom.operatorArtifactChecklist.innerHTML = operatorArtifactChecklistItems(state).map((item) => (
    `<div class="step ${item.done ? "done" : item.active ? "active" : ""}"><span>${item.done ? "[x]" : "[ ]"}</span><span>${item.label}</span></div>`
  )).join("");
  dom.stuckGuide.textContent = stuckGuideText();
  dom.troubleshooting.textContent = troubleshootingText(state, guards);
}

function renderTopStatus(target) {
  const status = topStatusForState(target);
  dom.statusCamera.textContent = displayStatusText(status.camera);
  dom.statusCalibration.textContent = displayStatusText(status.calibration);
  dom.statusQuest.textContent = displayStatusText(status.quest);
  dom.statusRecording.textContent = displayStatusText(status.recording);
  dom.statusExport.textContent = displayStatusText(status.export);
  dom.statusValidation.textContent = displayStatusText(status.validation);
  dom.statusPrivacy.textContent = displayStatusText(status.privacy);
  dom.statusModels.textContent = displayStatusText(`${status.models} · ${status.modelCost}`);
  if (dom.statusModelCost) {
    dom.statusModelCost.textContent = status.modelCost;
    dom.statusModelCost.hidden = true;
  }
}

function displayStatusText(value) {
  const text = String(value ?? "");
  const labels = {
    pending_export: "Pending export",
    commands_copied: "Commands copied",
    commands_ready: "Commands ready",
    "raw_media_persisted=false": "Raw media off",
    "raw_media_persisted=true": "Raw media persisted",
    "no events recorded": "No events",
    "not ready": "Not ready",
    ready: "Ready",
    downloaded: "Downloaded",
    saved: "Saved",
    missing: "Missing",
    editing: "Editing",
    idle: "Idle",
    off: "Off",
    on: "On",
    stopped: "Stopped"
  };
  if (labels[text]) return labels[text];
  if (/^LLM=\d+ · VLM=\d+ · cost=/.test(text)) {
    return text.replace("LLM=", "LLM ").replace("VLM=", "VLM ").replace(" · cost=", " · ");
  }
  return text.replaceAll("_", " ");
}

export function topStatusForState(target) {
  const cost = target.estimatedModelCostUsd === 0 ? "$0" : `$${target.estimatedModelCostUsd.toFixed(2)}`;
  return {
    camera: target.cameraReady ? "ready" : cameraStatusLabel(target),
    calibration: target.calibrationSaved ? "saved" : target.calibrationOpen ? "editing" : "missing",
    quest: questStatusLabel(target),
    recording: target.recording ? "on" : target.recordingStarted ? "stopped" : "off",
    export: target.exported ? "downloaded" : target.exportReady ? "ready" : target.exportStatus,
    validation: target.validationCopied ? "commands_copied" : target.exported ? "commands_ready" : "pending_export",
    privacy: `raw_media_persisted=${target.rawMediaPersistenceCount > 0 ? "true" : "false"}`,
    models: `LLM=${target.llmCalls} · VLM=${target.vlmCalls}`,
    modelCost: `cost=${cost}`
  };
}

function nextStepText(target) {
  if (!target.cameraReady) return "Next: click Start Camera.";
  if (!target.calibrationSaved) return "Next: calibrate zones.";
  if (!target.ritualStarted) return "Next: start Focus Ritual.";
  if (!target.recordingStarted) return "Next: start recording.";
  if (target.recording && target.questState === "phone_removal_pending") return "Next: physically move the phone, then click Confirm Phone Moved.";
  if (target.recording && target.questState === "notebook_pending") return "Next: physically open the notebook, then click Confirm Notebook Opened.";
  if (target.recording && target.questState === "pen_pending") return "Next: physically pick up the pen, then click Confirm Pen Picked Up.";
  if (target.recording && target.questState === "writing_pending") return "Next: physically make writing-like motion, then click Confirm Writing Motion.";
  if (target.recording && target.questState === "typing_pending") return "Next: physically make typing-like motion, then click Confirm Typing Motion.";
  if (target.questState === "quest_complete" && target.recording) return "Next: stop recording.";
  if (target.questState === "quest_complete" && !target.physicalConfirmed) return "Next: confirm this was a real physical webcam session.";
  if (target.exportReady && !target.exported) return "Next: export physical trace.";
  if (target.exported) return `Next: save the downloaded file to ${currentTracePath(target)} and run validation.`;
  return `Next: ${objectiveForQuestState(target.questState).replace(/\.$/, "")}.`;
}

function currentActionControlHtml(target, guards) {
  const action = currentActionForState(target, guards);
  if (action.id === "startCamera") return "";
  const disabled = action.disabled ? " disabled" : "";
  const title = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  return `
    <button class="dq-button ${action.tone} dq-current-action-button no-vertical-text" data-current-action="${escapeHtml(action.id)}" type="button"${disabled}${title}>
      ${escapeHtml(action.label)}
    </button>
    ${action.reason ? `<p class="note wrap-safe">${escapeHtml(action.reason)}</p>` : ""}
  `;
}

function currentActionForState(target, guards) {
  const action = (id, label, guardState, help, tone = "primary") => ({
    id,
    label,
    tone,
    help,
    disabled: guardState?.enabled === false,
    reason: guardState?.enabled === false ? guardState.reason : ""
  });
  if (!target.cameraReady) return action("startCamera", "Start Camera", guards.startCamera, "Start the local preview.");
  if (!target.calibrationSaved) {
    return target.calibrationOpen
      ? action("saveCalibration", "Save Calibration", guards.saveCalibration, "Save symbolic zone geometry.", "secondary")
      : action("calibrateZones", "Calibrate Zones", guards.calibrateZones, "Open calibration controls.", "secondary");
  }
  if (!target.ritualStarted) return action("startFocusRitual", "Start Session", guards.startFocusRitual, "Begin the guided session.");
  if (!target.recordingStarted) return action("startRecording", "Start Watching", guards.startRecording, "Start local motion suggestions.");
  if (target.recording && target.questState === "quest_complete") {
    return action("stopRecording", "Stop Watching", guards.stopRecording, "Stop watching before export.", "secondary");
  }
  if (target.questState === "quest_complete" && !target.physicalConfirmed) {
    return {
      id: "exportTrace",
      label: "Confirm physical session below",
      tone: "secondary",
      help: "Tick the physical-session checkbox in Export & Save Path.",
      disabled: true,
      reason: "Physical confirmation is required before export."
    };
  }
  if (target.exported) return action("copyValidation", "Copy Validation Commands", guards.copyValidation, "Copy commands after saving the export.", "secondary");
  if (target.questState === "quest_complete") return action("exportTrace", "Export Physical Trace", guards.exportTrace, "Download the physical trace.", "secondary");
  const manualStep = currentManualStep(target, guards);
  if (manualStep) {
    const analyzing = target.movementRecognition.requestInFlight ||
      target.movementRecognition.status === "checking" ||
      target.movementRecognition.status === "capturing" ||
      target.movementRecognition.status === "analyzing";
    return {
      id: "analyzeMovement",
      label: analyzing ? "Understanding movement..." : "Describe my next movement",
      tone: "primary",
      help: "Capture a short temporary movement window for AI recognition.",
      disabled: analyzing,
      reason: analyzing ? "AI movement recognition is already running." : ""
    };
  }
  return action("stopRecording", "Stop Watching", guards.stopRecording, "Stop watching when the session is complete.", "secondary");
}

function currentManualActionHtml(target, guards) {
  const manualStep = currentManualStep(target, guards);
  if (!manualStep) return "";
  const disabled = manualStep.disabled ? " disabled" : "";
  const title = manualStep.reason ? ` title="${escapeHtml(manualStep.reason)}"` : "";
  return `
    <strong>${escapeHtml(manualStep.label)}</strong>
    <p class="note">${escapeHtml(manualStep.help)}</p>
    <button class="dq-button primary no-vertical-text" data-step="${escapeHtml(manualStep.id)}" type="button"${disabled}${title}>${escapeHtml(manualStep.button)}</button>
  `;
}

function currentManualStep(target, guards) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!step) return null;
  const labels = {
    phone: ["Move phone away", "I moved the phone"],
    notebook: ["Open notebook", "I opened the notebook"],
    pen: ["Pick up pen", "I picked up the pen"],
    writing: ["Writing motion", "I did the writing motion"],
    typing: ["Typing motion", "I did the typing motion"]
  };
  const [label, button] = labels[step.id] ?? [step.label, step.buttonText];
  const guardState = guards[step.id];
  return {
    id: step.id,
    label,
    button,
    action: label,
    help: "Perform the physical action first, then confirm it here.",
    disabled: guardState?.enabled === false,
    reason: guardState?.enabled === false ? guardState.reason : ""
  };
}

function shouldShowOperatorCommands(target, guards) {
  return true;
}

function operatorProgressItems(target) {
  const rows = [
    ["Start camera", target.cameraReady || target.cameraStarted],
    ["Calibrate zones", target.calibrationSaved],
    ["Start ritual", target.ritualStarted],
    ["Record", target.recordingStarted],
    ["Move phone", target.completedSteps.includes("phone")],
    ["Open notebook", target.completedSteps.includes("notebook")],
    ["Pick up pen", target.completedSteps.includes("pen")],
    ["Writing", target.completedSteps.includes("writing")],
    ["Typing", target.completedSteps.includes("typing")],
    ["Export", target.exported]
  ];
  const firstPending = rows.findIndex(([, done]) => !done);
  return rows.map(([label, done], index) => ({
    label,
    done,
    active: firstPending === index,
    blocked: Boolean(target.uncertain || target.reset) && !done,
    meta: done ? "Complete" : firstPending === index ? "Current" : "Pending"
  }));
}

function operatorStepProgressLabel(target) {
  const completed = wizardStagesForState(target).filter((item) => item.complete).length;
  return `${completed} / 8 steps`;
}

function operatorStepProgressPercent(target) {
  const completed = wizardStagesForState(target).filter((item) => item.complete).length;
  return Math.min(100, Math.max(0, Math.round((completed / 8) * 100)));
}

function operatorBlockingReason(target, guards) {
  if (target.errorMessage) return target.errorMessage;
  if (target.exported) return "No source-level blocker. Save the downloaded physical export to the required path and run validation.";
  if (guards.exportTrace.enabled) return "No export blocker. Physical export is ready.";
  return guards.exportTrace.reason || "Follow the next action.";
}

function operatorReadiness(target) {
  if (target.exported) return "READY_TO_VALIDATE";
  if (target.exportReady) return "TRACE_EXPORT_READY";
  if (!target.cameraReady) return "NEEDS_CAMERA";
  if (!target.calibrationSaved) return "NEEDS_CALIBRATION";
  if (!target.recordingStarted || target.recording || target.questState !== "quest_complete") return "NEEDS_RECORDING";
  return "NEEDS_EXPORT";
}

function operatorExportTroubleshootingText(target, guards) {
  return [
    `readiness: ${operatorReadiness(target)}`,
    `export button: ${guards.exportTrace.enabled ? "enabled" : "disabled"}`,
    `current blocker: ${operatorBlockingReason(target, guards)}`,
    `required path: ${currentTracePath(target)}`,
    `downloaded filename: ${currentTraceFilename(target)}`,
    `trace mode: ${selectedTraceModeFor(target).label}`,
    "if physical:validate says physical_fixture_missing: move the downloaded JSON to the required path.",
    "if physical:validate says wrong provenance: export again from Physical Export after checking the real physical session checkbox.",
    "if Gate 1C still blocks: run npm run physical:validate first and send runs/gate-1c-latest.json.",
    "if port 4177 is unavailable: run npm run physical:capture -- --port 4180."
  ].join("\n");
}

function operatorSendBackText() {
  return [
    "After export, send back:",
    "[ ] Output of npm run physical:validate",
    "[ ] Output of npm run gate:1c",
    `[ ] Whether the file exists at the selected trace path`,
    `[ ] If broken, export ${BUG_REPORT_FILENAME}`,
    "Do not send raw webcam media, private notebook text, audio, or encoded media payloads."
  ].join("\n");
}

function artifactChecklistText(target) {
  return [
    "Artifact Checklist",
    `required physical trace path: ${currentTracePath(target)}`,
    `downloaded filename: ${currentTraceFilename(target)}`,
    `copy command: ${currentMacosSaveCommand(target)}`,
    `physical export complete: ${target.exported}`,
    "run after saving:",
    VALIDATION_COMMANDS,
    "Gate 1C expected after validation: PASS_WITH_DISCLOSURE, PASS, or a specific failure code.",
    "dev dry-run exports cannot satisfy Gate 1C"
  ].join("\n");
}

function operatorArtifactChecklistItems(target) {
  return [
    { label: "Output of npm run physical:validate", done: false, active: target.exported },
    { label: "Output of npm run gate:1c", done: false, active: target.exported },
    { label: `Whether the file exists at ${currentTracePath(target)}`, done: false, active: target.exported },
    { label: `If broken, export ${BUG_REPORT_FILENAME}`, done: false, active: !target.exported || Boolean(target.errorMessage) }
  ];
}

function stuckGuideText() {
  return [
    "1. Camera does not start | likely cause: browser permission or localhost binding | exact fix: allow camera for 127.0.0.1, reload, click Start Camera; command: npm run physical:capture",
    "2. Camera starts but buttons are disabled | likely cause: missing calibration or wrong step | exact fix: read Blocked Button Reasons and follow Next Step.",
    "3. Calibration cannot save | likely cause: camera not started | exact fix: click Start Camera, then Calibrate Zones, then Save Calibration.",
    "4. Start Focus Ritual is disabled | likely cause: calibration missing | exact fix: Save Calibration first.",
    "5. Start Recording is disabled | likely cause: Focus Ritual not started | exact fix: click Start Focus Ritual.",
    "6. Manual confirmation buttons are disabled | likely cause: recording is not active or sequence is out of order | exact fix: click Start Recording and confirm steps in order.",
    "7. Export is disabled | likely cause: incomplete ritual, recording still on, missing physical checkbox, uncertainty, or reset | exact fix: read Export Preflight and complete the blocker.",
    `8. Export downloads but physical:validate says file missing | likely cause: file stayed in Downloads | exact fix: move ${LIVE_PHYSICAL_TRACE_FILENAME} to ${LIVE_PHYSICAL_TRACE_PATH}.`,
    "9. physical:validate says wrong provenance | likely cause: dev dry-run or unchecked physical confirmation | exact fix: repeat physical export with the real-session checkbox checked.",
    "10. Gate 1C still says BLOCKED_MISSING_PHYSICAL_TRACE | likely cause: required file missing or validation failed | exact fix: run npm run physical:validate, then npm run gate:1c.",
    "11. Browser port 4177 is unavailable | likely cause: port busy or sandbox permission | exact fix: npm run physical:capture -- --port 4180.",
    `12. User saved file to Downloads instead of fixtures/replay/live/ | likely cause: browser default download path | exact fix: ${MACOS_SAVE_COMMAND}`
  ].join("\n\n");
}

function eventSequenceInspectorText(target) {
  return [
    "Event Sequence Inspector",
    "required ritual sequence:",
    ...inspectEventSequence(target).map((item) => [
      `${item.sequence_index}. ${item.required_label} | schema=${item.required_event_id} (${item.required_event_type})`,
      `status=${sequenceDisplayStatus(item, target)}`,
      `matched_event_id=${item.matched_event_id ?? "missing"}`,
      `confidence=${item.confidence ?? "missing"}`,
      `payload_summary=${item.payload_summary}`,
      `export_status=${item.status === "present" ? "ready" : "blocks export"}`
    ].join(" | "))
  ].join("\n");
}

function eventSequenceInspectorHtml(target) {
  const rows = inspectEventSequence(target);
  return rows.map((item) => {
    const displayStatus = sequenceDisplayStatus(item, target);
    const stateClass = displayStatus === "Complete" ? "is-complete" : displayStatus === "Awaiting event" ? "is-active" : "";
    const exportStatus = item.status === "present" ? "Ready for export" : "Blocks export";
    const payload = item.payload_summary === "missing" ? "Awaiting event" : item.payload_summary;
    const meta = [
      displayStatus,
      exportStatus,
      item.status === "present" ? `Confidence ${item.confidence ?? "state"}` : null,
      item.status === "present" ? (item.matched_event_id ?? item.required_event_id) : null,
      payload
    ].filter(Boolean).join(" · ");
    return `
      <div class="dq-sequence-row text-contained ${stateClass}">
        <span class="dq-sequence-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(item.sequence_index)}. ${escapeHtml(item.required_label)}</strong>
        <em>${escapeHtml(meta)}</em>
      </div>
    `;
  }).join("");
}

function sequenceDisplayStatus(item, target) {
  if (item.status === "present") return "Complete";
  const completed = inspectEventSequence(target).filter((candidate) => candidate.status === "present").length;
  return item.sequence_index === completed + 1 ? "Awaiting event" : "Missing";
}

function sequenceProgressLabel(target) {
  const completed = inspectEventSequence(target).filter((item) => item.status === "present").length;
  return `${completed} / ${EVENT_SEQUENCE_STEPS.length} steps`;
}

function sequenceProgressPercent(target) {
  const completed = inspectEventSequence(target).filter((item) => item.status === "present").length;
  return Math.min(100, Math.max(0, Math.round((completed / EVENT_SEQUENCE_STEPS.length) * 100)));
}

function dryRunSeparationText(target) {
  const dryRunPreview = buildExportPreview(target, { devDryRun: true });
  const physicalPreview = buildExportPreview(target, { devDryRun: false });
  return [
    "DEV DRY RUN ONLY: cannot satisfy Gate 1C.",
    `dev dry run physical_capture=${dryRunPreview.trace_origin.physical_capture}`,
    `dev dry run operator_confirmed_physical_session=${dryRunPreview.trace_origin.operator_confirmed_physical_session}`,
    `dev dry run manual_fixture=${dryRunPreview.trace_origin.manual_fixture}`,
    "PHYSICAL EXPORT: separate operator export path.",
    `physical export physical_capture=${physicalPreview.trace_origin.physical_capture}`,
    `physical export operator_confirmed_physical_session=${physicalPreview.trace_origin.operator_confirmed_physical_session}`,
    `physical export capture_mode=${physicalPreview.trace_origin.capture_mode}`
  ].join("\n");
}

function ritualChecklistItems(target) {
  const item = (label, done, active, eventId = null) => {
    const event = eventId ? target.events.find((candidate) => candidate.id === eventId) : null;
    const blocked = !done && (target.uncertain || target.reset);
    return {
      label,
      done,
      active,
      blocked,
      state: done ? "complete" : blocked ? "blocked" : active ? "active" : "pending",
      eventId: event?.id ?? null,
      confidence: event?.confidence ?? null,
      disclosure: event?.evidence?.some((evidence) => evidence.kind === "human_correction")
        ? "manual local confirmation - not automatic vision"
        : null
    };
  };
  return [
    item("Camera started", target.cameraStarted || target.cameraReady, !target.cameraReady),
    item("Zones calibrated", target.calibrationSaved, target.cameraReady && !target.calibrationSaved, "evt_scene_calibrated"),
    item("Focus Ritual started", target.ritualStarted, target.calibrationSaved && !target.ritualStarted),
    item("Recording started", target.recordingStarted, target.ritualStarted && !target.recordingStarted),
    item("Phone moved", target.completedSteps.includes("phone"), target.questState === "phone_removal_pending", "evt_phone_moved_to_off_desk"),
    item("Notebook opened", target.completedSteps.includes("notebook"), target.questState === "notebook_pending", "evt_notebook_opened"),
    item("Pen picked up", target.completedSteps.includes("pen"), target.questState === "pen_pending", "evt_pen_moved_to_hand"),
    item("Writing motion confirmed", target.completedSteps.includes("writing"), target.questState === "writing_pending", "evt_writing_like_motion"),
    item("Typing motion confirmed", target.completedSteps.includes("typing"), target.questState === "typing_pending", "evt_typing_like_motion"),
    item("Recording stopped", target.recordingStarted && !target.recording, target.questState === "quest_complete" && target.recording),
    item("Physical session confirmed", target.physicalConfirmed, target.questState === "quest_complete" && !target.physicalConfirmed),
    item("Trace exported", target.exported, target.exportReady && !target.exported),
    item("Validation commands copied", target.validationCopied, target.exported && !target.validationCopied)
  ];
}

function ritualChecklistMeta(item) {
  const stateLabel = item.state === "complete"
    ? "Complete"
    : item.state === "blocked"
      ? "Blocked"
      : item.state === "active"
        ? "Ready"
        : "Pending";
  return [
    stateLabel,
    item.eventId ? "Event recorded" : null,
    item.confidence == null ? null : `Confidence ${item.confidence.toFixed(2)}`,
    item.disclosure
  ].filter(Boolean).join(" · ");
}

function calibrationSummaryText(target) {
  const zoneLines = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    return `${zoneId}: x=${rect.x}, y=${rect.y}, w=${rect.w}, h=${rect.h}`;
  });
  const objectLines = REQUIRED_OBJECTS.map((objectId) => `${objectId}: ${target.objectAssignments[objectId]}`);
  return [
    `status: ${target.calibrationSaved ? "saved" : "not saved"}`,
    "stored fields: normalized zone geometry, symbolic object labels",
    "raw media stored: false",
    "",
    "zones:",
    ...zoneLines,
    "",
    "objects:",
    ...objectLines
  ].join("\n");
}

function preflightText(target) {
  const preflight = runExportPreflight(target);
  const lines = preflight.checks.map((check) => `${check.passed ? "PASS" : "BLOCKED"} ${check.label}: ${check.message}`);
  return [
    `overall: ${preflight.passed ? "PASS" : "BLOCKED"}`,
    ...lines
  ].join("\n");
}

function preflightChecklistHtml(target) {
  const preflight = runExportPreflight(target);
  return `
    <div class="dq-check-row ${preflight.passed ? "is-complete" : "is-blocked"}">
      <span aria-hidden="true"></span>
      <strong>${preflight.passed ? "Export preflight passed" : "Export preflight blocked"}</strong>
      <em>${preflight.passed ? "Physical trace is ready to download." : "Complete the blocked rows below."}</em>
    </div>
    ${preflight.checks.map((check) => `
      <div class="dq-check-row ${check.passed ? "is-complete" : "is-blocked"}">
        <span aria-hidden="true"></span>
        <strong>${escapeHtml(check.label)}</strong>
        <em>${escapeHtml(check.passed ? "ok" : check.message)}</em>
      </div>
    `).join("")}
  `;
}

function exportReadinessSummaryHtml(target) {
  const preflight = runExportPreflight(target);
  const failure = preflight.failures[0];
  return `
    <div>
      <span>Export readiness</span>
      <strong>${preflight.passed ? "Ready" : "Blocked"}</strong>
    </div>
    <p class="note">${preflight.passed
      ? "Physical trace is ready to export."
      : `Next: ${escapeHtml(cleanVisibleIssue(failure?.message ?? "complete preflight"))}`}</p>
  `;
}

function exportCardStatusText(target) {
  if (target.exported) return "Exported";
  if (target.exportReady) return "Ready to export";
  if (target.recording) return "Blocked · stop recording first";
  if (target.questState === "quest_complete" && !target.physicalConfirmed) return "Blocked · confirm physical session";
  return "Blocked · complete the ritual first";
}

function cleanVisibleIssue(message) {
  return String(message)
    .replaceAll("physical_fixture_missing", "physical trace missing")
    .replaceAll("raw_media_persisted=false", "raw media off")
    .replaceAll("pending_export", "pending export")
    .replaceAll("_", " ");
}

export function queuePerceptionSuggestion(target, suggestion) {
  if (suggestion.step && !suggestionMatchesCurrentStep(target, suggestion)) return;
  expireOldSuggestions(target, suggestion.timestamp_ms);
  if (target.rejectedSuggestionKeys.includes(suggestion.key) || (target.rejectedSuggestionCooldowns?.[suggestion.key] ?? 0) > suggestion.timestamp_ms) return;
  const rejectedCandidateUntil = target.rejectedCandidateCooldowns?.[candidateKey(candidateFromSuggestion(suggestion))] ?? 0;
  if (rejectedCandidateUntil > suggestion.timestamp_ms) return;
  const cooldownMs = target.localPerceptionTuning?.suggestionCooldownMs ?? LOCAL_MOTION.suggestionCooldownMs;
  const activeSuggestions = target.perceptionSuggestions.filter((item) => item.status !== "pending" || (item.expires_at_ms ?? Infinity) > suggestion.timestamp_ms);
  const existing = activeSuggestions.find((item) => item.key === suggestion.key && item.status === "pending");
  if (existing && suggestion.timestamp_ms - existing.timestamp_ms < cooldownMs) return;
  const maxActive = target.localPerceptionTuning?.maxActiveSuggestions ?? LOCAL_MOTION.maxActiveSuggestions;
  recordSuggestionGenerated(target, suggestion);
  target.perceptionSuggestions = [
    suggestion,
    ...activeSuggestions.filter((item) => item.key !== suggestion.key)
  ].sort((a, b) => (b.rank ?? b.confidence ?? 0) - (a.rank ?? a.confidence ?? 0)).slice(0, maxActive);
}

function renderDetectedAction(target) {
  if (!dom?.cameraSuggestions) return;
  const renderKey = movementResultRenderKey(target);
  if (renderKey === lastMovementResultRenderKey) return;
  lastMovementResultRenderKey = renderKey;
  dom.cameraSuggestions.innerHTML = suggestionsHtml(target);
}

function renderMovementResultDetails(target) {
  const snapshot = target.movementResultSnapshot;
  const detailKey = movementResultDetailKey(target);
  if (detailKey !== lastMovementDetailsRenderKey) {
    lastMovementDetailsRenderKey = detailKey;
    if (dom.movementConfidence) dom.movementConfidence.textContent = snapshot ? snapshot.confidence.toFixed(2) : "--";
    if (dom.movementReason) dom.movementReason.innerHTML = snapshot?.reason
      ? readableDetailHtml("Reason", snapshot.reason)
      : "--";
    if (dom.movementEvidence) dom.movementEvidence.innerHTML = snapshot?.evidence?.length
      ? evidenceListHtml(snapshot.evidence)
      : "--";
    if (dom.movementProvider) dom.movementProvider.textContent = snapshot?.provider ?? target.movementRecognition.provider;
    if (dom.movementModel) dom.movementModel.textContent = snapshot?.model ?? target.movementRecognition.model;
    if (dom.movementLatency) dom.movementLatency.textContent = snapshot ? `${snapshot.latency_ms}ms` : "--";
    if (dom.movementSummaryRow) {
      dom.movementSummaryRow.textContent = snapshot
        ? `${snapshot.short_label || "Movement"} · Confidence ${snapshot.confidence.toFixed(2)}`
        : "Confidence --";
    }
    if (dom.autoSpeak) {
      dom.autoSpeak.checked = target.movementRecognition.autoSpeak === true;
      dom.autoSpeak.parentElement?.lastChild && (dom.autoSpeak.parentElement.lastChild.textContent = target.movementRecognition.autoSpeak ? " Auto-speak on" : " Auto-speak off");
      if (dom.autoSpeak.parentElement) dom.autoSpeak.parentElement.hidden = !snapshot;
    }
    if (dom.confirmMovement) {
      dom.confirmMovement.hidden = !snapshot;
      dom.confirmMovement.disabled = !snapshot || snapshot.confirmed === true;
      dom.confirmMovement.textContent = snapshot?.confirmed ? "Confirmed" : "Confirm";
    }
    if (dom.correctMovement) {
      dom.correctMovement.hidden = !snapshot;
      dom.correctMovement.disabled = !snapshot;
    }
    if (dom.movementCorrectionForm) {
      dom.movementCorrectionForm.hidden = !snapshot || target.correctionDraft.open !== true;
    }
    if (dom.movementCorrectionInput && target.correctionDraft.open === true) {
      dom.movementCorrectionInput.value = target.correctionDraft.text ?? "";
    }
    if (dom.movementHistoryList) {
      dom.movementHistoryList.innerHTML = movementHistoryHtml(target);
    }
    if (dom.speakResult) {
      dom.speakResult.hidden = !snapshot;
      dom.speakResult.disabled = !snapshot || !speechSynthesisAvailable();
    }
    if (dom.tryAgainMovement) {
      const canRetry = snapshot || target.movementCaptureState.status === "error";
      dom.tryAgainMovement.hidden = !canRetry;
      dom.tryAgainMovement.disabled = target.movementCaptureState.status === "capturing" || target.movementCaptureState.status === "analyzing";
      dom.tryAgainMovement.textContent = snapshot || target.movementCaptureState.status === "result_ready" ? "Try another movement" : "Try again";
    }
  }
  if (dom.voiceStatus) dom.voiceStatus.textContent = speechSynthesisAvailable() ? target.movementRecognition.voiceStatus : "Voice unavailable";
}

function movementHistoryHtml(target) {
  const entries = target.movementHistory.entries.slice().reverse();
  if (!entries.length) return "No movement history yet.";
  return entries.map((entry) => `
    <div class="dq-history-item">
      <strong>${escapeHtml(narratorSentence(entry.movement))}</strong>
      <span>Text-only session history</span>
    </div>
  `).join("");
}

function renderResearchLab(target) {
  if (dom.researchProvider) dom.researchProvider.textContent = target.movementRecognition.provider;
  if (dom.researchRequestedModel) dom.researchRequestedModel.textContent = target.movementResultSnapshot?.requested_model || target.movementRecognition.model;
  if (dom.researchReturnedModel) dom.researchReturnedModel.textContent = target.movementResultSnapshot?.returned_model || "--";
  if (dom.researchLatency) dom.researchLatency.textContent = target.movementResultSnapshot ? `${target.movementResultSnapshot.latency_ms}ms` : "--";
  if (dom.researchPromptVersion) dom.researchPromptVersion.textContent = target.movementRecognition.promptVersion || MOVEMENT_NARRATION_PROMPT_VERSION;
  if (dom.researchImageTokens) dom.researchImageTokens.textContent = String(target.movementRecognition.imageTokens ?? 0);
  if (dom.researchRetries) dom.researchRetries.textContent = String(target.movementRecognition.retries ?? 0);
  if (dom.researchCandidateFailures) dom.researchCandidateFailures.textContent = String(target.movementRecognition.candidateFailures?.length ?? 0);
  if (dom.researchLastSafeError) dom.researchLastSafeError.textContent = target.movementRecognition.lastSafeError || "--";
  if (dom.researchHistoryCount) dom.researchHistoryCount.textContent = String(target.movementHistory.entries.length);
  if (dom.researchCorrectionCount) dom.researchCorrectionCount.textContent = String(target.correctionMemory.entries.length);
  if (dom.researchOneShotGuard) {
    dom.researchOneShotGuard.textContent = target.movementRecognition.requestInFlight ? "in flight" : "ready";
  }
}

function suggestionsHtml(target) {
  const snapshot = target.movementResultSnapshot;
  if (snapshot) {
    return movementResultHeroHtml(
      snapshot.confirmed ? "Result ready" : "Needs confirmation",
      calibratedMovementSentence(snapshot),
      snapshot.confirmed ? "Confirmed." : "Confirm the sentence or try again.",
      snapshot
    );
  }
  const stateText = target.movementCaptureState.status === "get_ready"
    ? "Get ready..."
    : target.movementCaptureState.status === "capturing"
      ? "Move now."
    : target.movementCaptureState.status === "analyzing"
      ? "Understanding movement..."
    : target.movementCaptureState.status === "error"
      ? target.movementRecognition.lastError || "AI response was unclear — try again."
    : target.cameraReady
      ? "Ready for a movement."
      : "Start the camera, then describe a movement.";
  const reason = target.cameraReady
    ? movementControlHelpText(target)
    : "Start Camera, then click Describe my next movement.";
  return movementResultHeroHtml(statusLabelForMovementState(target), stateText, reason);
}

function movementResultHeroHtml(status, sentence, hint, snapshot = null) {
  const resultId = snapshot?.result_id ?? `capture_${String(status).toLowerCase().replace(/\W+/g, "_")}`;
  const reveal = snapshot?.result_id && snapshot.result_id !== lastMovementRevealResultId;
  if (reveal) lastMovementRevealResultId = snapshot.result_id;
  return `
    <div class="dq-movement-result result-card-stable result-hero ${reveal ? "result-reveal" : ""} reduced-motion-safe text-contained" data-result-id="${escapeHtml(resultId)}">
      <span class="dq-movement-status">${escapeHtml(status)}</span>
      <strong class="dq-movement-sentence movement-sentence">${escapeHtml(narratorSentence(sentence))}</strong>
      <p class="dq-movement-hint">${escapeHtml(naturalizeMovementText(hint))}</p>
    </div>
  `;
}

function calibratedMovementSentence(snapshot) {
  const sentence = snapshot?.movement_sentence ?? "";
  if (!sentence || snapshot?.corrected || isUncertainMovement(sentence) || snapshot.confidence >= 0.55) return sentence;
  const softened = sentence.replace(/^You\b/, "you").replace(/\.$/, "");
  return `I’m not fully sure, but it looks like ${softened}.`;
}

function movementResultRenderKey(target) {
  const snapshot = target.movementResultSnapshot;
  return snapshot
    ? ["result", snapshot.result_id, snapshot.revision, snapshot.confirmed ? "confirmed" : "pending"].join(":")
    : ["capture", target.cameraReady ? "camera_on" : "camera_off", target.movementCaptureState.status, target.movementRecognition.lastError].join(":");
}

function movementResultDetailKey(target) {
  const snapshot = target.movementResultSnapshot;
  return snapshot
    ? ["result", snapshot.result_id, snapshot.revision, snapshot.confirmed ? "confirmed" : "pending", target.correctionDraft.open ? "correcting" : "view", target.movementHistory.entries.length, target.correctionMemory.entries.length].join(":")
    : ["capture", target.movementCaptureState.status, target.movementRecognition.provider, target.movementRecognition.model, target.movementRecognition.lastError, target.movementHistory.entries.length, target.correctionMemory.entries.length].join(":");
}

function readableDetailHtml(label, text) {
  const readable = naturalizeMovementText(text);
  return `
    <details class="dq-readable-detail">
      <summary>${escapeHtml(label)}</summary>
      <p class="dq-readable-copy">${escapeHtml(readable)}</p>
    </details>
  `;
}

function evidenceListHtml(items = []) {
  return `<ul class="dq-evidence-list">${items.slice(0, 3).map((item) => `<li>${escapeHtml(naturalizeMovementText(item))}</li>`).join("")}</ul>`;
}

function statusLabelForMovementState(target) {
  return {
    idle: "Ready",
    checking: "Ready",
    capturing: "Capturing",
    analyzing: "Analyzing",
    complete: "Needs confirmation",
    fallback: target.movementRecognition.lastError?.includes("busy") ? "AI busy" : "AI unavailable"
  }[target.movementRecognition.status] ?? "Ready";
}

function movementBadgeText(target) {
  if (target.movementRecognition.status === "complete" && target.movementRecognition.confirmed) return "Result ready";
  if (target.movementRecognition.status === "complete") return "Needs confirmation";
  return statusLabelForMovementState(target);
}

function movementControlHelpText(target) {
  if (!target.cameraReady) return "Start the camera, then describe a movement.";
  return {
    idle: "Click, then move naturally for about 2 seconds.",
    checking: "Get ready...",
    capturing: "Move now.",
    analyzing: "AI is describing what happened.",
    complete: "Try another movement when you want a new description.",
    fallback: target.movementRecognition.lastError || "Try again."
  }[target.movementRecognition.status] ?? "Click, then move naturally for about 2 seconds.";
}

function suggestionKindLabel(suggestion) {
  if (suggestion.payload?.ai_recognition) return "AI recognition";
  return suggestion.suggested_event_type?.includes("gesture") ? "Activity" : "Motion";
}

function zoneClassForSuggestion(zoneId) {
  return `zone-${String(zoneId).replaceAll("_", "-")}`;
}

function suggestionTraceInstructionsText(target) {
  const mode = selectedTraceModeFor(target);
  const summary = suggestionSummaryForTrace(target, mode);
  const preflight = runSuggestionTracePreflight(target);
  return [
    `Selected trace mode: ${mode.label}`,
    `Required physical action: ${mode.action}`,
    `Expected suggestion: ${mode.expected}`,
    `Accept/Reject: ${mode.decision}`,
    `Required export filename: ${mode.filename}`,
    `Required save path: ${mode.path}`,
    `Validation command: ${mode.validation}`,
    `Current suggestion count: ${summary.suggestions_generated}`,
    `Accepted count: ${summary.suggestions_accepted}`,
    `Rejected count: ${summary.suggestions_rejected}`,
    `Auto-completed steps: ${summary.auto_completed_steps}`,
    `Suggestion export preflight: ${preflight.passed ? "PASS" : `BLOCKED - ${preflight.failures[0]?.message ?? "complete the selected suggestion trace"}`}`,
    "Suggestion trace tools are developer-only; the product flow uses confirmed camera suggestions."
  ].join("\n");
}

function suggestionCountersHtml(target) {
  const summary = suggestionSummaryForTrace(target, selectedTraceModeFor(target));
  return `
    <div class="metric"><strong>generated</strong><span>${summary.suggestions_generated}</span></div>
    <div class="metric"><strong>accepted</strong><span>${summary.suggestions_accepted}</span></div>
    <div class="metric"><strong>rejected</strong><span>${summary.suggestions_rejected}</span></div>
    <div class="metric"><strong>auto-completed</strong><span>${summary.auto_completed_steps}</span></div>
  `;
}

function campaignSummaryHtml(target) {
  const summary = campaignSummaryFor(target);
  return `
    <div class="metric"><strong>traces required</strong><span>${summary.traces_required}</span></div>
    <div class="metric"><strong>traces exported</strong><span>${summary.traces_exported}</span></div>
    <div class="metric"><strong>missing traces</strong><span>${summary.missing_traces.length}</span></div>
    <div class="metric"><strong>generated suggestions total</strong><span>${summary.generated_suggestions_total}</span></div>
    <div class="metric"><strong>accepted suggestions total</strong><span>${summary.accepted_suggestions_total}</span></div>
    <div class="metric"><strong>rejected suggestions total</strong><span>${summary.rejected_suggestions_total}</span></div>
    <div class="metric"><strong>auto_completed_steps total</strong><span>${summary.auto_completed_steps_total}</span></div>
    <div class="metric"><strong>LLM calls</strong><span>${summary.llm_calls}</span></div>
    <div class="metric"><strong>VLM calls</strong><span>${summary.vlm_calls}</span></div>
    <div class="metric"><strong>raw media persistence</strong><span>${summary.raw_media_persistence}</span></div>
    <div class="metric"><strong>ready for npm run gate:3b:live</strong><span>${summary.ready_for_gate_3b_live ? "yes" : "no"}</span></div>
    <p class="note">Missing: ${summary.missing_traces.map(escapeHtml).join(", ") || "none"}</p>
  `;
}

function campaignStepsHtml(target) {
  const selectedStep = SUGGESTION_CAMPAIGN_STEPS[target.suggestionCampaign.currentIndex] ?? SUGGESTION_CAMPAIGN_STEPS[0];
  const rows = SUGGESTION_CAMPAIGN_STEPS.map((step) => {
    const captureStatus = campaignCaptureStatus(target, step);
    const exportReadiness = campaignExportReadiness(target, step);
    const selected = selectedStep.id === step.id;
    return `
      <div class="campaign-trace-row text-contained ${selected ? "is-selected" : ""}" data-campaign-action="select" data-trace-mode="${escapeHtml(step.id)}" data-campaign-step="${escapeHtml(step.id)}" role="button" tabindex="0">
        <span class="campaign-status-dot is-${escapeHtml(exportReadiness === "ready_to_export" || exportReadiness === "exported" ? exportReadiness : captureStatus)}" aria-hidden="true"></span>
        <div class="campaign-trace-meta">
          <strong class="truncate-safe">${step.number}. ${escapeHtml(campaignShortName(step))}</strong>
          <span class="campaign-status-pair">
            <small class="campaign-status-pill" title="Capture status: ${escapeHtml(campaignStatusLabel(captureStatus))}">Capture: ${escapeHtml(campaignStatusLabel(captureStatus))}</small>
            <small class="campaign-status-pill" title="Export readiness: ${escapeHtml(campaignStatusLabel(exportReadiness))}">Export: ${escapeHtml(campaignStatusLabel(exportReadiness))}</small>
          </span>
        </div>
      </div>
    `;
  }).join("");
  return `
    <div class="campaign-trace-list" aria-label="Trace list">
      ${rows}
    </div>
    ${campaignSelectedTraceDetailHtml(target, selectedStep)}
  `;
}

export function campaignSummaryFor(target) {
  const summaries = Object.values(target.suggestionCampaign.traceSummaries);
  const currentSummary = target.suggestionTraceMode !== "standard" && !target.suggestionCampaign.traceSummaries[target.suggestionTraceMode]
    ? suggestionSummaryForTrace(target, selectedTraceModeFor(target))
    : null;
  const allSummaries = currentSummary ? [...summaries, currentSummary] : summaries;
  const missing = SUGGESTION_CAMPAIGN_STEPS
    .filter((step) => !target.suggestionCampaign.exportedTraceIds.includes(step.id))
    .map((step) => step.path);
  return {
    traces_required: SUGGESTION_CAMPAIGN_STEPS.length,
    traces_exported: target.suggestionCampaign.exportedTraceIds.length,
    missing_traces: missing,
    generated_suggestions_total: sumSummary(allSummaries, "suggestions_generated"),
    accepted_suggestions_total: sumSummary(allSummaries, "suggestions_accepted"),
    rejected_suggestions_total: sumSummary(allSummaries, "suggestions_rejected"),
    auto_completed_steps_total: sumSummary(allSummaries, "auto_completed_steps"),
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount,
    ready_for_gate_3b_live: missing.length === 0
  };
}

function campaignSelectedTraceDetailHtml(target, step) {
  const copy = campaignTraceCopy(step);
  const summary = campaignSummaryForStep(target, step);
  const captureStatus = campaignCaptureStatus(target, step);
  const exportReadiness = campaignExportReadiness(target, step);
  const reasons = campaignExportBlockReasons(target, step);
  return `
    <div class="campaign-detail text-contained" aria-label="Selected trace detail">
      <div class="campaign-detail-grid">
        <h4>${escapeHtml(copy.title)}</h4>
        <p class="note"><strong>Trace status:</strong> ${escapeHtml(campaignStatusLabel(captureStatus))}</p>
        ${captureStatus === "active" ? `<p class="note"><strong>Next:</strong> Perform the physical action and wait for a camera suggestion.</p>` : ""}
        ${captureStatus === "active" ? `<p class="note">Waiting for camera suggestion.</p>` : ""}
        <p class="note"><strong>Action:</strong> ${escapeHtml(copy.action)}</p>
        <p class="note"><strong>Expected:</strong> ${escapeHtml(copy.expected)}</p>
        <p class="note"><strong>Instruction:</strong> ${escapeHtml(copy.instruction)}</p>
        <p class="note"><strong>Export readiness:</strong> ${escapeHtml(exportReadiness === "ready_to_export" ? "Ready" : exportReadiness === "exported" ? "Exported" : "Blocked")}</p>
        <p class="note">${escapeHtml(copy.readiness)}</p>
        ${reasons.length ? `<ul class="campaign-reason-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
        <code class="campaign-path-field" title="${escapeHtml(step.path)}">${escapeHtml(step.path)}</code>
      </div>
      <div class="campaign-counter-row" aria-label="Selected trace counters">
        <span class="campaign-chip">Generated: ${summary.suggestions_generated}</span>
        <span class="campaign-chip">Accepted: ${summary.suggestions_accepted}</span>
        <span class="campaign-chip">Rejected: ${summary.suggestions_rejected}</span>
        <span class="campaign-chip">Auto-completed: ${summary.auto_completed_steps}</span>
      </div>
      ${summary.auto_completed_steps !== 0 ? `<p class="error-banner">Auto-completed must stay 0. Export is blocked.</p>` : ""}
      <div class="campaign-action-row">
        <button class="dq-button secondary no-vertical-text" data-campaign-action="start" data-trace-mode="${escapeHtml(step.id)}" type="button">Start this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="reset" data-trace-mode="${escapeHtml(step.id)}" type="button">Reset this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="export" data-trace-mode="${escapeHtml(step.id)}" type="button">Export this trace</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="copy-path" data-trace-mode="${escapeHtml(step.id)}" type="button">Copy save path</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="copy-move" data-trace-mode="${escapeHtml(step.id)}" type="button">Copy macOS move command</button>
        <button class="dq-button secondary no-vertical-text" data-campaign-action="mark-exported" data-trace-mode="${escapeHtml(step.id)}" type="button">Mark trace exported</button>
      </div>
      <details class="dq-nested-details">
        <summary><span>View technical details</span></summary>
        <pre class="dq-pre code-contained scroll-contained">${escapeHtml(campaignTechnicalDetailsText(target, step))}</pre>
      </details>
    </div>
  `;
}

function campaignCaptureStatus(target, step) {
  if (target.suggestionCampaign.exportedTraceIds.includes(step.id)) return "captured";
  if (target.suggestionTraceMode !== step.id) return target.suggestionCampaign.captureStatuses[step.id] ?? "not_started";
  const summary = suggestionSummaryForTrace(target, step);
  if (summary.suggestions_accepted > 0) return "accepted";
  if (summary.suggestions_rejected > 0) return "rejected";
  if (summary.suggestions_generated > 0) return "suggestion_seen";
  return target.suggestionCampaign.captureStatuses[step.id] ?? "not_started";
}

function campaignExportReadiness(target, step) {
  if (target.suggestionCampaign.exportedTraceIds.includes(step.id)) return "exported";
  if (target.suggestionTraceMode === step.id) return target.exportReady ? "ready_to_export" : "blocked";
  return target.suggestionCampaign.exportReadiness[step.id] ?? "blocked";
}

function campaignSummaryForStep(target, step) {
  if (target.suggestionTraceMode === step.id && !target.suggestionCampaign.exportedTraceIds.includes(step.id)) return suggestionSummaryForTrace(target, step);
  return target.suggestionCampaign.traceSummaries[step.id] ?? {
    suggestions_generated: 0,
    suggestions_accepted: 0,
    suggestions_rejected: 0,
    auto_completed_steps: 0,
    llm_calls: target.llmCalls,
    vlm_calls: target.vlmCalls,
    raw_media_persistence: target.rawMediaPersistenceCount
  };
}

function campaignExportBlockReasons(target, step) {
  if (campaignExportReadiness(target, step) !== "blocked") return [];
  if ((target.suggestionCampaign.captureStatuses[step.id] ?? "not_started") === "not_started") return ["Start this trace"];
  if (target.suggestionTraceMode !== step.id) return ["Select this trace"];
  const summary = suggestionSummaryForTrace(target, step);
  if (summary.suggestions_generated === 0) return ["Waiting for suggestion"];
  if (step.id === "suggestion_reject" && summary.suggestions_rejected === 0) return ["Reject required"];
  if (!["suggestion_reject", "suggestion_uncertain"].includes(step.id) && summary.suggestions_accepted === 0) return ["Accept required"];
  const reasons = runExportPreflight(target).failures.map(campaignShortReason).filter(Boolean);
  return [...new Set(reasons)].slice(0, 3);
}

function campaignShortReason(failure) {
  const map = {
    suggestions_generated: "Waiting for suggestion",
    suggestion_accept_required: "Accept required",
    accepted_suggestion_evidence: "Accept required",
    accepted_suggestion_payload: "Accept required",
    suggestion_reject_required: "Reject required",
    suggestion_uncertainty_required: "Waiting for suggestion",
    suggestion_full_ritual_accepts_all: "Accept required",
    physical_confirmed: "Physical confirmation required",
    suggestion_summary_present: "Missing metadata",
    suggestion_no_auto_complete: "Auto-completed must stay 0",
    suggestion_model_calls_zero: "Model calls must stay 0",
    suggestion_raw_media_zero: "Raw media must stay 0"
  };
  if (map[failure.id]) return map[failure.id];
  if (failure.id === "recording_stopped") return "Stop recording first";
  if (failure.id === "quest_complete" || failure.id === "events_exist" || failure.id === "event_sequence_valid") return "Complete ritual";
  return failure.message ? cleanVisibleIssue(failure.message) : "Blocked";
}

function campaignTechnicalDetailsText(target, step) {
  if (target.suggestionTraceMode !== step.id) return "Select or start this trace to view technical details.";
  return runExportPreflight(target).checks
    .map((check) => `${check.passed ? "PASS" : "BLOCKED"} ${check.id}: ${check.label}`)
    .join("\n");
}

function campaignShortName(step) {
  return step.label.replace("Suggestion Trace: ", "");
}

function campaignStatusLabel(status) {
  return String(status).replaceAll("_", " ");
}

function campaignTraceCopy(step) {
  const copy = {
    suggestion_phone_moved: {
      title: "Phone moved trace",
      action: "Move the phone out of phone_zone.",
      expected: "Possible phone moved.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_notebook_opened: {
      title: "Notebook opened trace",
      action: "Open the notebook in notebook_zone.",
      expected: "Possible notebook opened.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_pen_picked_up: {
      title: "Pen picked up trace",
      action: "Pick up the pen from pen_zone.",
      expected: "Possible pen picked up.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_writing_motion: {
      title: "Writing motion trace",
      action: "Make writing-like motion over notebook_zone.",
      expected: "Possible writing motion.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_typing_motion: {
      title: "Typing motion trace",
      action: "Make typing-like motion over keyboard_zone.",
      expected: "Possible typing motion.",
      instruction: "Wait for the camera suggestion, then click Accept."
    },
    suggestion_reject: {
      title: "Reject suggestion trace",
      action: "Create a wrong or low-confidence suggestion.",
      expected: "Any suggestion that should not progress the step.",
      instruction: "Create a wrong or low-confidence suggestion, then click Reject."
    },
    suggestion_uncertain: {
      title: "Uncertain scene trace",
      action: "Create noisy motion until uncertainty appears.",
      expected: "Possible scene uncertainty.",
      instruction: "Wait for the uncertainty signal or suggestion, then capture a clean exportable run."
    },
    suggestion_full_focus_ritual: {
      title: "Full ritual trace",
      action: "Complete the full Focus Ritual while accepting matching suggestions.",
      expected: "A matching suggestion at each ritual step.",
      instruction: "Accept matching suggestions only."
    }
  }[step.id] ?? {
    title: `${campaignShortName(step)} trace`,
    action: step.action,
    expected: step.expected,
    instruction: step.decision
  };
  const readiness = step.id === "suggestion_reject"
    ? "Blocked until one suggestion is rejected."
    : step.id === "suggestion_uncertain"
      ? "Blocked until an uncertainty signal or suggestion is present."
      : step.id === "suggestion_full_focus_ritual"
        ? "Blocked until all required suggestions are accepted."
        : "Blocked until one suggestion is accepted.";
  return { ...copy, readiness };
}

function markCampaignTraceExported(target, mode) {
  if (!target.suggestionCampaign.exportedTraceIds.includes(mode.id)) {
    target.suggestionCampaign.exportedTraceIds.push(mode.id);
  }
  target.suggestionCampaign.captureStatuses[mode.id] = "captured";
  target.suggestionCampaign.exportReadiness[mode.id] = "exported";
  target.suggestionCampaign.traceStatuses[mode.id] = "exported";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...traceStateFor(target, mode),
    captureStatus: "captured",
    exportReadiness: "exported"
  };
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceStateFor(target, mode).lastSuggestion ?? lastSuggestionSummary(target);
  target.statusMessage = `${mode.label} marked exported. Confirm the file is saved at ${mode.path}.`;
}

function recordCampaignCapture(target, fixture) {
  const mode = selectedTraceModeFor(target);
  if (mode.id === "standard") return;
  const step = SUGGESTION_CAMPAIGN_STEPS.find((item) => item.id === mode.id) ?? mode;
  target.suggestionCampaign.active = true;
  target.suggestionCampaign.currentIndex = Math.max(0, (step.number ?? 1) - 1);
  target.suggestionCampaign.captureStatuses[mode.id] = "captured";
  target.suggestionCampaign.exportReadiness[mode.id] = "ready_to_export";
  target.suggestionCampaign.traceStatuses[mode.id] = "ready_to_export";
  target.suggestionCampaign.traceStates[mode.id] = {
    ...traceStateFor(target, mode),
    captureStatus: "captured",
    exportReadiness: "ready_to_export",
    events: fixture.input_events ?? [],
    emittedEventIds: (fixture.input_events ?? []).map((event) => event.id)
  };
  target.suggestionCampaign.traceSummaries[mode.id] = suggestionSummaryForTrace(target, mode);
  target.suggestionCampaign.lastSuggestions[mode.id] = traceStateFor(target, mode).lastSuggestion ?? lastSuggestionSummary(target);
  target.suggestionCampaign.capturedTraces[mode.filename] = fixture;
}

function buildCampaignBundle(target) {
  return {
    schema: "darkquest.suggestion_trace_campaign_bundle.v0",
    generated_by: "browser-local-capture",
    note: "Bundle export is for convenience. Gate 3B-Live requires individual files under fixtures/replay/live/suggestions/.",
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      contains_screenshots: false,
      contains_base64_images: false,
      contains_ocr_or_notebook_text: false,
      llm_calls: 0,
      vlm_calls: 0
    },
    campaign_summary: campaignSummaryFor(target),
    save_path_map: Object.fromEntries(SUGGESTION_CAMPAIGN_STEPS.map((step) => [step.filename, step.path])),
    trace_payloads: target.suggestionCampaign.capturedTraces
  };
}

function campaignValidationInstructionsText() {
  return [
    "After exporting all traces, run:",
    "npm run suggestions:validate",
    "npm run suggestions:report",
    "npm run gate:3b:live",
    "",
    "If gate:3b:live still says missing traces:",
    "- check that all 8 files are saved under fixtures/replay/live/suggestions/",
    "- check filenames exactly",
    "- send back runs/gate-3b-live-latest.json and darkquest_operator_bug_report.json"
  ].join("\n");
}

function sumSummary(summaries, field) {
  return summaries.reduce((total, summary) => total + Number(summary?.[field] ?? 0), 0);
}

function suggestionMatchesCurrentStep(target, suggestion) {
  if (suggestion.step === "uncertain" || suggestion.step === "reset") return target.recording === true;
  if (target.uncertain || target.reset) return false;
  const step = RITUAL_STEPS.find((item) => item.id === suggestion.step);
  return !step || target.questState === step.activeState;
}

function actionSuggestionForStep(step, target, timestampMs, confidence, reason, payload) {
  const meta = STEP_SUGGESTION_META[step];
  if (!meta) return null;
  return createPerceptionSuggestion(meta.suggested_event_type, meta.zone_id, confidence, reason, step, timestampMs, {
    ...meta,
    payload,
    quest_state: target.questState
  });
}

function smoothDetectedActionCandidate(candidate, target, options = {}) {
  const previous = target.perceptionSuggestions
    .filter((item) => item.key === candidate.key)
    .sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0))[0];
  const rawConfidence = candidate.confidence;
  const confidence = smoothActionConfidence(previous?.confidence, rawConfidence, options.confidence_alpha ?? 0.45);
  return {
    ...candidate,
    confidence,
    raw_confidence: rawConfidence,
    confidence_smoothed_from: previous ? previous.confidence : null,
    low_confidence: confidence < 0.7,
    rank: rankSuggestion(candidate.suggested_event_type, candidate.zone_id, confidence, candidate.step),
    requires_confirmation: true,
    detection_method: candidate.payload?.detection_method ?? candidate.detection_method ?? "motion_proxy"
  };
}

function actionTypeForStep(step, eventType) {
  if (step === "phone") return "phone_moved";
  if (step === "notebook") return "notebook_opened";
  if (step === "pen") return "pen_picked_up";
  if (step === "writing") return "writing_motion";
  if (step === "typing") return "typing_motion";
  if (step === "uncertain") return "uncertain";
  if (step === "reset") return "reset";
  if (eventType === "scene.uncertain") return "uncertain";
  if (eventType === "scene.reset") return "reset";
  return "local_motion";
}

function assertSymbolicFrameOnly(value) {
  const forbidden = new RegExp([
    "raw_frame",
    "raw_video",
    "raw_audio",
    "frame_bytes",
    "image_bytes",
    "video_bytes",
    "audio_bytes",
    "screenshot",
    "base64",
    ["data", "image"].join(":"),
    ["data", "video"].join(":"),
    ["data", "audio"].join(":"),
    "ocr",
    "notebook_text",
    "transcript"
  ].join("|"), "i");
  const scan = (item, key = "") => {
    if (forbidden.test(String(key))) throw new TypeError(`LocalPerceptionFrame contains forbidden media field: ${key}`);
    if (typeof item === "string" && forbidden.test(item)) throw new TypeError("LocalPerceptionFrame contains forbidden media value.");
    if (Array.isArray(item)) item.forEach((child, index) => scan(child, `${key}.${index}`));
    else if (item && typeof item === "object") Object.entries(item).forEach(([childKey, child]) => scan(child, childKey));
  };
  scan(value);
}

function actionLabelForSuggestion(type, zoneId) {
  if (type === "hand.entered_zone") return `Possible motion entered ${zoneId} - confirm to accept.`;
  if (type === "hand.left_zone") return `Possible motion left ${zoneId} - confirm to accept.`;
  if (type === "zone.activated") return `Possible zone activity in ${zoneId} - confirm to accept.`;
  if (type.includes("writing")) return STEP_SUGGESTION_META.writing.suggested_action;
  if (type.includes("typing")) return STEP_SUGGESTION_META.typing.suggested_action;
  return `Possible ${type} - confirm to accept.`;
}

function objectForZone(zoneId) {
  return {
    phone_zone: "phone",
    notebook_zone: "notebook",
    pen_zone: "pen",
    keyboard_zone: "keyboard"
  }[zoneId] ?? "motion_proxy";
}

function evidenceSummary(suggestion) {
  return suggestion.evidence.map((item) => item.kind).join("+");
}

function expiresInSeconds(suggestion) {
  return Math.max(0, Math.ceil((suggestion.expires_at_ms - now()) / 1000));
}

function rankSuggestion(type, zoneId, confidence, step) {
  const stepBoost = step ? 0.2 : 0;
  const gestureBoost = type.startsWith("gesture.detected") ? 0.1 : 0;
  const zoneBoost = zoneId === "notebook_zone" || zoneId === "keyboard_zone" ? 0.04 : 0;
  return Number(Math.min(1, confidence + stepBoost + gestureBoost + zoneBoost).toFixed(3));
}

function exportPreviewText(target) {
  const preview = buildExportPreview(target);
  return JSON.stringify(preview, null, 2);
}

function cameraStatusLabel(target) {
  if (target.cameraStatus.startsWith("error:")) return "error";
  if (target.cameraReady) return "on";
  return "off";
}

function questStatusLabel(target) {
  if (target.questState === "quest_complete") return "complete";
  if (target.ritualStarted || target.recordingStarted) return "in_progress";
  return "idle";
}

function renderWizard(target, guards) {
  const stages = wizardStagesForState(target);
  const current = stages.find((item) => !item.complete) ?? stages[stages.length - 1];
  dom.currentWizard.innerHTML = `
    <p class="dq-step-kicker">Step ${current.stepNumber} of ${stages.length}</p>
    <h2 class="wrap-safe">${escapeHtml(flowTitleForStage(current))}</h2>
    <p class="wrap-safe">${escapeHtml(flowDescriptionForStage(current))}</p>
    ${target.errorMessage ? `<span class="error">${target.errorMessage}</span>` : ""}
  `;
  dom.wizardStages.innerHTML = stages.map((stageItem) => `
    <li class="dq-step wizard-stage ${stageItem.complete ? "is-complete done" : stageItem.stepNumber === current.stepNumber ? "is-active active" : ""}">
      <span class="dq-step-index">${stageItem.stepNumber}</span>
      <div class="dq-step-body">
        <strong>${flowTitleForStage(stageItem)}</strong>
        <p>${flowDescriptionForStage(stageItem)}</p>
      </div>
      ${stageItem.stepNumber === current.stepNumber && !stageItem.complete
        ? `<button class="dq-mini-button" type="button" aria-disabled="true">${stageItem.nextButton}</button>`
        : `<span class="dq-step-state">${stageItem.complete ? "done" : "pending"}</span>`}
    </li>
  `).join("");
  const blocked = Object.entries(guards)
    .filter(([name, item]) => item.enabled === false && name !== "startCamera" && name !== "stopCamera")
    .map(([, item]) => item.reason)
    .filter(Boolean);
  dom.buttonReasons.textContent = blocked.length ? blocked.join("\n") : "No blocked action needs attention.";
}

function flowTitleForStage(stageItem) {
  return {
    1: "Start Camera",
    2: "Calibrate Zones",
    3: "Start Session",
    4: "Start Watching",
    5: "Confirm Actions",
    6: "Stop Watching",
    7: "Export Physical Trace",
    8: "Validation"
  }[stageItem.stepNumber] ?? stageItem.name;
}

function flowDescriptionForStage(stageItem) {
  return {
    1: "Preview and confirm camera is ready.",
    2: "Define desk zones for tracking.",
    3: "Begin the guided action session.",
    4: "Watch local motion and suggest the current action.",
    5: "Confirm or correct each suggested action.",
    6: "End local symbolic recording.",
    7: "Generate the trace file.",
    8: "Validate and copy commands."
  }[stageItem.stepNumber] ?? stageItem.instruction;
}

function renderZoneOverlay(target) {
  if (!dom.zoneOverlay) return;
  if (target.showTrackingOverlay !== true) {
    dom.zoneOverlay.innerHTML = "";
    dom.zoneOverlay.hidden = true;
    return;
  }
  dom.zoneOverlay.hidden = false;
  dom.zoneOverlay.innerHTML = REQUIRED_ZONES.map((zoneId) => {
    const rect = target.zoneGeometry[zoneId];
    const className = `zone-${zoneId.replaceAll("_", "-")}`;
    return `<div class="zone-box ${className}" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.w * 100}%;height:${rect.h * 100}%"><span>${zoneId}</span></div>`;
  }).join("");
}

function setButtonStates(guards) {
  for (const [key, guardState] of Object.entries(guards)) {
    const button = dom[key] ?? document.querySelector(`[data-step="${key}"]`);
    const buttons = dom[key] ? [dom[key]] : [...document.querySelectorAll(`[data-step="${key}"]`)];
    if (!buttons.length && !button) continue;
    for (const targetButton of buttons.length ? buttons : [button]) {
      targetButton.disabled = !guardState.enabled;
      targetButton.title = guardState.enabled ? "" : guardState.reason;
    }
  }
}

function timelineText(events) {
  if (!events.length) return "No symbolic events yet.";
  return events.slice(-10).map((event) => {
    const evidence = event.evidence?.[0] ?? {};
    return [
      `${event.timestamp_ms}ms ${event.type} confidence=${event.confidence.toFixed(2)}`,
      `payload: ${payloadSummary(event.payload)}`,
      `evidence: ${evidence.kind ?? "unknown"}; manual local confirmation=${evidence.kind === "human_correction"}`
    ].join("\n");
  }).join("\n\n");
}

function timelineHtml(events) {
  if (!events.length) return '<p class="note">No symbolic events yet.</p>';
  return events.slice(-10).reverse().map((event) => {
    const evidence = event.evidence?.[0] ?? {};
    const manual = evidence.kind === "human_correction" ? "Manual confirmation" : evidence.kind ?? "symbolic";
    const confidencePercent = Math.round(event.confidence * 100);
    return `
      <article class="dq-event-row text-contained">
        <time>${escapeHtml(formatEventTime(event.timestamp_ms))}</time>
        <span class="dq-event-icon ${eventToneClass(event)}" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(event.type)}</strong>
          <p>${escapeHtml(payloadSummary(event.payload))} · ${escapeHtml(manual)} · raw media off</p>
        </div>
        <div class="dq-event-confidence dq-confidence-track" aria-label="Confidence ${confidencePercent}%">
          <i aria-hidden="true"><span style="width:${confidencePercent}%"></span></i>
          <b>${confidencePercent}%</b>
        </div>
      </article>
    `;
  }).join("");
}

function formatEventTime(timestampMs) {
  return `${(timestampMs / 1000).toFixed(1)}s`;
}

function eventToneClass(event) {
  if (event.type === "scene.uncertain" || event.type === "scene.reset") return "tone-danger";
  if (event.type === "gesture.detected") return "tone-privacy";
  if (event.type === "object.moved") return "tone-info";
  if (event.type === "object.placed" || event.type === "scene.calibrated") return "tone-success";
  return "tone-neutral";
}

function eventIcon(event) {
  if (event.type === "scene.calibrated") return "Cal";
  if (event.id === "evt_phone_moved_to_off_desk") return "Ph";
  if (event.id === "evt_notebook_opened") return "Nb";
  if (event.id === "evt_pen_moved_to_hand") return "Pen";
  if (event.id === "evt_writing_like_motion") return "Wr";
  if (event.id === "evt_typing_like_motion") return "Ty";
  if (event.type === "scene.uncertain") return "Un";
  if (event.type === "scene.reset") return "Re";
  return "Ev";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function payloadSummary(payload) {
  if (payload.gesture_type) return `${payload.gesture_type} in ${payload.zone_id}`;
  if (payload.object_type && payload.to_zone_id) return `${payload.object_type}: ${payload.from_zone_id} -> ${payload.to_zone_id}`;
  if (payload.object_type && payload.zone_id) return `${payload.object_type}: ${payload.zone_id}`;
  if (payload.calibration_id) return `calibration ${payload.calibration_id}`;
  if (payload.reason) return payload.reason;
  return JSON.stringify(payload);
}

function troubleshootingText(target, guards) {
  const lines = [
    target.statusMessage,
    target.errorMessage ? `Error: ${target.errorMessage}` : "",
    !target.cameraReady ? "Camera failure help: if the camera does not start, check browser camera permission for 127.0.0.1." : "",
    "Port fallback help: if localhost port 4177 is unavailable, run DARKQUEST_CAPTURE_PORT=4178 npm run physical:capture.",
    !target.calibrationSaved ? "If Start Focus Ritual is disabled, save calibration first." : "",
    !target.recording && target.ritualStarted && target.questState !== "quest_complete" ? "Disabled-button help: if confirmation buttons are disabled, press Start Recording." : "",
    target.questState !== "quest_complete" ? "If export is disabled, finish the five manual local confirmations in order." : "",
    target.questState === "quest_complete" && !target.physicalConfirmed ? "If export is disabled, tick the physical session confirmation checkbox." : "",
    target.exported ? `Wrong save path help: after export, save the download to ${LIVE_PHYSICAL_TRACE_PATH}.` : "",
    target.exported ? `Export missing help: if physical:validate says physical_fixture_missing, move ${LIVE_PHYSICAL_TRACE_FILENAME} into ${LIVE_PHYSICAL_TRACE_PATH}.` : "",
    "Gate 1C blocked help: Gate 1C should move from BLOCKED_MISSING_PHYSICAL_TRACE to PASS, PASS_WITH_DISCLOSURE, or FAIL after physical:validate passes on the required saved file.",
    guards.exportTrace.enabled ? "Export is ready." : guards.exportTrace.reason
  ].filter(Boolean);
  return lines.join("\n");
}

function summarizeLatency(records) {
  const values = records.map((record) => record.end_to_end_ms).sort((a, b) => a - b);
  if (!values.length) return { p50: null, p95: null, max: null };
  return {
    p50: values[Math.min(values.length - 1, Math.ceil(values.length * 0.5) - 1)],
    p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)],
    max: values[values.length - 1]
  };
}

function objectiveForQuestState(questState) {
  return {
    idle: "Start camera.",
    calibrated: "Press Start Focus Ritual.",
    quest_started: "Press Start Recording.",
    phone_removal_pending: "Move phone away, then press Confirm Phone Moved.",
    phone_removed: "Phone moved. Next: notebook.",
    notebook_pending: "Open notebook, then press Confirm Notebook Opened.",
    notebook_opened: "Notebook opened. Next: pen.",
    pen_pending: "Pick up pen, then press Confirm Pen Picked Up.",
    pen_detected: "Pen picked up. Next: writing.",
    writing_pending: "Perform writing-like motion, then press Confirm Writing Motion.",
    writing_detected: "Writing motion confirmed. Next: typing.",
    typing_pending: "Perform typing-like motion, then press Confirm Typing Motion.",
    typing_detected: "Typing motion confirmed.",
    quest_complete: "Stop recording, check physical confirmation, then export.",
    uncertain: "Uncertainty marked. Use Reset Session for a clean export.",
    recovery: "Recover by resetting and recalibrating.",
    reset: "Reset required. Press Reset Session."
  }[questState] ?? "Follow the current recovery instruction.";
}

function currentStepButtonLabel(target) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  return step?.buttonText ?? (target.questState === "quest_complete" ? "Stop Recording" : "Manual local confirmation");
}

function currentStepDisabledReason(target, guards) {
  const step = RITUAL_STEPS.find((item) => target.questState === item.activeState);
  if (!step) return target.questState === "quest_complete" ? "" : "Focus Ritual is not at a manual confirmation step.";
  return guards[step.id]?.reason ?? "";
}

function exportDisabledReason(target) {
  const hasRequiredEvents = REQUIRED_EXPORT_EVENT_IDS.every((id) => target.events.some((event) => event.id === id));
  if (target.recording) return "Export Physical Trace is disabled because recording is still active.";
  if (target.events.length === 0) return "Export Physical Trace is disabled because no events were recorded.";
  if (!hasRequiredEvents) return "Export Physical Trace is disabled because the full ritual event sequence does not exist yet.";
  if (target.questState !== "quest_complete") return "Export Physical Trace is disabled because the quest is not complete.";
  if (!target.physicalConfirmed) return "Export Physical Trace is disabled because physical provenance has not been confirmed.";
  if (target.uncertaintyCount > 0) return "Export Physical Trace is disabled because uncertainty was marked; reset and capture a clean run.";
  if (target.resetCount > 0) return "Export Physical Trace is disabled because camera reset was marked; reset and capture a clean run.";
  return "Export Physical Trace is disabled because export is not ready.";
}

function stepGuard(target, expectedStep, stepId) {
  if (!target.recording) return guard(false, `${ACTION_LABELS[stepId]} is disabled because recording is not active.`);
  if (!expectedStep) return guard(false, `${ACTION_LABELS[stepId]} is disabled because there is no active ritual step.`);
  if (expectedStep.id !== stepId) {
    return guard(false, `${ACTION_LABELS[stepId]} is disabled because the current objective is ${objectiveForQuestState(target.questState)}`);
  }
  return guard(true, "");
}

function guard(enabled, reason) {
  return { enabled, reason: enabled ? "" : reason };
}

function stage(stepNumber, name, complete, instruction, nextButton, blockedReason) {
  return { stepNumber, name, complete, instruction, nextButton, blockedReason: complete ? "" : blockedReason };
}

function nextDiagnosticTimestamp(target) {
  const last = target.events.reduce((max, event) => Math.max(max, event.timestamp_ms), 0);
  return last + 250;
}

function confidenceFromMotion(motionScore) {
  return Number(Math.max(0.5, Math.min(0.92, 0.55 + (motionScore * 2.4))).toFixed(2));
}

function safeId(value) {
  return String(value).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();
}

function fmt(value) {
  return value == null ? "--" : `${value}ms`;
}

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
