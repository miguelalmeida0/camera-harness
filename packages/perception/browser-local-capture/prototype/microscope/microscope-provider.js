import {
  buildMicroscopeRequest,
  validateMicroscopeResult,
  validateProviderCapability
} from "./microscope-core.js";

export function createMicroscopeProviderClient(options = {}) {
  const send = options.fetch || globalThis.fetch?.bind(globalThis);
  const capabilityEndpoint = options.capabilityEndpoint || "/api/microscope/capability";
  const inspectEndpoint = options.inspectEndpoint || "/api/microscope/inspect";
  let capability = validateProviderCapability(options.capability);

  async function refreshCapability() {
    if (typeof send !== "function") return capability;
    try {
      const response = await send(capabilityEndpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      const payload = await safeJson(response);
      capability = validateProviderCapability(response.ok
        ? { ...payload, availability: payload?.configured === true ? "ready" : "unconfigured" }
        : { availability: "unavailable" });
    } catch {
      capability = validateProviderCapability({ availability: "unavailable" });
    }
    return capability;
  }

  async function inspect(input = {}, requestOptions = {}) {
    if (!capability.configured) {
      const error = new Error("AI inspection is not configured.");
      error.code = "microscope_provider_unconfigured";
      throw error;
    }
    if (typeof send !== "function") {
      const error = new Error("Inspection could not reach the AI provider.");
      error.code = "microscope_network_failure";
      throw error;
    }
    const request = buildMicroscopeRequest(input);
    let response;
    try {
      response = await send(inspectEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: requestOptions.signal
      });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      const error = new Error("Inspection could not reach the AI provider.", { cause });
      error.code = "microscope_network_failure";
      throw error;
    }
    const payload = await safeJson(response);
    if (!response.ok) throw providerError(payload, response.status);
    return Object.freeze({
      result: validateMicroscopeResult(payload.result),
      usage: Object.freeze({
        inputTokens: finiteOrUndefined(payload.usage?.inputTokens),
        outputTokens: finiteOrUndefined(payload.usage?.outputTokens),
        estimatedCostUsd: finiteOrUndefined(payload.usage?.estimatedCostUsd),
        cacheHit: payload.usage?.cacheHit === true
      }),
      provider: String(payload.provider || capability.provider),
      model: String(payload.model || capability.model),
      createdAt: Number(payload.createdAt) || Date.now()
    });
  }

  return Object.freeze({
    get capability() { return capability; },
    inspect,
    refreshCapability
  });
}

function providerError(payload, status) {
  const code = String(payload?.code || "");
  const messages = {
    microscope_provider_unconfigured: "AI inspection is not configured.",
    microscope_rate_limit: "Inspection limit reached.",
    microscope_invalid_response: "The inspection result could not be verified.",
    microscope_unsupported_image: "This region could not be analyzed. Try a clearer selection."
  };
  const error = new Error(messages[code] || (status === 429 ? "Inspection limit reached." : "Inspection could not reach the AI provider."));
  error.code = code || (status === 429 ? "microscope_rate_limit" : "microscope_network_failure");
  return error;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function finiteOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
