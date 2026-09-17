export const MICROSCOPE_PHASES = Object.freeze([
  "starting",
  "live",
  "tracking",
  "analyzing",
  "error"
]);
export const MICROSCOPE_STATES = Object.freeze(["inactive", ...MICROSCOPE_PHASES]);

export const MICROSCOPE_REQUEST_REASONS = Object.freeze(["inspect", "follow_up", "reanalyze"]);
export const MICROSCOPE_ACTION_TYPES = Object.freeze([
  "ask_follow_up",
  "inspect_detail",
  "compare",
  "translate",
  "read_text"
]);

const ACTION_TYPES = new Set(MICROSCOPE_ACTION_TYPES);
const REQUEST_REASONS = new Set(MICROSCOPE_REQUEST_REASONS);
const SEVERITIES = new Set(["info", "attention", "possible_issue"]);

export function createInitialMicroscopeState(capability = {}) {
  return {
    status: "inactive",
    active: false,
    objects: [],
    selectedObjectId: null,
    selectedObject: null,
    provider: validateProviderCapability(capability),
    result: null,
    error: null,
    notice: "",
    lastStopReason: null
  };
}

export function validateProviderCapability(value = {}) {
  const configured = value?.configured === true;
  const provider = configured && ["openai", "anthropic", "huggingface"].includes(String(value.provider || ""))
    ? String(value.provider)
    : null;
  const model = configured && provider && cleanText(value.model, 160) ? cleanText(value.model, 160) : null;
  const ready = Boolean(configured && provider && model);
  const availability = ready
    ? "ready"
    : value?.availability === "unavailable"
      ? "unavailable"
      : "unconfigured";
  return Object.freeze({
    configured: ready,
    provider: ready ? provider : null,
    model: ready ? model : null,
    availability
  });
}

export function sanitizeCandidateLabels(values = []) {
  return (Array.isArray(values) ? values : []).slice(0, 8).map((value) => ({
    label: cleanText(value?.label, 80) || "Possible object",
    confidence: validConfidence(value?.confidence, "candidate confidence"),
    source: "local_detector"
  }));
}

export function validateMicroscopeResult(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw schemaError("result must be an object");
  return Object.freeze({
    title: requiredText(value.title, 120, "title"),
    category: value.category == null ? null : requiredText(value.category, 80, "category"),
    confidence: validConfidence(value.confidence, "confidence"),
    summary: requiredText(value.summary, 800, "summary"),
    visibleFacts: validateArray(value.visibleFacts, 12, (item) => Object.freeze({
      statement: requiredText(item?.statement, 280, "visible fact"),
      confidence: validConfidence(item?.confidence, "visible fact confidence")
    }), "visibleFacts"),
    likelyInferences: validateArray(value.likelyInferences, 8, (item) => Object.freeze({
      statement: requiredText(item?.statement, 280, "likely inference"),
      confidence: validConfidence(item?.confidence, "inference confidence"),
      basis: requiredText(item?.basis, 320, "inference basis")
    }), "likelyInferences"),
    conditionFindings: validateArray(value.conditionFindings, 10, (item) => {
      const severity = String(item?.severity || "");
      if (!SEVERITIES.has(severity)) throw schemaError("condition severity is invalid");
      return Object.freeze({
        finding: requiredText(item?.finding, 280, "condition finding"),
        severity,
        confidence: validConfidence(item?.confidence, "condition confidence")
      });
    }, "conditionFindings"),
    visibleText: validateArray(value.visibleText, 12, (item) => Object.freeze({
      text: requiredText(item?.text, 500, "visible text"),
      confidence: validConfidence(item?.confidence, "text confidence")
    }), "visibleText"),
    anomalies: validateArray(value.anomalies, 8, (item) => Object.freeze({
      finding: requiredText(item?.finding, 280, "anomaly"),
      confidence: validConfidence(item?.confidence, "anomaly confidence")
    }), "anomalies"),
    limitations: validateArray(value.limitations, 10, (item) => requiredText(item, 320, "limitation"), "limitations"),
    suggestedActions: validateArray(value.suggestedActions, 8, (item) => {
      const type = String(item?.type || "");
      if (!ACTION_TYPES.has(type)) throw schemaError("suggested action type is invalid");
      return Object.freeze({
        id: requiredText(item?.id, 80, "action id"),
        label: requiredText(item?.label, 100, "action label"),
        type
      });
    }, "suggestedActions")
  });
}

export function createMicroscopeRequestGate(options = {}) {
  let limit = clampInteger(options.limit, 1, 25, 10);
  let mode = options.mode === "off" ? "off" : "manual_only";
  let sequence = 0;
  let inFlight = null;
  const audits = [];

  function begin(input = {}) {
    const reason = String(input.reason || "");
    if (!REQUEST_REASONS.has(reason)) return failure("microscope_background_request_rejected");
    if (mode !== "manual_only") return failure("microscope_analysis_disabled");
    if (inFlight) return failure("microscope_request_in_flight");
    if (audits.length >= limit) return failure("microscope_session_limit_reached");
    const cropWidth = clampInteger(input.cropWidth, 1, 4096, 1);
    const cropHeight = clampInteger(input.cropHeight, 1, 4096, 1);
    const audit = {
      id: `microscope-${++sequence}`,
      reason,
      provider: requiredText(input.provider, 80, "provider"),
      model: requiredText(input.model, 160, "model"),
      createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now(),
      cropWidth,
      cropHeight,
      cacheHit: false
    };
    audits.push(audit);
    inFlight = audit.id;
    return { ok: true, audit: Object.freeze({ ...audit }) };
  }

  function complete(id, usage = {}) {
    if (String(id) !== inFlight) return false;
    const audit = audits.find((item) => item.id === inFlight);
    if (audit) {
      if (Number.isFinite(Number(usage.inputTokens))) audit.inputTokens = Math.max(0, Math.round(Number(usage.inputTokens)));
      if (Number.isFinite(Number(usage.outputTokens))) audit.outputTokens = Math.max(0, Math.round(Number(usage.outputTokens)));
      if (Number.isFinite(Number(usage.estimatedCostUsd))) audit.estimatedCostUsd = Math.max(0, Number(usage.estimatedCostUsd));
      audit.cacheHit = usage.cacheHit === true;
    }
    inFlight = null;
    return true;
  }

  function fail(id) {
    if (String(id) !== inFlight) return false;
    inFlight = null;
    return true;
  }

  function configure(next = {}) {
    if (next.mode != null) mode = next.mode === "off" ? "off" : "manual_only";
    if (next.limit != null) limit = clampInteger(next.limit, 1, 25, limit);
    return snapshot();
  }

  function clear() {
    audits.length = 0;
    inFlight = null;
  }

  function snapshot() {
    return Object.freeze({
      mode,
      limit,
      inFlight,
      inspections: audits.filter((item) => ["inspect", "reanalyze"].includes(item.reason)).length,
      followUps: audits.filter((item) => item.reason === "follow_up").length,
      backgroundRequests: 0,
      audits: audits.map((item) => Object.freeze({ ...item }))
    });
  }

  return Object.freeze({ begin, clear, complete, configure, fail, snapshot });
}

export function buildMicroscopeRequest(input = {}) {
  const reason = String(input.reason || "inspect");
  if (!REQUEST_REASONS.has(reason)) throw schemaError("request reason is invalid");
  const crop = requiredText(input.crop, 8 * 1024 * 1024, "crop");
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(crop)) throw schemaError("crop must be an encoded image");
  return Object.freeze({
    inspectionId: requiredText(input.inspectionId, 100, "inspection id"),
    reason,
    crop,
    contextFrame: input.contextFrame ? requiredText(input.contextFrame, 2 * 1024 * 1024, "context frame") : null,
    userQuestion: cleanText(input.userQuestion, 500),
    candidateLabels: sanitizeCandidateLabels(input.candidateLabels),
    requestedAnalysis: Object.freeze(["identity", "visible_features", "condition", "text", "anomalies", "uncertainty"]),
    imageDetail: input.imageDetail === "detailed" ? "detailed" : "efficient"
  });
}

function validateArray(value, maximum, validator, name) {
  if (!Array.isArray(value)) throw schemaError(`${name} must be an array`);
  if (value.length > maximum) throw schemaError(`${name} exceeds its item limit`);
  return Object.freeze(value.map(validator));
}

function validConfidence(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw schemaError(`${name} must be between 0 and 1`);
  return number;
}

function requiredText(value, maximum, name) {
  const text = cleanText(value, maximum);
  if (!text) throw schemaError(`${name} is required`);
  if (/<\/?[a-z][^>]*>/i.test(text)) throw schemaError(`${name} contains unsupported HTML`);
  return text;
}

function cleanText(value, maximum = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function schemaError(message) {
  const error = new Error(`The inspection result could not be verified: ${message}.`);
  error.code = "microscope_invalid_response";
  return error;
}

function failure(code) {
  return Object.freeze({ ok: false, code });
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
