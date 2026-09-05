export function createRingtone() {
  let context, timer;
  let ringing = false;
  const tones = new Set();
  function chime() {
    if (!context || context.state !== "running") return;
    // Original bell arpeggio, inspired by a phone ringtone, not an Apple recording.
    for (const [index, frequency] of [
      659.25, 783.99, 987.77, 1318.51, 987.77, 783.99, 659.25, 987.77,
    ].entries()) {
      const offset = index * 0.16;
      const osc = context.createOscillator(),
        gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const at = context.currentTime + offset;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.09, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(at);
      osc.stop(at + 0.44);
      tones.add(osc);
      osc.onended = () => {
        tones.delete(osc);
        osc.disconnect();
        gain.disconnect();
      };
    }
  }
  return {
    notify() {
      if (!context || context.state !== "running") return;
      const osc = context.createOscillator(),
        gain = context.createGain();
      osc.frequency.setValueAtTime(1046.5, context.currentTime);
      osc.frequency.setValueAtTime(1318.5, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.4);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    },
    async unlock() {
      context ||= new AudioContext();
      const wasRunning = context.state === 'running';
      await context.resume();
      if (ringing && !wasRunning) chime();
    },
    start() {
      if (ringing) return;
      ringing = true;
      if (!context || context.state !== 'running') this.unlock().catch(() => {});
      else chime();
      timer = setInterval(chime, 2400);
    },
    stop() {
      ringing = false;
      clearInterval(timer);
      for (const osc of tones) {
        try {
          osc.stop();
        } catch {}
      }
      tones.clear();
    },
    close() {
      this.stop();
      context?.close();
    },
  };
}
