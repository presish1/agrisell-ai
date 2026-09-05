// AudioContext seconds, not wall time. Learn from actual underruns instead of
// re-inserting the same 60 ms gap at every fragmented provider burst.
export class AudioPlayoutClock {
  constructor() {
    this.target = 0.06;
    this.reset();
  }
  reset() {
    this.next = null;
    this.ended = false;
  }
  complete() {
    this.ended = true;
  }
  schedule(now, duration) {
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("Invalid audio duration");
    // Finalized, drained output belongs to a new turn, not a network underrun.
    if (this.ended && this.next <= now) this.reset();
    const first = this.next === null;
    const underrun = first ? 0 : Math.max(0, now - this.next);
    if (underrun > 0) {
      // Grow by measured missing audio; cap at 400 ms (the recorded call had
      // ~390 ms inter-burst holes). Never buffer an entire reply or slow its pitch.
      this.target = Math.min(0.4, this.target + underrun);
    }
    // A large initial packet (Gemini commonly sends 960 ms) already carries
    // its own cushion. Don't impose the previous turn's jitter delay on it.
    const startup = first && duration >= this.target ? 0.06 : this.target;
    const start = first || underrun > 0 ? now + startup : this.next;
    this.next = start + duration;
    return { start, underrunMs: underrun * 1000, bufferMs: this.target * 1000 };
  }
}
