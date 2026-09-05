export class VoiceState {
  constructor() {
    this.connected = false;
    this.done = true;
    this.playing = 0;
    this.tool = false;
    this.muted = false;
    this.suspended = false;
    this.notice = "";
    this.captureIssue = "";
    this.transportIssue = "";
    this.micUnavailable = false;
    this.outputMuted = false;
    this.userSpeaking = false;
  }
  event(type, message = {}) {
    if (type === "speechStart") {
      this.userSpeaking = true;
      this.notice = "";
      this.done = false;
    }
    if (type === "speechEnd") {
      this.userSpeaking = false;
      this.done = false;
    }
    if (type === "closed" || type === "reconnecting") this.userSpeaking = false;
    if (
      [
        "ready",
        "audio",
        "generationComplete",
        "turnComplete",
        "waitingForInput",
        "interrupted",
        "reconnecting",
        "reconnected",
        "closed",
      ].includes(type)
    )
      this.notice = "";
    if (type === "input")
      this.notice = message.input ? `Heard: ${message.input}` : "";
    if (type === "ready") {
      this.connected = true;
      this.done = false;
    }
    if (type === "input" || type === "audio") this.done = false;
    if (type === "working") {
      this.tool = true;
      this.done = false;
      this.notice = message.message || "Checking your information…";
    }
    if (type === "updated") {
      this.tool = false;
      this.notice = message.failed
        ? "The check could not complete — waiting for AgriSell’s reply…"
        : "Information checked — waiting for AgriSell’s reply…";
    }
    if (type === "turnComplete") {
      this.done = true;
      this.tool = false;
    }
    if (type === "generationComplete" || type === "waitingForInput") {
      this.done = true;
      this.tool = false;
    }
    if (type === "interrupted") {
      this.playing = 0;
      this.done = false;
      this.tool = false;
    }
    if (type === "closed") this.connected = false;
    if (type === "reconnecting") {
      this.connected = false;
      this.playing = 0;
      this.tool = false;
    }
    if (type === "reconnected") {
      this.connected = true;
      this.done = true;
    }
  }
  label() {
    if (!this.connected) return "Connecting voice…";
    if (this.suspended) return "Audio paused — tap the phone to resume";
    if (this.userSpeaking) return "Listening to you…";
    if (this.playing) return "AgriSell is speaking";
    if (this.tool) return "Checking your information…";
    if (!this.done) return "AgriSell is responding…";
    return this.muted ? "Microphone muted" : "Listening — just speak";
  }
  detail() {
    if (!this.connected) return "Connecting voice…";
    if (this.suspended) return "Audio paused — tap the phone to resume";
    if (this.outputMuted) return "Speaker muted — tap audio to hear AgriSell";
    if (this.micUnavailable) return "Microphone temporarily unavailable";
    if (this.captureIssue) return this.captureIssue;
    if (this.transportIssue) return this.transportIssue;
    if (this.userSpeaking) return "Speech detected — I’m listening";
    if (this.playing)
      return this.muted
        ? "Microphone muted while AgriSell speaks"
        : "You can interrupt — your microphone is listening";
    if (this.done)
      return this.muted ? "Unmute to reply" : "Your turn — just speak";
    return this.notice || "Microphone connected — speak normally";
  }
}
export class PcmQueue {
  constructor(limit = 64) {
    this.limit = limit;
    this.items = [];
    this.sequence = 0;
    this.sent = 0;
    this.peak = 0;
  }
  push(data) {
    if (this.items.length >= this.limit)
      throw new Error(
        "Audio connection is too slow. Please reconnect; some speech could not be sent.",
      );
    this.items.push({ data, seq: this.sequence++ });
    this.peak = Math.max(this.peak, this.items.length);
  }
  drain(send, ready, bufferedAmount, max = 2) {
    if (!ready || bufferedAmount > 32768) return;
    for (let n = 0; n < max && this.items.length; n++) {
      send(this.items[0]);
      this.items.shift();
      this.sent++;
    }
  }
  clear() {
    this.items = [];
  }
}
