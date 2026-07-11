import { containsRawMedia } from "./observation-window.mjs";

export function createVisualCompanionMemory(options = {}) {
  const state = {
    mode: options.mode || "session",
    summaries: []
  };
  return {
    state,
    modeVisible() {
      return state.mode;
    },
    setMode(mode) {
      if (!["off", "session", "persistent_opt_in"].includes(mode)) throw new Error("visual_memory_mode_invalid");
      state.mode = mode;
      if (mode === "off") state.summaries = [];
      return state.mode;
    },
    writeSummary(summary) {
      if (state.mode === "off") return { ok: false, code: "visual_memory_off" };
      if (containsRawMedia(summary)) return { ok: false, code: "visual_raw_media_persisted" };
      const text = String(summary?.text || summary || "").slice(0, 280);
      if (!text) return { ok: false, code: "visual_memory_empty" };
      state.summaries.push({ text, created_at_ms: Date.now() });
      state.summaries = state.summaries.slice(-20);
      return { ok: true, text };
    },
    clear() {
      state.summaries = [];
      return { ok: true };
    }
  };
}
