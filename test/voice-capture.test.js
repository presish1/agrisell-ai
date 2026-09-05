import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
test("downsampling rejects high-frequency noise instead of aliasing it into speech", () => {
  let Processor;
  const packets = [];
  vm.runInNewContext(
    readFileSync(
      new URL("../public/voice-capture.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (x) => packets.push(new Int16Array(x)) };
        }
      },
      sampleRate: 48000,
      registerProcessor: (_, p) => {
        Processor = p;
      },
    },
  );
  const mic = new Processor();
  for (let n = 0; n < 48000; n += 128) {
    const frame = new Float32Array(Math.min(128, 48000 - n));
    for (let i = 0; i < frame.length; i++)
      frame[i] = 0.5 * Math.sin((2 * Math.PI * 12000 * (n + i)) / 48000);
    mic.process([[frame]]);
  }
  const samples = packets.slice(1).flatMap((x) => Array.from(x));
  const rms = Math.sqrt(
    samples.reduce((s, x) => s + (x / 32768) ** 2, 0) / samples.length,
  );
  assert.ok(rms < 0.01, `12kHz noise aliases into voice band: rms=${rms}`);
});
for (const rate of [16000, 44100, 48000])
  test(`mic captures every sample at ${rate} Hz in 32ms packets`, () => {
    let Processor;
    const packets = [];
    vm.runInNewContext(
      readFileSync(
        new URL("../public/voice-capture.js", import.meta.url),
        "utf8",
      ),
      {
        AudioWorkletProcessor: class {
          constructor() {
            this.port = { postMessage: (x) => packets.push(x) };
          }
        },
        sampleRate: rate,
        registerProcessor: (_, p) => {
          Processor = p;
        },
      },
    );
    const mic = new Processor();
    for (let n = 0; n < rate; n += 128)
      mic.process([[new Float32Array(Math.min(128, rate - n)).fill(0.25)]]);
    assert.equal(packets.length, 31);
    assert.equal(new Int16Array(packets[0]).length, 512);
    // FIR startup has <2 ms group delay; verify steady-state gain after its warmup.
    assert.ok(Math.abs(new Int16Array(packets[0])[100] - 8192) < 2);
    assert.equal(packets.length * 512 + mic.samples.length, 16000);
  });
test("short utterance, long utterance and natural pauses retain every PCM sample", () => {
  let Processor;
  const packets = [];
  vm.runInNewContext(
    readFileSync(
      new URL("../public/voice-capture.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (x) => packets.push(new Int16Array(x)) };
        }
      },
      sampleRate: 48000,
      registerProcessor: (_, p) => {
        Processor = p;
      },
    },
  );
  const mic = new Processor();
  let samples = 0;
  for (const [length, value] of [
    [4800, 0.2],
    [57600, 0],
    [960000, 0.15],
    [9600, 0],
  ]) {
    samples += length;
    for (let n = 0; n < length; n += 128)
      mic.process([[new Float32Array(Math.min(128, length - n)).fill(value)]]);
  }
  assert.equal(packets.length * 512 + mic.samples.length, samples / 3);
  assert.ok(
    packets.some((p) => p.every((v) => v === 0)),
    "silence must reach provider turn detection",
  );
  assert.ok(
    packets.some((p) => p.every((v) => v > 0)),
    "voiced samples must be retained",
  );
  assert.ok(
    mic.samples.length < 512,
    "worklet buffer stays bounded during long speech",
  );
});
