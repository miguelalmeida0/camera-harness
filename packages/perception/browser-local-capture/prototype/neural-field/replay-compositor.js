const DEFAULT_DURATION_MS = 12_000;
const MAX_DURATION_MS = 30_000;

export class LocalReplayCompositor {
  constructor(input = {}, legacyOptions = {}) {
    const options = input?.registerFrameConsumer ? { ...legacyOptions, renderer: input } : input;
    this.renderer = options.renderer || null;
    this.video = options.video || null;
    const rendererCanvas = this.renderer?.getCanvas?.() || this.renderer?.canvas || null;
    this.canvas = options.canvas && options.canvas !== rendererCanvas
      ? options.canvas
      : globalThis.document?.createElement?.("canvas") || options.canvas || null;
    this.context = this.canvas?.getContext?.("2d") || null;
    this.MediaRecorderClass = options.MediaRecorderClass || options.MediaRecorder || globalThis.MediaRecorder;
    this.maxDurationMs = Math.min(MAX_DURATION_MS, Math.max(250, Number(options.maxDurationMs || DEFAULT_DURATION_MS)));
    this.fps = Math.min(60, Math.max(15, Number(options.fps || 30)));
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.blob = null;
    this.recording = false;
    this.disposed = false;
    this.durationMs = 0;
    this.startedAt = 0;
    this.timer = null;
    this.unsubscribeFrame = null;
    this.stopPromise = null;
    this.resolveStop = null;
    this.session = 0;
    this.discardOnStop = true;
  }

  async start(options = {}) {
    if (this.disposed) throw new Error("Replay compositor is disposed.");
    if (options.consent !== true) throw new Error("Explicit replay consent is required.");
    if (this.recording) return this.getState();
    if (!this.canvas?.captureStream || !this.context || typeof this.MediaRecorderClass !== "function") {
      throw new Error("Local replay recording is unavailable.");
    }
    this.discard();
    this.durationMs = Math.min(this.maxDurationMs, Math.max(250, Number(options.durationMs || DEFAULT_DURATION_MS)));
    this.sizeCanvas();
    this.stream = this.canvas.captureStream(this.fps);
    const mimeType = chooseMimeType(this.MediaRecorderClass, options.mimeType);
    this.recorder = new this.MediaRecorderClass(this.stream, mimeType ? { mimeType } : {});
    const recorder = this.recorder;
    const session = ++this.session;
    this.chunks = [];
    this.blob = null;
    this.discardOnStop = false;
    recorder.ondataavailable = (event) => {
      if (!this.disposed && session === this.session && recorder === this.recorder && event?.data?.size > 0) this.chunks.push(event.data);
    };
    this.stopPromise = new Promise((resolve) => {
      this.resolveStop = resolve;
      recorder.onstop = () => {
        if (session !== this.session || recorder !== this.recorder) {
          resolve(null);
          return;
        }
        const type = recorder.mimeType || mimeType || "video/webm";
        this.blob = !this.discardOnStop && !this.disposed && this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.recording = false;
        this.releaseStream();
        this.resolveStop?.(this.blob);
        this.resolveStop = null;
      };
    });
    this.unsubscribeFrame = this.renderer?.registerFrameConsumer?.(() => this.composeFrame()) || null;
    this.composeFrame();
    this.recorder.start();
    this.recording = true;
    this.startedAt = monotonicNow();
    this.timer = globalThis.setTimeout?.(() => void this.stop({ discard: true }), this.durationMs) || null;
    return this.getState();
  }

  async stop(options = {}) {
    const discard = options.discard !== false;
    this.discardOnStop = this.discardOnStop || discard;
    if (this.timer) globalThis.clearTimeout?.(this.timer);
    this.timer = null;
    if (!this.recorder) {
      this.recording = false;
      this.releaseStream();
      if (discard) this.discard();
      return discard ? null : this.blob;
    }
    if (this.recorder.state !== "inactive") this.recorder.stop();
    const blob = this.stopPromise ? await this.stopPromise : this.blob;
    if (discard) {
      this.discard();
      return null;
    }
    return blob;
  }

  composeFrame() {
    if (!this.recording && !this.recorder) return false;
    this.sizeCanvas();
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.context.clearRect?.(0, 0, width, height);
    if (this.video && Number(this.video.readyState || 0) >= 2) {
      this.context.drawImage?.(this.video, 0, 0, width, height);
    } else {
      this.context.fillStyle = "#090916";
      this.context.fillRect?.(0, 0, width, height);
    }
    const source = this.renderer?.getSnapshot?.()?.disposed === false
      ? this.rendererCanvas()
      : null;
    if (source?.width && source?.height) this.context.drawImage?.(source, 0, 0, width, height);
    return true;
  }

  rendererCanvas() {
    return this.renderer?.canvas || this.renderer?.getCanvas?.() || null;
  }

  sizeCanvas() {
    if (!this.canvas) return;
    const source = this.rendererCanvas();
    const width = Math.max(1, Number(source?.width || this.video?.videoWidth || this.canvas.width || 1));
    const height = Math.max(1, Number(source?.height || this.video?.videoHeight || this.canvas.height || 1));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  discard() {
    this.chunks.length = 0;
    this.blob = null;
    return this.getState();
  }

  getState() {
    return {
      recording: this.recording,
      durationMs: this.durationMs,
      maxDurationMs: this.maxDurationMs,
      hasRecording: Boolean(this.blob),
      localOnly: true,
      uploadEnabled: false,
      discardByDefault: true,
      disposed: this.disposed
    };
  }

  getSnapshot() {
    return this.getState();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.recorder) await this.stop({ discard: true });
    if (this.timer) globalThis.clearTimeout?.(this.timer);
    this.timer = null;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.releaseStream();
    this.discard();
    this.session += 1;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
    }
    this.recorder = null;
    this.stopPromise = null;
    this.resolveStop = null;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
  }

  releaseStream() {
    for (const track of this.stream?.getTracks?.() || []) track.stop?.();
    this.stream = null;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
  }
}

function chooseMimeType(Recorder, preferred) {
  const candidates = [preferred, "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter(Boolean);
  if (typeof Recorder.isTypeSupported !== "function") return candidates.at(-1) || "";
  return candidates.find((item) => Recorder.isTypeSupported(item)) || "";
}

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}
