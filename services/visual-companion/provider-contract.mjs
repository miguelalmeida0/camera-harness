import { normalizeMalformedVisualOutput, validateContextualVisualResponse } from "./response-schema.mjs";

export const VISUAL_PROVIDER_CONTRACT_VERSION = "darkquest.visual_companion_provider.v1";

export function createMockVisualCompanionProvider(options = {}) {
  const metricsState = {
    loaded: false,
    observed: 0,
    synthesized: 0,
    cancelled: 0,
    unloaded: 0,
    latency_ms: []
  };
  const revision = options.revision || "mock-open-contract-revision-001";
  const license = options.license || "Apache-2.0-compatible-test-double";
  return {
    contract: VISUAL_PROVIDER_CONTRACT_VERSION,
    model_id: options.model_id || "mock/local-visual-companion",
    revision,
    license,
    paid_endpoint_dependency: false,
    async health() {
      return { ok: true, model_id: this.model_id, revision, license, paid_endpoint_dependency: false };
    },
    async load() {
      metricsState.loaded = true;
      return { ok: true, revision };
    },
    async observe(window) {
      const started = Date.now();
      if (!metricsState.loaded) throw new Error("visual provider must be loaded before observe");
      metricsState.observed += 1;
      const output = options.observeResult || {
        observation: window?.observation_window_id || "mock observation",
        scene_before: "object on table",
        scene_after: "object raised",
        visible_changes: ["object moved upward"],
        visible_objects: ["object", "hand"],
        visible_action: "object raised",
        response_type: "narrate",
        spoken_response: "You raised the object.",
        confidence: 0.82,
        uncertainty: "",
        safety_flags: [],
        suggested_actions: []
      };
      metricsState.latency_ms.push(Date.now() - started);
      return normalizeMalformedVisualOutput(output);
    },
    async synthesize(text) {
      metricsState.synthesized += 1;
      return { ok: true, spoken_response: String(text || ""), tts: "browser_fallback" };
    },
    cancel() {
      metricsState.cancelled += 1;
      return { ok: true };
    },
    metrics() {
      return { ...metricsState, latency_ms: [...metricsState.latency_ms] };
    },
    async unload() {
      metricsState.loaded = false;
      metricsState.unloaded += 1;
      return { ok: true };
    }
  };
}

export async function validateVisualProviderContract(provider, options = {}) {
  const failures = [];
  for (const method of ["health", "load", "observe", "synthesize", "cancel", "metrics", "unload"]) {
    if (typeof provider?.[method] !== "function") failures.push("visual_provider_missing");
  }
  if (failures.length) return contractResult(failures);

  const health = await withTimeout(provider.health(), options.timeoutMs || 500, "visual_provider_unhealthy");
  if (!health?.ok) failures.push("visual_provider_unhealthy");
  if (!health?.revision || /latest/i.test(String(health.revision))) failures.push("visual_provider_unpinned");
  if (!health?.license) failures.push("visual_provider_contract_invalid");
  if (health?.paid_endpoint_dependency === true || provider.paid_endpoint_dependency === true) failures.push("visual_provider_paid_dependency");

  await withTimeout(provider.load(), options.timeoutMs || 500, "visual_provider_contract_invalid");
  const observed = await withTimeout(provider.observe(options.window || { observation_window_id: "contract_window" }), options.timeoutMs || 500, "visual_provider_contract_invalid");
  const validation = validateContextualVisualResponse(observed);
  if (!validation.ok) failures.push("visual_provider_contract_invalid");
  await withTimeout(provider.synthesize(observed.spoken_response), options.timeoutMs || 500, "visual_provider_contract_invalid");
  provider.cancel();
  if (typeof provider.metrics()?.observed !== "number") failures.push("visual_provider_contract_invalid");
  await withTimeout(provider.unload(), options.timeoutMs || 500, "visual_provider_contract_invalid");
  return contractResult(failures);
}

function contractResult(failures) {
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function withTimeout(promise, timeoutMs, failureCode) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => {
      const error = new Error(failureCode);
      error.failure_code = failureCode;
      reject(error);
    }, timeoutMs))
  ]);
}
