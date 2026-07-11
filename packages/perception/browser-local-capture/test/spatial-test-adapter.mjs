const BASE = Object.freeze({
  ok: true,
  source: "local_spatial",
  scale: { type: "relative", unit: null, confidence: 0.88 },
  objects: [],
  hands: [],
  relations: [],
  movements: [],
  interactions: [],
  metric_estimates: [],
  evidence: [],
  partial_observation: null,
  uncertainty: { level: "low", missing_evidence: [], suggested_view: null }
});

export const SPATIAL_TEST_SCENARIOS = Object.freeze({
  mug_left_of_laptop: scenario("scene_left", {
    objects: [object("mug_1", "mug"), object("laptop_1", "laptop")],
    relations: [relation("mug_1", "mug", "left_of", "laptop_1", "laptop", 0.91)],
    evidence: [evidence("mug", 1, 0.91)]
  }),
  mug_right_of_laptop: scenario("scene_right", {
    objects: [object("mug_1", "mug"), object("laptop_1", "laptop")],
    relations: [relation("mug_1", "mug", "right_of", "laptop_1", "laptop", 0.92)],
    evidence: [evidence("mug", 2, 0.92)]
  }),
  mug_in_front_of_laptop: scenario("scene_front", {
    objects: [object("mug_1", "mug"), object("laptop_1", "laptop")],
    relations: [relation("mug_1", "mug", "in_front_of", "laptop_1", "laptop", 0.9)],
    movements: [{ subject_id: "mug_1", subject_label: "mug", direction: "from the left of the laptop to the area in front of it", description: "You moved the mug from the left side of the laptop to the area in front of it.", confidence: 0.9 }],
    evidence: [evidence("mug", 3, 0.9)]
  }),
  bottle_behind_keyboard: scenario("scene_bottle", {
    objects: [object("bottle_1", "bottle"), object("keyboard_1", "keyboard")],
    relations: [relation("bottle_1", "bottle", "behind", "keyboard_1", "keyboard", 0.87)],
    movements: [{ subject_id: "bottle_1", subject_label: "bottle", description: "You placed the bottle behind the keyboard.", confidence: 0.87 }],
    evidence: [evidence("bottle", 4, 0.87)]
  }),
  hand_approaching_mug: scenario("scene_hand_mug", {
    objects: [object("mug_1", "mug")],
    hands: [{ id: "hand_right", label: "right hand" }],
    interactions: [{ type: "hand_approaches_object", subject_label: "right hand", reference_label: "mug", description: "Your right hand moved closer to the mug.", confidence: 0.89 }],
    evidence: [evidence("right hand", 3, 0.89)]
  }),
  hand_toward_camera: scenario("scene_hand_camera", {
    hands: [{ id: "hand_right", label: "right hand" }],
    movements: [{ subject_id: "hand_right", subject_label: "right hand", direction: "closer to the camera", description: "Your right hand moved closer to the camera.", confidence: 0.9 }],
    evidence: [evidence("right hand", 4, 0.9)]
  }),
  object_leaves_frame_right: scenario("scene_leave", {
    movements: [{ subject_id: "object_1", subject_label: "object", direction: "out of view toward the right", description: "The object moved out of view toward the right.", confidence: 0.86 }],
    evidence: [evidence("object", 5, 0.86)]
  }),
  partial_unknown_object: scenario("scene_partial", {
    partial_observation: { visible: "I can see a dark handle and part of a metallic body.", suggested_view: "Rotate the object slightly so its front is visible." },
    uncertainty: { level: "high", missing_evidence: ["front surface"], suggested_view: "Rotate the object slightly so its front is visible." },
    evidence: [evidence("partly visible object", 2, 0.48)]
  }),
  suggested_additional_view: scenario("scene_view", {
    partial_observation: { visible: "I can see the side of the object, but not its front.", suggested_view: "Turn the object toward the camera." },
    uncertainty: { level: "high", missing_evidence: ["front view"], suggested_view: "Turn the object toward the camera." },
    evidence: [evidence("object", 2, 0.45)]
  }),
  calibrated_metric_distance: scenario("scene_metric", {
    scale: { type: "metric", unit: "centimetres", confidence: 0.9 },
    objects: [object("mug_1", "mug"), object("laptop_1", "laptop")],
    metric_estimates: [{ subject_label: "mug and laptop", value: 15, unit: "centimetres", description: "The mug and laptop are approximately fifteen centimetres apart.", confidence: 0.86 }],
    evidence: [evidence("mug", 3, 0.86)]
  }),
  uncalibrated_relative_distance: scenario("scene_relative", {
    objects: [object("mug_1", "mug"), object("laptop_1", "laptop")],
    relations: [relation("mug_1", "mug", "closer_than", "laptop_1", "laptop", 0.84)],
    evidence: [evidence("mug", 2, 0.84)]
  }),
  service_unavailable: Object.freeze({ ok: false, code: "spatial_service_unavailable" })
});

export function createDeterministicSpatialAdapter(options = {}) {
  if (options.testMode !== true) throw new Error("deterministic_spatial_adapter_requires_test_mode");
  const calls = [];
  return {
    calls,
    async analyzeSpatialWindow(input) {
      calls.push(structuredCloneSafe(input));
      const key = options.scenarioForInput?.(input, calls.length) || options.scenario || scenarioKeyForQuery(input.query, input.mode, calls.length);
      const result = SPATIAL_TEST_SCENARIOS[key];
      if (!result || result.ok === false) throw new Error("Precise spatial analysis is unavailable.");
      return structuredCloneSafe(result);
    }
  };
}

function scenarioKeyForQuery(query = "", mode = "conversation", call = 1) {
  const text = String(query).toLowerCase();
  if (mode === "observing") return ["mug_in_front_of_laptop", "hand_toward_camera", "bottle_behind_keyboard", "object_leaves_frame_right"][(call - 1) % 4];
  if (/centimet|how many/.test(text)) return "uncalibrated_relative_distance";
  if (/closest|near|distance/.test(text)) return "uncalibrated_relative_distance";
  if (/behind/.test(text)) return "bottle_behind_keyboard";
  if (/part|hidden|unknown/.test(text)) return "partial_unknown_object";
  if (/closer|move it/.test(text)) return "mug_in_front_of_laptop";
  return "mug_left_of_laptop";
}

function scenario(sceneId, patch) {
  return Object.freeze({ ...BASE, ...patch, scene_id: sceneId });
}

function object(id, label) {
  return { id, label };
}

function relation(subjectId, subjectLabel, type, referenceId, referenceLabel, confidence) {
  return { subject_id: subjectId, subject_label: subjectLabel, relation: type, reference_id: referenceId, reference_label: referenceLabel, confidence };
}

function evidence(label, frameIndex, confidence) {
  return { label, frame_index: frameIndex, confidence, normalized_region: { x: 0.12, y: 0.25, width: 0.24, height: 0.28 } };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
