import { Worker } from "node:worker_threads";
import { SpeechGate } from "./speech-gate.js";
let nextCall = 0;
export class VadPool {
  constructor() {
    this.pending = new Map();
    this.counter = 0;
    this.failed = false;
    this.worker = new Worker(new URL("./vad-worker.js", import.meta.url), {
      execArgv: [],
    });
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      this.bootTimer = setTimeout(
        () => this.fail(Error("Speech detector startup timed out")),
        10000,
      );
      this.worker.on("message", (m) => {
        if (m.type === "ready") {
          clearTimeout(this.bootTimer);
          resolve();
          return;
        }
        const job = this.pending.get(m.id);
        if (!job) return;
        this.pending.delete(m.id);
        clearTimeout(job.timer);
        m.error ? job.reject(Error(m.error)) : job.resolve(m);
      });
    });
    this.ready.catch(() => {});
    this.worker.on("error", () =>
      this.fail(Error("Speech detector worker unavailable")),
    );
    this.worker.on("exit", () =>
      this.fail(Error("Speech detector worker stopped")),
    );
    this.worker.unref();
  }
  fail(error) {
    if (this.failed) return;
    this.failed = true;
    clearTimeout(this.bootTimer);
    this.rejectReady(error);
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
    this.worker.terminate();
  }
  async process(callId, bytes) {
    await this.ready;
    if (this.failed) throw Error("Speech detector unavailable");
    if (this.pending.size >= 128) throw Error("Speech detector overloaded");
    const pcm = Uint8Array.from(bytes).buffer,
      id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Speech detection stalled"));
      }, 2000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, callId, pcm }, [pcm]);
    });
  }
  release(callId) {
    if (!this.failed) this.worker.postMessage({ type: "close", callId });
  }
  close() {
    this.fail(Error("Speech detector closed"));
  }
}
export function createVoiceIngress(
  pool,
  { onStart, onAudio, onEnd, onMetric, onError, isOutputActive },
) {
  const callId = ++nextCall;
  let closed = false,
    busy = false,
    queue = [],
    partial = Buffer.alloc(0),
    generation = 0;
  const gate = new SpeechGate({
    onStart,
    onAudio,
    onEnd,
    onMetric,
    isOutputActive,
  });
  async function drain() {
    if (busy || closed) return;
    busy = true;
    try {
      while (queue.length && !closed) {
        const { pcm, version, received } = queue.shift();
        const result = await pool.process(callId, pcm);
        if (closed || version !== generation) continue;
        const elapsed = performance.now() - received;
        onMetric("vad_frame", {
          probability: result.probability,
          inferenceMs: result.inferenceMs,
          queueMs: elapsed,
        });
        gate.push(Buffer.from(result.pcm), result.probability);
      }
    } catch (error) {
      if (!closed) {
        closed = true;
        queue = [];
        gate.reset();
        pool.release(callId);
        onError(error);
      }
    } finally {
      busy = false;
    }
  }
  return {
    push(pcm) {
      if (closed) return;
      if (!pcm.length || pcm.length % 2) throw Error("Invalid PCM frame");
      partial = Buffer.concat([partial, pcm]);
      while (partial.length >= 1024) {
        if (queue.length >= 32) {
          this.close();
          throw Error("Audio processing cannot keep up. Please reconnect.");
        }
        queue.push({
          pcm: Buffer.from(partial.subarray(0, 1024)),
          version: generation,
          received: performance.now(),
        });
        partial = partial.subarray(1024);
      }
      void drain();
    },
    end() {
      generation++;
      queue = [];
      partial = Buffer.alloc(0);
      gate.end();
      pool.release(callId);
    },
    reset() {
      generation++;
      queue = [];
      partial = Buffer.alloc(0);
      gate.reset();
      pool.release(callId);
    },
    close() {
      closed = true;
      generation++;
      queue = [];
      partial = Buffer.alloc(0);
      gate.reset();
      pool.release(callId);
    },
  };
}
