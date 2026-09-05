class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.phase = 0;
    // Blackman-windowed low-pass before decimation: the former 2–3 sample
    // average allowed >8 kHz noise to alias into the 16 kHz speech stream.
    this.history = new Float32Array(63);
    this.cursor = 0;
    this.filter = null;
    if (sampleRate > 16000) {
      this.filter = new Float32Array(63);
      const cutoff = 7200 / sampleRate;
      let gain = 0;
      for (let i = 0; i < 63; i++) {
        const n = i - 31,
          window =
            0.42 -
            0.5 * Math.cos((2 * Math.PI * i) / 62) +
            0.08 * Math.cos((4 * Math.PI * i) / 62);
        this.filter[i] =
          (n === 0
            ? 2 * cutoff
            : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n)) * window;
        gain += this.filter[i];
      }
      for (let i = 0; i < 63; i++) this.filter[i] /= gain;
    }
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input)
      for (const value of input) {
        this.history[this.cursor] = value;
        this.cursor = (this.cursor + 1) % 63;
        this.phase += 16000;
        if (this.phase >= sampleRate) {
          this.phase -= sampleRate;
          let filtered = value;
          if (this.filter) {
            filtered = 0;
            for (let i = 0; i < 63; i++)
              filtered +=
                this.filter[i] * this.history[(this.cursor - 1 - i + 63) % 63];
          }
          this.samples.push(
            Math.max(-32768, Math.min(32767, Math.round(filtered * 32767))),
          );
          if (this.samples.length === 512) {
            const pcm = new Int16Array(this.samples);
            this.port.postMessage(pcm.buffer, [pcm.buffer]);
            this.samples = [];
          }
        }
      }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
