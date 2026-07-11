import http from "node:http";
import {
  buildSignedAutomationWebhookRequest as buildSignedWebhookRequest,
  executeSignedWebhookAction as executeWebhook
} from "./webhook-action-adapter.mjs";
import { validateWebhookDestination as validateWebhook } from "./webhook-policy.mjs";

export const AUTOMATION_EXECUTE_ROUTE = "/api/automation/execute";
const MAX_BODY_BYTES = 64 * 1024;

export function validateAutomationWebhookDestination(destination, policy, options) {
  return validateWebhook(destination, policy, options);
}

export function buildSignedAutomationWebhookRequest(input, env, options) {
  return buildSignedWebhookRequest(input, env, options);
}

export function executeSignedAutomationWebhook(input, env, options) {
  return executeWebhook(input, env, options);
}

export async function automationExecutionResponseForRequest(body = {}, env = process.env, options = {}) {
  const startedAt = Date.now();
  try {
    validateAutomationRequest(body);
    const outcome = await (options.execute || executeWebhook)(body, env, options);
    return {
      status: 200,
      json: {
        ok: true,
        execution_id: safeId(body.execution_id),
        recipe_id: safeId(body.recipe_id),
        status: "succeeded",
        safe_message: outcome.safe_message || "Webhook delivered.",
        duration_ms: Date.now() - startedAt,
        contains_raw_media: false
      }
    };
  } catch (error) {
    const destinationBlocked = ["invalid_destination", "destination_credentials_forbidden", "https_required", "destination_not_allowlisted", "private_destination_blocked", "destination_unresolved"].includes(error?.code);
    const timeout = error?.code === "webhook_timeout" || error?.message === "Webhook timed out";
    return {
      status: destinationBlocked ? 403 : timeout ? 504 : 502,
      json: {
        ok: false,
        execution_id: safeId(body.execution_id),
        recipe_id: safeId(body.recipe_id),
        status: "failed",
        code: destinationBlocked ? "destination_not_approved" : timeout ? "webhook_timeout" : "automation_failed",
        safe_message: destinationBlocked ? "Webhook destination is not approved" : timeout ? "Webhook timed out" : "Automation failed — view safe details",
        duration_ms: Date.now() - startedAt,
        contains_raw_media: false
      }
    };
  }
}

export function createAutomationServer(options = {}) {
  return http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== AUTOMATION_EXECUTE_ROUTE) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await automationExecutionResponseForRequest(body, options.env, options);
      writeJson(response, result.status, result.json);
    } catch {
      writeJson(response, 400, { ok: false, status: "failed", safe_message: "Automation failed — view safe details", contains_raw_media: false });
    }
  });
}

function validateAutomationRequest(body) {
  if (!body || typeof body !== "object") throw requestError("invalid_request");
  if (!body.recipe_id || !body.execution_id) throw requestError("missing_identifier");
  if (body.action?.type !== "signed_webhook_post") throw requestError("unsupported_server_action");
  if (body.confirmed_movement?.confirmed !== true) throw requestError("movement_unconfirmed");
  if (body.confirmed_movement?.uncertainty === true) throw requestError("movement_uncertain");
  const serialized = JSON.stringify(body.action?.config || {});
  if (body.action?.config?.destination || !body.action?.config?.destination_id) throw requestError("destination_reference_required");
  if (/data:image|;base64,|authorization\s*:|bearer\s+|hf_[a-z0-9]{12,}/i.test(serialized)) throw requestError("unsafe_action_configuration");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw requestError("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function requestError(code) {
  const error = new Error("Automation failed — view safe details");
  error.code = code;
  return error;
}

function safeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
}
