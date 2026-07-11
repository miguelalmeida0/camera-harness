const timerHandles = new Map();
const voiceInitializationWaited = new WeakSet();

export const AUTOMATION_RISK_TIERS = Object.freeze({
  speak_phrase: 0,
  browser_notification: 1,
  start_timer: 0,
  increment_counter: 0,
  append_activity_log: 0,
  local_snapshot_download: 2,
  signed_webhook_post: 1
});

export function actionRiskTier(actionType) {
  return AUTOMATION_RISK_TIERS[actionType] ?? 2;
}

export function clearAutomationActivityLog(runtime) {
  if (Array.isArray(runtime)) {
    runtime.length = 0;
    return runtime;
  }
  runtime.activityLog = [];
  runtime.activity_log = [];
  return runtime.activityLog;
}

export async function executeLocalAutomationAction(input = {}, fallbackContext = {}) {
  const thirdContext = arguments[2] || {};
  const directType = typeof input === "string" ? input : "";
  const directConfig = directType ? fallbackContext || {} : null;
  const baseContext = directType ? thirdContext : fallbackContext;
  const context = {
    ...(baseContext || {}),
    ...(input?.context || {}),
    ...(baseContext?.capabilities || {}),
    additionalConsentGranted: input?.consent === true || input?.context?.additionalConsentGranted === true || baseContext?.additionalConsentGranted === true
  };
  const recipe = directType ? {
    recipe_id: context.recipe_id || "recipe_direct_action",
    action: { type: directType, config: directConfig }
  } : input.recipe || {
    recipe_id: input.recipe_id || "recipe_direct_action",
    action: input.action || {
      type: input.action_type || input.type,
      config: input.config || {}
    }
  };
  const snapshot = input.snapshot || input.confirmed_movement || input.movement || {};
  const executionId = input.executionId || input.execution_id || input.idempotencyKey || input.idempotency_key || context.execution_id || "execution_direct";
  const runtime = input.runtime || input.automationState || input.state || baseContext.runtime || baseContext.automationState || baseContext.state || { counters: {}, activityLog: [], timers: {}, notificationPermissionAsked: false };
  runtime.counters ||= {};
  runtime.activityLog ||= runtime.activity_log || [];
  runtime.timers ||= {};
  runtime.localActionIdempotencyKeys ||= [];
  const idempotencyKey = input.idempotency_key || input.idempotencyKey || executionId;
  if (runtime.localActionIdempotencyKeys.includes(idempotencyKey)) {
    return {
      execution_id: executionId,
      adapter_type: recipe.action.type,
      status: "succeeded",
      started_at: Number(context.now ?? Date.now()),
      finished_at: Number(context.now ?? Date.now()),
      attempt_count: 0,
      safe_message: "Automation already completed.",
      contains_raw_media: false
    };
  }
  const actionType = recipe.action.type;
  const config = recipe.action.config || {};
  const startedAt = Number(context.now ?? Date.now());
  let outcome;
  if (actionType === "speak_phrase") outcome = await speakPhrase(config, context);
  else if (actionType === "browser_notification") outcome = await showBrowserNotification(config, runtime, context);
  else if (actionType === "start_timer") outcome = startTimer(config, executionId, runtime, context);
  else if (actionType === "increment_counter") outcome = incrementCounter(config, runtime);
  else if (actionType === "append_activity_log") outcome = appendActivityLog(config, snapshot, runtime, context);
  else if (actionType === "local_snapshot_download") outcome = await downloadLocalSnapshot(config, snapshot, executionId, context);
  else if (actionType === "signed_webhook_post") outcome = await executeSignedWebhook(recipe, snapshot, executionId, context);
  else throw automationError("Automation failed — view safe details", "unsupported_action");
  runtime.localActionIdempotencyKeys = [...runtime.localActionIdempotencyKeys, idempotencyKey].slice(-100);
  const finishedAt = Number(context.now ?? Date.now());
  return {
    execution_id: executionId,
    adapter_type: actionType,
    status: "succeeded",
    started_at: startedAt,
    finished_at: Math.max(startedAt, finishedAt),
    attempt_count: 1,
    safe_message: outcome.safe_message,
    contains_raw_media: false
  };
}

async function speakPhrase(config, context) {
  const synth = context.speechSynthesis || globalThis.speechSynthesis;
  const Utterance = context.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance;
  if (typeof synth?.speak !== "function" || typeof Utterance !== "function") {
    throw automationError("Voice unavailable", "voice_unavailable");
  }
  const phrase = String(config?.text ?? config?.phrase ?? config?.value ?? "").trim().slice(0, 180);
  if (!phrase) throw automationError("Speech phrase missing", "speech_phrase_missing");
  await waitForVoicesOnce(synth, context);
  const utterance = new Utterance(phrase);
  const setTimer = context.setTimeout || globalThis.setTimeout;
  const clearTimer = context.clearTimeout || globalThis.clearTimeout;
  const speechStarted = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) clearTimer?.(timeoutId);
      callback();
    };
    const timeoutId = typeof setTimer === "function"
      ? setTimer(() => finish(() => reject(automationError("Voice did not start", "speech_not_started"))), Math.max(250, Number(context.speechStartTimeoutMs || 3000)))
      : null;
    utterance.onstart = () => {
      context.onSpeechStart?.(phrase);
      finish(() => resolve("started"));
    };
    utterance.onend = () => {
      context.onSpeechEnd?.(phrase);
      finish(() => resolve("completed"));
    };
    utterance.onerror = () => {
      context.onSpeechError?.(phrase);
      finish(() => reject(automationError("Voice unavailable", "voice_unavailable")));
    };
  });
  synth.cancel?.();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  try {
    synth.speak(utterance);
  } catch {
    throw automationError("Voice unavailable", "voice_unavailable");
  }
  await speechStarted;
  return { safe_message: "Configured phrase spoken." };
}

async function waitForVoicesOnce(synth, context) {
  if (typeof synth?.getVoices !== "function" || voiceInitializationWaited.has(synth)) return;
  if (synth.getVoices().length > 0) {
    voiceInitializationWaited.add(synth);
    return;
  }
  voiceInitializationWaited.add(synth);
  const setTimer = context.setTimeout || globalThis.setTimeout;
  const clearTimer = context.clearTimeout || globalThis.clearTimeout;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.("voiceschanged", finish);
      if (timeoutId != null) clearTimer?.(timeoutId);
      resolve();
    };
    const timeoutId = typeof setTimer === "function"
      ? setTimer(finish, Math.max(50, Number(context.voiceLoadTimeoutMs || 500)))
      : null;
    if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", finish, { once: true });
    else if ("onvoiceschanged" in synth) {
      const previous = synth.onvoiceschanged;
      synth.onvoiceschanged = (event) => {
        if (typeof previous === "function") previous.call(synth, event);
        finish();
      };
    } else finish();
  });
}

async function showBrowserNotification(config, runtime, context) {
  const NotificationApi = context.Notification || context.notificationApi || context.notification || globalThis.Notification;
  if (!NotificationApi) throw automationError("Notification permission denied", "automation_notification_permission_denied");
  let permission = NotificationApi.permission || context.notificationPermission || "default";
  if (permission === "default") {
    if (context.userGesture !== true || runtime.notificationPermissionAsked === true) {
      throw automationError("Notification permission denied", "automation_notification_permission_denied");
    }
    runtime.notificationPermissionAsked = true;
    const requestPermission = context.requestNotificationPermission || NotificationApi.requestPermission?.bind(NotificationApi);
    if (typeof requestPermission !== "function") throw automationError("Notification permission denied", "automation_notification_permission_denied");
    permission = await requestPermission();
  }
  if (permission !== "granted") throw automationError("Notification permission denied", "automation_notification_permission_denied");
  const title = String(config.title || "DarkQuest").slice(0, 80);
  const notificationOptions = { body: String(config.body || "Movement confirmed.").slice(0, 180) };
  if (typeof context.showNotification === "function") context.showNotification(title, notificationOptions);
  else if (typeof NotificationApi.show === "function") NotificationApi.show(title, notificationOptions);
  else if (typeof NotificationApi === "function") new NotificationApi(title, notificationOptions);
  else throw automationError("Notification permission denied", "automation_notification_permission_denied");
  return { safe_message: "Browser notification shown." };
}

function startTimer(config, executionId, runtime, context) {
  if (context.documentHidden === true || context.document?.hidden === true) throw automationError("Automation failed — view safe details", "hidden_tab");
  if (timerHandles.has(executionId)) return { safe_message: "Timer is already running." };
  const durationSeconds = Math.max(1, Math.min(86_400, Number(config.duration_seconds || Number(config.duration_ms || 0) / 1000 || 60)));
  const setTimer = context.setTimeout || globalThis.setTimeout;
  runtime.timers[executionId] = {
    duration_seconds: durationSeconds,
    started_at: Date.now(),
    status: "running"
  };
  const handle = setTimer(() => {
    if (runtime.timers[executionId]) runtime.timers[executionId].status = "complete";
    timerHandles.delete(executionId);
    context.onRuntimeChange?.();
  }, durationSeconds * 1000);
  timerHandles.set(executionId, handle);
  return { safe_message: `${durationSeconds}-second timer started.` };
}

function incrementCounter(config, runtime) {
  const name = String(config.counter_name || config.counter_id || config.name || "completed").slice(0, 80);
  const amount = Math.max(1, Math.min(1000, Number(config.amount || 1)));
  runtime.counters[name] = Math.min(1_000_000, Number(runtime.counters[name] || 0) + amount);
  return { safe_message: `${name} counter is now ${runtime.counters[name]}.` };
}

function appendActivityLog(config, snapshot, runtime, context) {
  runtime.activityLog = [...runtime.activityLog, {
    movement: sanitizeLogText(config.text || snapshot.movement || snapshot.movement_sentence || "Movement confirmed."),
    timestamp: Number(context.now ?? Date.now()),
    category: String(config.category || config.label || "activity").slice(0, 80),
    contains_raw_media: false
  }].slice(-100);
  runtime.activity_log = runtime.activityLog;
  return { safe_message: "Activity entry added." };
}

function sanitizeLogText(value) {
  return String(value || "Movement confirmed.")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[media omitted]")
    .replace(/\b(base64|frame|screenshot|token|secret)\b/gi, "[omitted]")
    .slice(0, 240);
}

async function downloadLocalSnapshot(config, snapshot, executionId, context) {
  let consentGranted = context.additionalConsentGranted === true || context.snapshotConsentGranted === true;
  if (!consentGranted && typeof context.requestConsent === "function") {
    consentGranted = context.requestConsent("Download a snapshot for this confirmed movement?") === true;
  }
  if (!consentGranted) {
    throw automationError("Snapshot confirmation cancelled", "automation_snapshot_without_confirmation");
  }
  const captureSnapshot = context.captureSnapshot || context.captureLocalSnapshot || context.captureFreshMirroredJpeg;
  if (typeof captureSnapshot !== "function" && typeof context.captureFreshFrame === "function") {
    let objectUrl = "";
    try {
      const blob = await context.captureFreshFrame();
      objectUrl = context.createObjectURL?.(blob) || "";
      context.downloadBlob?.(blob, objectUrl);
    } finally {
      if (objectUrl) context.revokeObjectURL?.(objectUrl);
    }
    return { safe_message: "Snapshot downloaded locally." };
  }
  if (typeof captureSnapshot !== "function") {
    throw automationError("Camera snapshot could not be created", "snapshot_unavailable");
  }
  await captureSnapshot({
    executionId,
    movementResultId: snapshot.movement_result_id || snapshot.result_id,
    filenamePrefix: String(config.filename_prefix || "darkquest-movement").slice(0, 80)
  });
  return { safe_message: "Snapshot downloaded locally." };
}

async function executeSignedWebhook(recipe, snapshot, executionId, context) {
  if (typeof context.executeWebhook !== "function") {
    throw automationError("Automation failed — view safe details", "webhook_endpoint_unavailable");
  }
  const response = await context.executeWebhook({
    recipe_id: recipe.recipe_id,
    execution_id: executionId,
    confirmed_movement: snapshot,
    action: {
      type: "signed_webhook_post",
      config: { ...recipe.action.config }
    }
  });
  if (!response?.ok) throw automationError(response?.safe_message || "Automation failed — view safe details", response?.code || "webhook_failed");
  return { safe_message: response.safe_message || "Webhook delivered." };
}

function automationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
