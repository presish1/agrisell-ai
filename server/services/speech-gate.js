// Streaming speech segmentation. Confidence thresholds follow Silero's defaults;
// retain ~550 ms pause tolerance, rather than splitting natural pauses for speed.
export class SpeechGate {
  constructor({
    onStart,
    onAudio,
    onEnd,
    onMetric = () => {},
    isOutputActive = () => false,
  }) {
    Object.assign(this, { onStart, onAudio, onEnd, onMetric, isOutputActive });
    this.active = false;
    this.prefix = [];
    this.positive = 0;
    this.strong = 0;
    this.certain = 0;
    this.quiet = 0;
    this.frames = 0;
    this.lastSpeech = 0;
  }
  push(frame, probability) {
    this.frames++;
    if (!this.active) {
      this.prefix.push(frame);
      if (this.prefix.length > 10) this.prefix.shift();
      this.positive = probability >= 0.5 ? this.positive + 1 : 0;
      this.strong = probability >= 0.8 ? this.strong + 1 : 0;
      this.certain = probability >= 0.95 ? this.certain + 1 : 0;
      const interrupting = this.isOutputActive();
      // The recorded false barge-ins fired at only .63 confidence after 64 ms.
      // While output is audible require sustained, stronger evidence (160 ms),
      // or 96 ms at >=.95: measured Hindi "हाँ" has only three very-confident
      // frames, and must still be able to interrupt. Do not extend all turns.
      // Idle short answers retain the original 64 ms path. The 320 ms prefix
      // preserves the onset while we confirm an interruption; never mute input.
      if (
        interrupting ? this.strong < 5 && this.certain < 3 : this.positive < 2
      )
        return;
      this.active = true;
      this.quiet = 0;
      this.lastSpeech = this.frames;
      this.onStart();
      for (const pcm of this.prefix) this.onAudio(pcm);
      this.prefix = [];
      this.onMetric("speech_start", {
        probability,
        interrupting,
        evidenceMs:
          (interrupting
            ? this.certain >= 3
              ? this.certain
              : this.strong
            : this.positive) * 32,
      });
      return;
    }
    this.onAudio(frame);
    if (probability >= 0.35) {
      this.quiet = 0;
      this.lastSpeech = this.frames;
    } else this.quiet++;
    if (this.quiet >= 18) this.end();
  }
  end() {
    if (this.active) {
      this.active = false;
      this.onEnd();
      this.onMetric("speech_end", {
        silenceMs: (this.frames - this.lastSpeech) * 32,
      });
    }
    this.prefix = [];
    this.positive = 0;
    this.strong = 0;
    this.certain = 0;
    this.quiet = 0;
  }
  reset() {
    this.active = false;
    this.prefix = [];
    this.positive = 0;
    this.strong = 0;
    this.certain = 0;
    this.quiet = 0;
  }
}
