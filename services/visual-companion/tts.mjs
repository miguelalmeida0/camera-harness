export function createVisualTtsRuntime(options = {}) {
  const state = {
    muted: options.muted === true,
    autoSpeak: false,
    activeText: "",
    history: []
  };
  const localTts = options.localTts || options.kokoro || null;
  return {
    state,
    async speak(response = {}) {
      const text = String(response.spoken_response || "");
      if (!text || state.muted) return { ok: false, code: state.muted ? "visual_tts_muted" : "visual_tts_empty" };
      this.cancel();
      state.activeText = text;
      state.history.push(text);
      if (localTts?.synthesize) {
        await localTts.synthesize(text);
        return { ok: true, path: options.localTts ? "local_tts" : "kokoro_local", spoken_response: text };
      }
      return { ok: false, code: "visual_tts_unavailable" };
    },
    cancel() {
      if (localTts?.cancel) localTts.cancel();
      state.activeText = "";
      return { ok: true };
    },
    setMuted(value) {
      state.muted = value === true;
      if (state.muted) this.cancel();
      return { muted: state.muted };
    },
    replay() {
      const last = state.history.at(-1);
      return last ? this.speak({ spoken_response: last }) : { ok: false, code: "visual_tts_no_replay" };
    }
  };
}
