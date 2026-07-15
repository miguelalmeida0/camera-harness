const DEFAULT_LATENCY_SAMPLE_LIMIT = 240;

export function createNeuralFieldWorkerClient(options = {}) {
  const WorkerApi = options.WorkerApi || globalThis.Worker;
  const createWorker = options.createWorker;
  const workerUrl = options.workerUrl || new URL("./gesture-recognizer-worker.js", import.meta.url);
  const latencySampleLimit = positiveInteger(options.latencySampleLimit, DEFAULT_LATENCY_SAMPLE_LIMIT);
  let worker = null;
  let stopTimer = null;
  let ready = false;
  let disposed = false;
  let inFlight = null;
  let pending = null;
  let lastQueuedTimestamp = -Infinity;
  let lastDeliveredTimestamp = -Infinity;
  let submittedFrames = 0;
  let attemptedFrames = 0;
  let completedFrames = 0;
  let droppedFrames = 0;
  let staleFrames = 0;
  let replacedFrames = 0;
  let maxQueueDepth = 0;
  const processingLatencies = [];
  const eventLatencies = [];

  function start() {
    if (disposed) return false;
    if (worker) return true;
    if (typeof WorkerApi !== "function" && typeof createWorker !== "function") {
      reportError("neural_field_worker_unsupported", "Local hand perception workers are unavailable.");
      return false;
    }
    try {
      const workerOptions = {
        type: "module",
        name: "sensefield-neural-field-perception"
      };
      worker = typeof createWorker === "function"
        ? createWorker(workerUrl, workerOptions)
        : new WorkerApi(workerUrl, workerOptions);
      worker.addEventListener?.("message", onWorkerMessage);
      worker.addEventListener?.("error", onWorkerError);
      worker.postMessage({ type: "init" });
      publishDiagnostics();
      return true;
    } catch {
      finalizeWorker();
      worker = null;
      reportError("neural_field_worker_start_failed", "Local hand perception worker could not start.");
      return false;
    }
  }

  function processFrame(input = {}) {
    attemptedFrames += 1;
    const frame = input.frame;
    const timestamp = Number(input.timestamp);
    if (disposed || !frame) {
      closeFrame(frame);
      recordDrop(timestamp, disposed ? "client_disposed" : "missing_frame");
      return false;
    }
    if (!Number.isFinite(timestamp) || timestamp <= lastQueuedTimestamp) {
      closeFrame(frame);
      staleFrames += 1;
      recordDrop(timestamp, "stale_timestamp");
      return false;
    }
    if (!worker && !start()) {
      closeFrame(frame);
      recordDrop(timestamp, "worker_unavailable");
      return false;
    }

    const queued = {
      frame,
      timestamp,
      frameWidth: positiveDimension(input.frameWidth),
      frameHeight: positiveDimension(input.frameHeight),
      mirrored: input.mirrored === true,
      queuedAt: monotonicNow()
    };
    lastQueuedTimestamp = timestamp;
    submittedFrames += 1;

    if (!ready || inFlight) {
      if (pending) {
        closeFrame(pending.frame);
        replacedFrames += 1;
        recordDrop(pending.timestamp, "superseded_by_newer_frame");
      }
      pending = queued;
      updateMaxQueueDepth();
      publishDiagnostics();
      return true;
    }

    sendFrame(queued);
    return true;
  }

  function sendFrame(queued) {
    if (!worker || disposed || !ready) {
      closeFrame(queued.frame);
      recordDrop(queued.timestamp, disposed ? "client_disposed" : "worker_unready");
      return;
    }
    const frame = queued.frame;
    const message = {
      type: "process_frame",
      frame,
      timestamp: queued.timestamp,
      frameWidth: queued.frameWidth,
      frameHeight: queued.frameHeight,
      mirrored: queued.mirrored
    };
    const transfer = transferableFrame(frame, options) ? [frame] : [];
    inFlight = {
      timestamp: queued.timestamp,
      queuedAt: queued.queuedAt,
      sentAt: monotonicNow()
    };
    updateMaxQueueDepth();
    try {
      worker.postMessage(message, transfer);
      if (!transfer.length) closeFrame(frame);
    } catch {
      inFlight = null;
      closeFrame(frame);
      recordDrop(queued.timestamp, "frame_transfer_failed");
      reportError("neural_field_frame_transfer_failed", "Camera frame could not be transferred locally.");
      flushPending();
    }
    publishDiagnostics();
  }

  function onWorkerMessage(event) {
    const message = event?.data || {};
    if (message.type === "gesture_engine_ready") {
      ready = true;
      const queued = detachPending();
      invokeCallback(options.onReady);
      dispatchDetached(queued);
      publishDiagnostics();
      return;
    }
    if (message.type === "hand_frame") {
      const completed = finishInFlight(message.timestamp);
      const timestamp = Number(message.timestamp);
      if (Number.isFinite(timestamp) && timestamp > lastDeliveredTimestamp) {
        lastDeliveredTimestamp = timestamp;
        completedFrames += 1;
        pushSample(processingLatencies, Number(message.processingMs), latencySampleLimit);
        if (completed) pushSample(eventLatencies, Math.max(0, monotonicNow() - completed.queuedAt), latencySampleLimit);
        const queued = detachPending();
        invokeCallback(options.onHandFrame, message);
        dispatchDetached(queued);
      } else {
        staleFrames += 1;
        recordDrop(timestamp, "stale_worker_result");
        flushPending();
      }
      publishDiagnostics();
      return;
    }
    if (message.type === "hand_frame_dropped") {
      finishInFlight(message.timestamp);
      recordDrop(message.timestamp, message.reason || "worker_dropped", {
        processingMs: finiteNonNegative(message.processingMs)
      });
      flushPending();
      return;
    }
    if (message.type === "gesture_engine_stopped") {
      finalizeWorker();
      publishDiagnostics();
      return;
    }
    if (message.type === "gesture_engine_error" || message.type === "neural_field_error") {
      haltWorker(message.code || "neural_field_worker_error", message.safe_message || "Local hand perception failed.");
    }
    options.onWorkerMessage?.(message);
  }

  function onWorkerError() {
    haltWorker("neural_field_worker_error", "Local hand perception worker stopped unexpectedly.");
  }

  function finishInFlight(timestamp) {
    if (!inFlight) return null;
    const resultTimestamp = Number(timestamp);
    if (Number.isFinite(resultTimestamp) && resultTimestamp !== inFlight.timestamp) return null;
    const completed = inFlight;
    inFlight = null;
    return completed;
  }

  function flushPending() {
    if (!ready || inFlight || !pending || disposed) return;
    dispatchDetached(detachPending());
  }

  function detachPending() {
    const next = pending;
    pending = null;
    return next;
  }

  function dispatchDetached(next) {
    if (!next) return;
    if (disposed || !ready) {
      closeFrame(next.frame);
      recordDrop(next.timestamp, disposed ? "client_disposed" : "worker_unready");
      return;
    }
    if (next.timestamp < lastQueuedTimestamp || inFlight || pending) {
      closeFrame(next.frame);
      replacedFrames += 1;
      recordDrop(next.timestamp, "superseded_by_callback_frame");
      return;
    }
    sendFrame(next);
  }

  function recordDrop(timestamp, reason, details = {}) {
    droppedFrames += 1;
    invokeCallback(options.onFrameDropped, {
      ...details,
      type: "hand_frame_dropped",
      timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : null,
      reason
    });
    publishDiagnostics();
  }

  function reportError(code, safeMessage) {
    invokeCallback(options.onError, { code, safeMessage });
    publishDiagnostics();
  }

  function haltWorker(code, safeMessage) {
    ready = false;
    if (inFlight) recordDrop(inFlight.timestamp, "worker_stopped");
    inFlight = null;
    if (pending) {
      closeFrame(pending.frame);
      recordDrop(pending.timestamp, "worker_stopped");
    }
    pending = null;
    finalizeWorker();
    reportError(code, safeMessage);
  }

  function updateMaxQueueDepth() {
    maxQueueDepth = Math.max(maxQueueDepth, Number(Boolean(inFlight)) + Number(Boolean(pending)));
  }

  function diagnostics() {
    const queueDepth = Number(Boolean(inFlight)) + Number(Boolean(pending));
    return {
      ready,
      disposed,
      workerActive: Boolean(worker),
      inFlight: Boolean(inFlight),
      pending: Boolean(pending),
      queueDepth,
      maxQueueDepth,
      attemptedFrames,
      submittedFrames,
      completedFrames,
      droppedFrames,
      staleFrames,
      replacedFrames,
      frameDropRate: attemptedFrames ? droppedFrames / attemptedFrames : 0,
      medianProcessingMs: percentile(processingLatencies, 0.5),
      p95ProcessingMs: percentile(processingLatencies, 0.95),
      medianEventLatencyMs: percentile(eventLatencies, 0.5),
      p95EventLatencyMs: percentile(eventLatencies, 0.95),
      lastQueuedTimestamp: Number.isFinite(lastQueuedTimestamp) ? lastQueuedTimestamp : null,
      lastDeliveredTimestamp: Number.isFinite(lastDeliveredTimestamp) ? lastDeliveredTimestamp : null
    };
  }

  function publishDiagnostics() {
    invokeCallback(options.onDiagnostics, diagnostics());
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ready = false;
    if (pending) closeFrame(pending.frame);
    pending = null;
    inFlight = null;
    if (worker) {
      try {
        worker.postMessage?.({ type: "stop" });
        if (worker) stopTimer = globalThis.setTimeout?.(finalizeWorker, positiveInteger(options.stopTimeoutMs, 50)) ?? null;
      } catch {
        finalizeWorker();
      }
    }
    publishDiagnostics();
  }

  function finalizeWorker() {
    if (stopTimer != null) globalThis.clearTimeout?.(stopTimer);
    stopTimer = null;
    const activeWorker = worker;
    worker = null;
    try { activeWorker?.removeEventListener?.("message", onWorkerMessage); } catch {}
    try { activeWorker?.removeEventListener?.("error", onWorkerError); } catch {}
    try { activeWorker?.terminate?.(); } catch {}
  }

  function invokeCallback(callback, value) {
    if (typeof callback !== "function") return;
    try {
      callback(value);
    } catch (error) {
      try { options.onCallbackError?.({ error, value }); } catch {}
    }
  }

  return {
    start,
    processFrame,
    dispose,
    stop: dispose,
    getDiagnostics: diagnostics,
    isReady: () => ready,
    isDisposed: () => disposed
  };
}

function transferableFrame(frame, options) {
  const ImageBitmapApi = options.ImageBitmapApi || globalThis.ImageBitmap;
  const VideoFrameApi = options.VideoFrameApi || globalThis.VideoFrame;
  return (typeof ImageBitmapApi === "function" && frame instanceof ImageBitmapApi)
    || (typeof VideoFrameApi === "function" && frame instanceof VideoFrameApi);
}

function closeFrame(frame) {
  try {
    frame?.close?.();
  } catch {
    // Resource cleanup is best-effort and never retains the raw frame.
  }
}

function monotonicNow() {
  return Number(globalThis.performance?.now?.() || Date.now());
}

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : 1;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function pushSample(samples, value, limit) {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > limit) samples.splice(0, samples.length - limit);
}

function percentile(values, proportion) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * proportion) - 1));
  return sorted[index];
}
