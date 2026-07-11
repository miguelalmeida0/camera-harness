import { createHmac } from "node:crypto";
import { loadWebhookPolicy, resolveWebhookDestinationId, resolveWebhookSecret, safeWebhookDestinationHost, validateWebhookDestination } from "./webhook-policy.mjs";

const MAX_WEBHOOK_PAYLOAD_BYTES = 16 * 1024;

export async function executeSignedWebhookAction(input = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  const { destination, headers, policy, serialized } = await buildSignedAutomationWebhookRequest(input, env, options);

  const send = options.fetch || globalThis.fetch;
  if (typeof send !== "function") throw webhookError("Automation failed — view safe details", "fetch_unavailable");
  let lastError;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await send(destination, {
        method: "POST",
        headers,
        body: serialized,
        signal: controller.signal,
        redirect: "error"
      });
      if (response.ok) {
        return {
          ok: true,
          safe_message: `Webhook delivered to ${safeWebhookDestinationHost(destination)}.`,
          destination_host: safeWebhookDestinationHost(destination),
          attempts: attempt + 1,
          duration_ms: Date.now() - startedAt,
          contains_raw_media: false
        };
      }
      lastError = webhookError(response.status === 408 || response.status === 504 ? "Webhook timed out" : "Automation failed — view safe details", `webhook_http_${response.status}`);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? webhookError("Webhook timed out", "webhook_timeout")
        : webhookError("Automation failed — view safe details", "webhook_network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || webhookError("Automation failed — view safe details", "webhook_failed");
}

export function executeSignedAutomationWebhook(input, env, options) {
  return executeSignedWebhookAction(input, env, options);
}

export async function buildSignedAutomationWebhookRequest(input = {}, env = process.env, options = {}) {
  const config = input.action?.config || {};
  const policy = loadWebhookPolicy(env);
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_WEBHOOK_PAYLOAD_BYTES) throw webhookError("Automation failed — view safe details", "payload_too_large");
  const configuredDestination = config.destination || resolveWebhookDestinationId(config.destination_id, env);
  const destination = await validateWebhookDestination(configuredDestination, policy, { lookup: options.lookup });
  const secret = resolveWebhookSecret(config.secret_ref, env);
  if (config.secret_ref && !secret) throw webhookError("Automation failed — view safe details", "secret_reference_missing");
  const payload = buildSafeWebhookPayload(input);
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_WEBHOOK_PAYLOAD_BYTES) {
    throw webhookError("Automation failed — view safe details", "payload_too_large");
  }
  const timestamp = Math.floor(Number(options.now ?? Date.now()) / 1000);
  const headers = {
    "Content-Type": "application/json",
    "X-DarkQuest-Timestamp": String(timestamp),
    "X-DarkQuest-Execution-Id": payload.execution_id,
    "Idempotency-Key": payload.execution_id
  };
  if (secret) headers["X-DarkQuest-Signature"] = `v1=${createHmac("sha256", secret).update(`${timestamp}.${serialized}`).digest("hex")}`;
  return { destination, url: destination.toString(), method: "POST", headers, body: serialized, payload, policy, serialized };
}

export function buildSafeWebhookPayload(input = {}) {
  const movement = input.confirmed_movement || {};
  return {
    event: "movement.confirmed",
    movement: safeText(movement.movement || movement.movement_sentence, 240),
    movement_key: safeId(movement.movement_key),
    gesture_tags: (Array.isArray(movement.gesture_tags) ? movement.gesture_tags : []).map(safeId).slice(0, 12),
    confidence: Math.max(0, Math.min(1, Number(movement.confidence || 0))),
    recipe_id: safeId(input.recipe_id),
    execution_id: safeId(input.execution_id),
    timestamp: Math.max(0, Number(movement.confirmed_at || Date.now()))
  };
}

function safeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, maxLength);
}

function safeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
}

function webhookError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
