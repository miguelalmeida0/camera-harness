import { sanitizeSpatialResult, sanitizeTextNumericData, spatialFailure } from "./spatial-contract.mjs";

export function createSpatialAwarenessClient(options = {}) {
  const endpoint = String(options.endpoint || "/api/spatial-awareness/analyze");
  const healthEndpoint = String(options.healthEndpoint || endpoint.replace(/\/analyze$/, "/health"));
  const timeoutMs = clampTimeout(options.timeoutMs);
  const send = options.fetch || globalThis.fetch;
  let activeController = null;
  let disposed = false;

  async function request(url, init = {}, requestType = "analysis") {
    if (disposed) return spatialFailure("spatial_client_disposed", "Spatial analysis is unavailable.");
    if (typeof send !== "function") return spatialFailure("spatial_client_unavailable", "Spatial analysis is unavailable.");
    if (activeController) return spatialFailure("spatial_request_in_flight", "A spatial analysis is already running.");
    const controller = new AbortController();
    activeController = controller;
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await send(url, { ...init, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (requestType === "health" && response.ok) return sanitizeTextNumericData(body);
      if (!response.ok || body?.ok === false) return sanitizeSpatialResult(body?.code ? body : spatialFailure("spatial_request_failed"));
      return sanitizeSpatialResult(body);
    } catch (error) {
      if (controller.signal.aborted) return spatialFailure("spatial_cancelled", "Spatial analysis was cancelled.");
      return spatialFailure("spatial_request_failed", "Spatial analysis is temporarily unavailable.");
    } finally {
      clearTimeout(timer);
      if (activeController === controller) activeController = null;
    }
  }

  return {
    health() {
      return request(healthEndpoint, { method: "GET", headers: { Accept: "application/json" } }, "health");
    },
    analyzeSpatialWindow(input = {}) {
      return request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-DarkQuest-Session-Id": String(input.sessionId || input.session_id || "")
        },
        body: JSON.stringify({
          frames: input.frames,
          timestamps: input.timestamps,
          query: input.query ?? null,
          mode: input.mode,
          calibration: input.calibration ?? null,
          previousScene: input.previousScene ?? null
        })
      });
    },
    cancel() {
      activeController?.abort("cancelled");
      activeController = null;
      return { ok: true, cancelled: true };
    },
    dispose() {
      activeController?.abort("disposed");
      activeController = null;
      disposed = true;
      return { ok: true, disposed: true };
    }
  };
}

function clampTimeout(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(120000, Math.max(250, Math.round(number))) : 30000;
}
