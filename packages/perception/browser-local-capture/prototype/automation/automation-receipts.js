export const AUTOMATION_RECEIPT_STATUSES = Object.freeze([
  "awaiting_confirmation",
  "planning",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "cooldown",
  "rate_limited"
]);

export const MAX_AUTOMATION_RECEIPTS = 50;

export function createAutomationReceipt(input = {}) {
  const startedAt = Math.max(0, Math.round(input.started_at ?? Date.now()));
  const finishedAt = Math.max(startedAt, Math.round(input.finished_at ?? startedAt));
  return {
    execution_id: safeId(input.execution_id),
    recipe_id: safeId(input.recipe_id),
    movement_result_id: safeId(input.movement_result_id),
    action_type: safeId(input.action_type),
    status: AUTOMATION_RECEIPT_STATUSES.includes(input.status) ? input.status : "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, finishedAt - startedAt),
    safe_message: safeMessage(input.safe_message),
    contains_raw_media: false,
    dry_run: input.dry_run === true
  };
}

export function appendAutomationReceipt(receipts = [], receipt, maxItems = MAX_AUTOMATION_RECEIPTS) {
  const normalized = createAutomationReceipt(receipt);
  const withoutDuplicate = receipts.filter((item) => item.execution_id !== normalized.execution_id || item.recipe_id !== normalized.recipe_id || item.dry_run !== normalized.dry_run);
  return [...withoutDuplicate, normalized].slice(-Math.max(1, Math.min(MAX_AUTOMATION_RECEIPTS, maxItems)));
}

function safeId(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 140);
}

function safeMessage(value) {
  return String(value ?? "Automation finished.")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[media omitted]")
    .replace(/\b(bearer|authorization|token|secret)\b[^,.;]*/gi, "[private value omitted]")
    .slice(0, 240);
}
