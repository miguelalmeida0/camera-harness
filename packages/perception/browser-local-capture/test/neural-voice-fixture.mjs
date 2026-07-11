export function createNeuralVoiceHarness({ autoEnd = true } = {}) {
  const instances = [];
  const requests = [];
  const revokedUrls = [];
  let activeCount = 0;
  let maxActiveCount = 0;
  let nextUrl = 0;

  class TestAudio {
    constructor(src) {
      this.src = src;
      this.playing = false;
      this.ended = false;
      instances.push(this);
    }

    play() {
      queueMicrotask(() => {
        if (!this.src || this.ended) return;
        this.playing = true;
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        this.onplaying?.();
        if (autoEnd) queueMicrotask(() => this.end());
      });
      return Promise.resolve();
    }

    end() {
      if (this.ended) return;
      this.ended = true;
      if (this.playing) activeCount -= 1;
      this.playing = false;
      this.onended?.();
    }

    pause() {
      if (this.playing) activeCount -= 1;
      this.playing = false;
    }

    removeAttribute(name) {
      if (name === "src") this.src = "";
    }

    load() {}
  }

  const fetch = async (input, init = {}) => {
    const pathname = new URL(String(input), "http://sensefield.test").pathname;
    requests.push({ pathname, body: init.body ? JSON.parse(init.body) : null });
    if (pathname.endsWith("/cancel")) {
      return {
        ok: true,
        headers: { get: () => "application/json" },
        async json() { return { ok: true, cancelled: true }; }
      };
    }
    if (pathname.endsWith("/speak")) {
      const audio = new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" });
      return {
        ok: true,
        headers: {
          get(name) {
            const key = String(name).toLowerCase();
            if (key === "content-type") return "audio/wav";
            if (key === "x-sensefield-audio-duration-ms") return "640";
            if (key === "x-sensefield-voice-engine") return "kokoro_82m";
            return "";
          }
        },
        async blob() { return audio; },
        async json() { return {}; }
      };
    }
    throw new Error(`Unexpected neural voice request: ${pathname}`);
  };

  return {
    instances,
    requests,
    fetch,
    AudioCtor: TestAudio,
    URLApi: {
      createObjectURL() { return `blob:sensefield-test-${++nextUrl}`; },
      revokeObjectURL(url) { revokedUrls.push(url); }
    },
    get activeCount() { return activeCount; },
    get maxActiveCount() { return maxActiveCount; },
    get revokedUrls() { return revokedUrls; },
    get options() { return { fetch, AudioCtor: TestAudio, URLApi: this.URLApi }; }
  };
}
