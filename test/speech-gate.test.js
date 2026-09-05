import test from "node:test";
import assert from "node:assert/strict";
import { SpeechGate } from "../server/services/speech-gate.js";
import {
  createVoiceIngress,
  VadPool,
} from "../server/services/voice-ingress.js";

function rig() {
  const events = [];
  const gate = new SpeechGate({
    onStart: () => events.push("start"),
    onAudio: (f) => events.push(f),
    onEnd: () => events.push("end"),
  });
  return { gate, events };
}
test("noise/clicks are rejected; short answers preserve initial speech and natural pauses", () => {
  const { gate, events } = rig();
  for (let i = 0; i < 100; i++) gate.push(i, i % 10 === 0 ? 0.9 : 0.1);
  assert.equal(events.length, 0);
  gate.push("first", 0.9);
  gate.push("second", 0.9);
  assert.equal(events[0], "start");
  assert.ok(events.includes("first"));
  for (let i = 0; i < 17; i++) gate.push("pause", 0.1);
  gate.push("continue", 0.9);
  assert.ok(!events.includes("end"));
  for (let i = 0; i < 18; i++) gate.push("silence", 0.1);
  assert.equal(events.at(-1), "end");
  assert.equal(events.filter((x) => x === "end").length, 1);
});
test("50 consecutive short/long turns complete without accumulating state", () => {
  const { gate, events } = rig();
  for (let turn = 0; turn < 50; turn++) {
    for (let i = 0; i < (turn % 2 ? 300 : 2); i++) gate.push("speech", 0.95);
    for (let i = 0; i < 18; i++) gate.push("silence", 0.05);
    assert.equal(gate.active, false);
    assert.equal(gate.prefix.length, 0);
  }
  assert.equal(events.filter((x) => x === "start").length, 50);
  assert.equal(events.filter((x) => x === "end").length, 50);
});
test("weak six-frame bursts cannot cut off the assistant; confirmed interruption retains onset", () => {
  let output = true;
  const events = [];
  const gate = new SpeechGate({
    isOutputActive: () => output,
    onStart: () => events.push("start"),
    onAudio: (f) => events.push(f),
    onEnd: () => events.push("end"),
  });
  // The real call had only six positive frames and triggered at .638; its other
  // probabilities were not logged. Reproduce a weak burst at that confidence.
  for (let turn = 0; turn < 25; turn++) {
    for (const p of [0.63, 0.638, 0.65, 0.66, 0.67, 0.63])
      gate.push("noise", p);
    for (let i = 0; i < 20; i++) gate.push("quiet", 0.05);
  }
  assert.deepEqual(events, []);
  for (let i = 0; i < 5; i++) gate.push(`speech-${i}`, 0.9);
  assert.equal(events[0], "start");
  assert.ok(events.includes("speech-0"));
  assert.ok(events.includes("speech-4"));
  for (let i = 0; i < 18; i++) gate.push("quiet", 0.05);
  assert.equal(events.at(-1), "end");
  output = false;
  gate.push("हाँ onset", 0.7);
  gate.push("हाँ end", 0.7);
  assert.equal(events.filter((e) => e === "start").length, 2);
  assert.ok(events.includes("हाँ onset"));
});
test("reset during interrupted turn cannot emit a stale end", () => {
  const { gate, events } = rig();
  gate.push(1, 0.9);
  gate.push(2, 0.9);
  gate.reset();
  gate.end();
  assert.ok(!events.includes("end"));
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function ingressRig(pool) {
  const events = [];
  const ingress = createVoiceIngress(pool, {
    onStart: () => events.push("start"),
    onAudio: () => events.push("audio"),
    onEnd: () => events.push("end"),
    onMetric: () => {},
    onError: (e) => events.push(e.message),
  });
  return { ingress, events };
}
test("reset ignores pending inference and starts cleanly on next utterance", async () => {
  let resolve;
  const pool = {
    release() {},
    process: (_id, pcm) =>
      new Promise(
        (r) => (resolve = () => r({ pcm, probability: 1, inferenceMs: 0 })),
      ),
  };
  const { ingress, events } = ingressRig(pool);
  ingress.push(Buffer.alloc(1024));
  ingress.reset();
  resolve();
  await tick();
  assert.deepEqual(events, []);
  for (let i = 0; i < 2; i++) {
    ingress.push(Buffer.alloc(1024));
    resolve();
    await tick();
  }
  assert.equal(events[0], "start");
  ingress.close();
});
test("failed inference ends processing explicitly; bounded ingress rejects overload", async () => {
  const failed = ingressRig({
    release() {},
    process: async () => {
      throw Error("inference failed");
    },
  });
  failed.ingress.push(Buffer.alloc(1024));
  await tick();
  assert.deepEqual(failed.events, ["inference failed"]);
  const blocked = ingressRig({
    release() {},
    process: () => new Promise(() => {}),
  });
  blocked.ingress.push(Buffer.alloc(1024));
  assert.throws(
    () => blocked.ingress.push(Buffer.alloc(33 * 1024)),
    /cannot keep up/,
  );
  assert.deepEqual(blocked.events, []);
});
test("worker requests time out instead of retaining unresolved promises", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pool = Object.create(VadPool.prototype);
  Object.assign(pool, {
    ready: Promise.resolve(),
    pending: new Map(),
    counter: 0,
    failed: false,
    worker: { postMessage() {} },
  });
  const promise = pool.process(1, Buffer.alloc(1024));
  const checked = assert.rejects(promise, /stalled/);
  await Promise.resolve();
  t.mock.timers.tick(2001);
  await checked;
  assert.equal(pool.pending.size, 0);
});
