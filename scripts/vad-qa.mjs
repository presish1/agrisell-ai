import assert from "node:assert/strict";
import {
  VadPool,
  createVoiceIngress,
} from "../server/services/voice-ingress.js";
import { SpeechGate } from "../server/services/speech-gate.js";
import { speechFixture, noiseFixture, mixNoise } from "./audio-fixtures.mjs";
const pool = new VadPool();
await pool.ready;
try {
  const fixtures = [
    ["silence", Buffer.alloc(96000), false],
    ["fan + clicks", noiseFixture(), false],
  ];
  for (const [name, text, voice] of [
    ["yes", "Yes.", "Samantha"],
    ["haan", "हाँ।", "Lekha"],
    ["Hindi quantity", "पाँच सौ किलो टमाटर बचे हैं।", "Lekha"],
    [
      "English stock",
      "I have six hundred and fifty kilograms. Two days.",
      "Samantha",
    ],
  ]) {
    const pcm = await speechFixture(text, voice);
    fixtures.push([name, pcm, true], [name + " + noise", mixNoise(pcm), true]);
  }
  let call = 0;
  const times = [];
  for (const [name, pcm, expected, outputActive] of fixtures.flatMap((f) => [
    [...f, false],
    [f[0] + " during playback", f[1], f[2], true],
  ])) {
    let starts = 0,
      ends = 0,
      forwarded = 0,
      max = 0;
    const gate = new SpeechGate({
      isOutputActive: () => outputActive,
      onStart: () => starts++,
      onEnd: () => ends++,
      onAudio: () => forwarded++,
    });
    const padded = Buffer.concat([
      Buffer.alloc(16000),
      pcm,
      Buffer.alloc(32000),
    ]);
    call++;
    for (let i = 0; i < padded.length; i += 1024) {
      const frame = Buffer.alloc(1024);
      padded.copy(frame, 0, i, i + 1024);
      const r = await pool.process(call, frame);
      times.push(r.inferenceMs);
      max = Math.max(max, r.probability);
      gate.push(frame, r.probability);
    }
    pool.release(call);
    console.log(
      JSON.stringify({
        name,
        starts,
        ends,
        forwardedFrames: forwarded,
        maxProbability: +max.toFixed(3),
      }),
    );
    assert.equal(starts > 0, expected, name);
    assert.equal(ends, starts, name);
  }
  times.sort((a, b) => a - b);
  // Exercise the actual asynchronous ingress with per-call recurrent state,
  // not only the synchronous segmentation class. A second call receives noise.
  function channel() {
    const stats = { starts: 0, ends: 0, frames: 0, errors: [], maxQueueMs: 0 };
    const input = createVoiceIngress(pool, {
      onStart: () => stats.starts++,
      onEnd: () => stats.ends++,
      onAudio: () => {},
      onError: (e) => stats.errors.push(e.message),
      onMetric: (type, d) => {
        if (type === "vad_frame") {
          stats.frames++;
          stats.maxQueueMs = Math.max(stats.maxQueueMs, d.queueMs);
        }
      },
    });
    return { input, stats };
  }
  const spoken = channel(),
    ambient = channel();
  const noise = noiseFixture(1);
  try {
    for (let turn = 0; turn < 25; turn++) {
      const pcm = fixtures[2 + (turn % 8)][1];
      const bytes = Buffer.concat([
        Buffer.alloc(16000),
        pcm,
        Buffer.alloc(32000),
      ]);
      for (let pos = 0; pos < bytes.length; pos += 1024) {
        const frame = Buffer.alloc(1024);
        bytes.copy(frame, 0, pos, pos + 1024);
        const before = spoken.stats.frames;
        spoken.input.push(frame);
        ambient.input.push(noise.subarray(0, 1024));
        const deadline = Date.now() + 2000;
        while (
          spoken.stats.frames <= before ||
          ambient.stats.frames <= before
        ) {
          assert.equal(
            spoken.stats.errors.length + ambient.stats.errors.length,
            0,
          );
          if (Date.now() > deadline)
            throw Error("Ingress stopped making progress");
          await new Promise((r) => setImmediate(r));
        }
      }
      assert.equal(spoken.stats.ends, turn + 1);
    }
    assert.equal(spoken.stats.starts, 25);
    assert.equal(ambient.stats.starts, 0);
    console.log(
      JSON.stringify({
        continuousIngressTurns: 25,
        isolatedNoiseCall: true,
        spoken: spoken.stats,
        ambient: ambient.stats,
      }),
    );
  } finally {
    spoken.input.close();
    ambient.input.close();
  }
  console.log(
    JSON.stringify({
      frames: times.length,
      inferenceP50Ms: times[Math.floor(times.length * 0.5)],
      inferenceP95Ms: times[Math.floor(times.length * 0.95)],
      passed: true,
    }),
  );
} finally {
  pool.close();
}
