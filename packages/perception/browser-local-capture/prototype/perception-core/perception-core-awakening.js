import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const CLIP_DURATIONS_MS = Object.freeze({
  Dormant: 2000,
  AskOpen: 600,
  WatchOpen: 570,
  MicroscopeOpen: 630,
  HoldForCamera: 2500,
  RevealCamera: 720,
  PermissionDenied: 535,
  ReturnToDormant: 300
});
const MODE_CLIPS = Object.freeze({
  conversation: "AskOpen",
  observing: "WatchOpen",
  microscope: "MicroscopeOpen"
});
const ACTIVATION_CLIPS = new Set([
  "AskOpen",
  "WatchOpen",
  "MicroscopeOpen",
  "RevealCamera",
  "PermissionDenied",
  "ReturnToDormant"
]);
const MIN_REVEAL_DELAY_MS = 600;
const ACTIVATION_FRAME_INTERVAL_MS = 1000 / 60;

export function classifyCameraStartFailure(error) {
  const value = `${error?.name || ""} ${error?.message || ""}`.toLowerCase();
  return /notallowed|permission|denied|security/.test(value) ? "permission-denied" : "error";
}

export function createFirstFrameWait(video, options = {}) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs || 5000));
  if (!video) return Promise.resolve();
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let frameRequestId = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener?.("loadeddata", onReady);
      video.removeEventListener?.("canplay", onReady);
      video.removeEventListener?.("error", onError);
      if (frameRequestId !== null && error && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameRequestId);
      }
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const onError = () => finish(new Error("Camera preview could not render its first frame."));
    const timer = setTimeout(
      () => finish(new Error("Camera preview first frame timed out.")),
      timeoutMs
    );

    video.addEventListener?.("loadeddata", onReady);
    video.addEventListener?.("canplay", onReady);
    video.addEventListener?.("error", onError);
    if (typeof video.requestVideoFrameCallback === "function") {
      frameRequestId = video.requestVideoFrameCallback(() => finish());
    }
    onReady();
  });
}

export class PerceptionCoreAwakening {
  constructor({
    host,
    canvas,
    assetUrl = "./assets/blender/optical-iris-bloom/optical-iris-bloom.glb",
    reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  } = {}) {
    this.host = host || null;
    this.canvas = canvas || null;
    this.assetUrl = assetUrl;
    this.reducedMotion = reducedMotion;
    this.stage = this.host?.closest?.(".sf-camera-stage") || null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.model = null;
    this.mixer = null;
    this.clips = new Map();
    this.seamNodes = [];
    this.currentAction = null;
    this.currentClipName = "Dormant";
    this.state = "loading";
    this.startedAt = 0;
    this.renderStartedAt = 0;
    this.rafId = null;
    this.lastFrameAt = 0;
    this.framesRendered = 0;
    this.activationFrames = 0;
    this.activeAt = 0;
    this.renderTimes = [];
    this.resizeObserver = null;
    this.sequence = 0;
    this.pendingTimer = null;
    this.visibilityListener = () => this.handleVisibilityChange();
    this.pageHideListener = () => this.destroy();
    this.ready = this.initialize();
  }

  async initialize() {
    if (!this.host || !this.canvas) return false;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power"
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
      this.camera.position.set(0, 0, 11.3);
      this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x58718f, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 2.15);
      key.position.set(2.8, 3.4, 6.4);
      this.scene.add(key);
      const ice = new THREE.PointLight(0x7ebeff, 3.6, 12, 2);
      ice.position.set(-2.2, 1.3, 3.4);
      this.scene.add(ice);
      const sensorLight = new THREE.PointLight(0x4d9cff, 2.6, 9, 2);
      sensorLight.position.set(2.8, -2.1, 3.2);
      this.scene.add(sensorLight);

      const gltf = await new GLTFLoader().loadAsync(this.assetUrl);
      this.model = gltf.scene;
      this.model.rotation.x = Math.PI / 2;
      this.model.rotation.z = Math.PI;
      this.model.scale.setScalar(1);
      this.model.traverse((node) => {
        if (!node.isMesh) return;
        if (node.name.startsWith("IrisSeam_")) {
          node.material.depthTest = true;
          node.material.depthWrite = true;
          node.renderOrder = 2;
          this.seamNodes.push(node);
        }
      });
      this.scene.add(this.model);
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) this.clips.set(clip.name, clip);
      this.resize();
      requestAnimationFrame(() => this.resize());
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
      this.state = "dormant";
      this.setDatasetState("dormant");
      this.playClip("Dormant");
      this.stopRenderLoop();
      document.addEventListener("visibilitychange", this.visibilityListener);
      globalThis.addEventListener?.("pagehide", this.pageHideListener, { once: true });
      return true;
    } catch (error) {
      this.state = "fallback";
      this.setDatasetState("fallback");
      console.error("Perception Core asset could not initialize.", error);
      return false;
    }
  }

  async begin(mode = "conversation") {
    const sequence = ++this.sequence;
    clearTimeout(this.pendingTimer);
    this.startedAt = performance.now();
    this.activeAt = 0;
    this.activationFrames = 0;
    this.host?.setAttribute("data-mode", mode);
    this.state = "awakening";
    this.setDatasetState("awakening");
    if (!(await this.ready) || sequence !== this.sequence) return;
    const openingClip = MODE_CLIPS[mode] || MODE_CLIPS.conversation;
    this.playClip(openingClip, this.reducedMotion
      ? { durationMs: 180, startRatio: 0.62, crossFadeMs: 10 }
      : { durationMs: CLIP_DURATIONS_MS[openingClip] });
    this.startRenderLoop();
    const holdDelay = this.reducedMotion ? 180 : CLIP_DURATIONS_MS[openingClip];
    this.pendingTimer = setTimeout(() => {
      if (sequence !== this.sequence || this.state !== "awakening") return;
      this.state = "holding";
      this.setDatasetState("holding");
      this.playClip("HoldForCamera", this.reducedMotion
        ? { durationMs: 1000, startRatio: 0.4, crossFadeMs: 10 }
        : undefined);
    }, holdDelay);
  }

  async signalCameraReady() {
    const sequence = this.sequence;
    if (!(await this.ready)) {
      if (sequence !== this.sequence) return;
      this.state = "active";
      this.activeAt = performance.now();
      this.setDatasetState("active");
      return;
    }
    if (sequence !== this.sequence) return;
    const elapsed = performance.now() - this.startedAt;
    const wasHolding = this.state === "holding";
    const minimumDelayMs = this.reducedMotion ? 180 : MIN_REVEAL_DELAY_MS;
    const delay = Math.max(0, minimumDelayMs - elapsed);
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      if (sequence !== this.sequence) return;
      this.state = "revealing";
      this.setDatasetState("revealing");
      const revealDurationMs = this.reducedMotion ? 360 : CLIP_DURATIONS_MS.RevealCamera;
      const revealStartRatio = wasHolding ? 0.24 : this.reducedMotion ? 0.3 : 0;
      const revealRemainingMs = Math.round(revealDurationMs * (1 - revealStartRatio));
      const elapsedAtReveal = performance.now() - this.startedAt;
      const minimumActivationMs = this.reducedMotion ? 400 : 1250;
      const completionDelayMs = Math.max(
        revealRemainingMs,
        minimumActivationMs - elapsedAtReveal
      );
      this.playClip("RevealCamera", {
        durationMs: revealDurationMs,
        startRatio: revealStartRatio,
        crossFadeMs: this.reducedMotion ? 10 : 40
      });
      this.startRenderLoop();
      this.pendingTimer = setTimeout(() => {
        if (sequence !== this.sequence) return;
        this.state = "active";
        this.activeAt = performance.now();
        this.setDatasetState("active");
        this.stopRenderLoop();
      }, completionDelayMs);
    }, delay);
  }

  async fail(error) {
    const sequence = ++this.sequence;
    clearTimeout(this.pendingTimer);
    const failureState = classifyCameraStartFailure(error);
    this.state = failureState;
    this.setDatasetState(failureState);
    if (!(await this.ready) || sequence !== this.sequence) return;
    this.playClip("PermissionDenied");
    this.startRenderLoop();
    this.pendingTimer = setTimeout(() => {
      if (sequence !== this.sequence) return;
      this.playClip("ReturnToDormant");
      this.state = "returning";
      this.setDatasetState("returning");
      this.pendingTimer = setTimeout(() => {
        if (sequence !== this.sequence) return;
        this.state = "dormant";
        this.setDatasetState("dormant");
        this.playClip("Dormant");
        this.stopRenderLoop();
      }, this.reducedMotion ? 120 : CLIP_DURATIONS_MS.ReturnToDormant);
    }, this.reducedMotion ? 160 : CLIP_DURATIONS_MS.PermissionDenied);
  }

  async returnToDormant({ immediate = false } = {}) {
    const sequence = ++this.sequence;
    clearTimeout(this.pendingTimer);
    if (!(await this.ready) || sequence !== this.sequence) return;
    this.startRenderLoop();
    if (immediate || this.reducedMotion) {
      this.state = "dormant";
      this.setDatasetState("dormant");
      this.playClip("Dormant");
      this.stopRenderLoop();
      return;
    }
    this.state = "returning";
    this.setDatasetState("returning");
    this.playClip("ReturnToDormant");
    this.pendingTimer = setTimeout(() => {
      if (sequence !== this.sequence) return;
      this.state = "dormant";
      this.setDatasetState("dormant");
      this.playClip("Dormant");
      this.stopRenderLoop();
    }, CLIP_DURATIONS_MS.ReturnToDormant);
  }

  playClip(name, options = {}) {
    const clip = this.clips.get(name);
    if (!clip || !this.mixer) return;
    const nextAction = this.mixer.clipAction(clip);
    nextAction.reset();
    nextAction.setLoop(name === "Dormant" || name === "HoldForCamera" ? THREE.LoopRepeat : THREE.LoopOnce);
    nextAction.clampWhenFinished = name !== "Dormant" && name !== "HoldForCamera";
    nextAction.enabled = true;
    const durationMs = Math.max(16, Number(options.durationMs || CLIP_DURATIONS_MS[name]));
    nextAction.setEffectiveTimeScale(clip.duration / (durationMs / 1000));
    nextAction.time = clip.duration * Math.min(0.95, Math.max(0, Number(options.startRatio || 0)));
    if (this.currentAction && this.currentAction !== nextAction) {
      const crossFadeMs = Number(options.crossFadeMs ?? (this.reducedMotion ? 10 : 110));
      this.currentAction.crossFadeTo(nextAction, crossFadeMs / 1000, false);
    }
    nextAction.play();
    this.currentAction = nextAction;
    this.currentClipName = name;
  }

  setDatasetState(value) {
    for (const seam of this.seamNodes) seam.visible = value !== "fallback";
    if (this.stage) this.stage.dataset.perceptionCoreState = value;
    if (this.host) this.host.dataset.state = value;
  }

  startRenderLoop() {
    if (this.rafId !== null || document.hidden || !this.renderer) return;
    this.renderStartedAt ||= performance.now();
    const tick = (time) => {
      this.rafId = null;
      if (document.hidden || !this.renderer || this.state === "active") return;
      const activation = ACTIVATION_CLIPS.has(this.currentClipName) || this.state === "awakening";
      const minInterval = activation ? ACTIVATION_FRAME_INTERVAL_MS : 1000 / 20;
      if (time - this.lastFrameAt >= minInterval) {
        const deltaSeconds = Math.min(0.05, Math.max(0, time - this.lastFrameAt) / 1000);
        this.mixer?.update(deltaSeconds);
        const renderStart = performance.now();
        this.renderer.render(this.scene, this.camera);
        this.renderTimes.push(performance.now() - renderStart);
        if (this.renderTimes.length > 180) this.renderTimes.shift();
        this.lastFrameAt = time;
        this.framesRendered += 1;
        if (activation) this.activationFrames += 1;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopRenderLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  resize() {
    if (!this.renderer || !this.host) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const mobile = globalThis.innerWidth <= 600;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, mobile ? 1.25 : 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  handleVisibilityChange() {
    if (document.hidden) this.stopRenderLoop();
    else if (!["active", "dormant", "fallback"].includes(this.state)) this.startRenderLoop();
  }

  snapshot() {
    const sortedRenderTimes = [...this.renderTimes].sort((left, right) => left - right);
    const percentile = (value) => sortedRenderTimes.length
      ? sortedRenderTimes[Math.min(sortedRenderTimes.length - 1, Math.floor(sortedRenderTimes.length * value))]
      : 0;
    return {
      state: this.state,
      clip: this.currentClipName,
      reducedMotion: this.reducedMotion,
      framesRendered: this.framesRendered,
      activationFrames: this.activationFrames,
      activationDurationMs: this.activeAt > this.startedAt ? Math.round(this.activeAt - this.startedAt) : null,
      renderTimeP50Ms: Number(percentile(0.5).toFixed(2)),
      renderTimeP95Ms: Number(percentile(0.95).toFixed(2)),
      rendererActive: this.rafId !== null,
      assetReady: Boolean(this.model),
      resourceCount: this.renderer
        ? this.renderer.info.memory.geometries + this.renderer.info.memory.textures
        : 0
    };
  }

  destroy() {
    ++this.sequence;
    clearTimeout(this.pendingTimer);
    this.stopRenderLoop();
    this.resizeObserver?.disconnect();
    this.model?.traverse?.((node) => {
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material?.dispose?.();
    });
    document.removeEventListener("visibilitychange", this.visibilityListener);
    globalThis.removeEventListener?.("pagehide", this.pageHideListener);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
  }
}

export function mountPerceptionCoreAwakening(documentRoot = document) {
  const host = documentRoot.querySelector("#perceptionCoreAwakening");
  const canvas = documentRoot.querySelector("#perceptionCoreCanvas");
  if (!host || !canvas) return null;
  return new PerceptionCoreAwakening({ host, canvas });
}
