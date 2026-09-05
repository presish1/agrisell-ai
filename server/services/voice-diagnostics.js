export class ReplyWatch {
  constructor() {
    this.waiting = false;
    this.lastProgress = 0;
    this.warned = false;
  }
  progress(now = Date.now()) {
    this.waiting = true;
    this.lastProgress = now;
    this.warned = false;
  }
  complete() {
    this.waiting = false;
  }
  check(now = Date.now()) {
    if (!this.waiting) return null;
    if (now - this.lastProgress >= 30000) return "timeout";
    if (!this.warned && now - this.lastProgress >= 6000) {
      this.warned = true;
      return "slow";
    }
    return null;
  }
}
export class VoiceDiagnostics {
  constructor() {
    this.events = [];
    this.packets = 0;
    this.sequenceGaps = 0;
    this.lastSequence = null;
    this.lastInput = null;
    this.latencies = [];
    this.turn = 0;
    this.lastActivityEnd = null;
    this.activityLatencies = [];
    this.outputChunks = [];
    this.playbackChunks = [];
    this.lastOutputAt = null;
    this.vadStats = {
      frames: 0,
      speechFrames: 0,
      maxQueueMs: 0,
      inferenceMs: [],
      maxProbability: 0,
    };
  }
  event(type, detail = {}, now = Date.now()) {
    this.events.push({ type, at: now, turn: this.turn, ...detail });
    if (this.events.length > 250) this.events.shift();
    if (type === "input") this.lastInput = now;
    if (type === "activity_end") this.lastActivityEnd = now;
    if (type === "first_audio" && this.lastActivityEnd !== null) {
      this.activityLatencies.push(now - this.lastActivityEnd);
      this.lastActivityEnd = null;
    }
    if (type === "first_audio" && this.lastInput !== null) {
      this.latencies.push(now - this.lastInput);
      this.lastInput = null;
    }
    if (type === "turn_complete") this.turn++;
    if (this.latencies.length > 30) this.latencies.shift();
    if (this.activityLatencies.length > 30) this.activityLatencies.shift();
  }
  packet(seq) {
    this.packets++;
    if (Number.isInteger(seq)) {
      if (this.lastSequence !== null && seq !== this.lastSequence + 1)
        this.sequenceGaps++;
      this.lastSequence = seq;
    }
  }
  audio(bytes, now = Date.now()) {
    // Bounded timing metadata only; never persist raw farmer/provider audio.
    this.outputChunks.push({
      at: now,
      turn: this.turn,
      durationMs: bytes / 48,
      gapMs: this.lastOutputAt === null ? null : now - this.lastOutputAt,
    });
    this.lastOutputAt = now;
    if (this.outputChunks.length > 512) this.outputChunks.shift();
  }
  playback(detail, now = Date.now()) {
    this.playbackChunks.push({ ...detail, at: now, turn: this.turn });
    if (this.playbackChunks.length > 512) this.playbackChunks.shift();
  }
  vad({ probability, inferenceMs, queueMs }) {
    const v = this.vadStats;
    v.frames++;
    v.maxProbability = Math.max(v.maxProbability, probability);
    if (probability >= 0.5) v.speechFrames++;
    v.maxQueueMs = Math.max(v.maxQueueMs, queueMs);
    v.inferenceMs.push(inferenceMs);
    if (v.inferenceMs.length > 256) v.inferenceMs.shift();
  }
  snapshot() {
    return {
      packets: this.packets,
      sequenceGaps: this.sequenceGaps,
      transcriptToFirstAudioMs: this.latencies,
      providerActivityEndToFirstAudioMs: this.activityLatencies,
      vad: this.vadStats,
      outputChunks: this.outputChunks,
      playbackChunks: this.playbackChunks,
      events: this.events,
    };
  }
}
