import {
  appendTraceEvents,
  createLiveSymbolicTrace,
  exportTraceToReplayFixture,
  type AdapterLatencyRecord,
  type BrowserLatencyRecord,
  type LiveSymbolicTrace,
  type ReplayFixture,
  type StableEvent,
  type TraceOrigin,
  validateStableEvent
} from "../../../perception/live-perception-adapter/src/index.ts";

export type LiveTraceRecorder = {
  appendEvents(events: StableEvent[], latency?: AdapterLatencyRecord | null): void;
  appendBrowserLatency(record: BrowserLatencyRecord): void;
  setTraceOrigin(traceOrigin: TraceOrigin): void;
  getTrace(): LiveSymbolicTrace;
  exportFixture(options?: LiveTraceExportOptions): ReplayFixture;
  getStatus(): LiveTraceRecorderStatus;
};

export type LiveTraceExportOptions = {
  fixtureId?: string;
  name?: string;
  description?: string;
  createdBy?: string;
  maxReplayRuntimeMs?: number;
};

export type LiveTraceRecorderStatus = {
  status: "recording" | "exported" | "error";
  trace_id: string;
  event_count: number;
  raw_video_persisted: false;
  raw_audio_persisted: false;
  raw_frame_persisted: false;
  cloud_calls: 0;
  browser_latency_record_count: number;
  trace_origin?: TraceOrigin;
  last_error?: string;
};

export function createLiveTraceRecorder(traceId: string, sessionId: string, traceOrigin?: TraceOrigin): LiveTraceRecorder {
  return new DefaultLiveTraceRecorder(traceId, sessionId, traceOrigin);
}

class DefaultLiveTraceRecorder implements LiveTraceRecorder {
  private readonly trace: LiveSymbolicTrace;
  private status: LiveTraceRecorderStatus["status"] = "recording";
  private lastError: string | undefined;

  constructor(traceId: string, sessionId: string, traceOrigin?: TraceOrigin) {
    this.trace = createLiveSymbolicTrace(traceId, sessionId, traceOrigin);
  }

  appendEvents(events: StableEvent[], latency?: AdapterLatencyRecord | null): void {
    try {
      for (const event of events) {
        const validation = validateStableEvent(event);
        if (!validation.valid) throw new Error(validation.error);
      }
      appendTraceEvents(this.trace, events, latency);
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  appendBrowserLatency(record: BrowserLatencyRecord): void {
    this.trace.metrics.browser_latency_records.push(record);
  }

  setTraceOrigin(traceOrigin: TraceOrigin): void {
    this.trace.trace_origin = traceOrigin;
  }

  getTrace(): LiveSymbolicTrace {
    return structuredClone(this.trace);
  }

  exportFixture(options: LiveTraceExportOptions = {}): ReplayFixture {
    try {
      const fixture = exportTraceToReplayFixture(this.trace, options);
      this.status = "exported";
      return fixture;
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  getStatus(): LiveTraceRecorderStatus {
    const base = {
      status: this.status,
      trace_id: this.trace.trace_id,
      event_count: this.trace.events.length,
      raw_video_persisted: false as const,
      raw_audio_persisted: false as const,
      raw_frame_persisted: false as const,
      cloud_calls: 0 as const,
      browser_latency_record_count: this.trace.metrics.browser_latency_records.length,
      ...(this.trace.trace_origin ? { trace_origin: this.trace.trace_origin } : {})
    };
    return this.lastError ? { ...base, last_error: this.lastError } : base;
  }
}
