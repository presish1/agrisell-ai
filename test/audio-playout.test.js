import test from "node:test";
import assert from "node:assert/strict";
import { AudioPlayoutClock } from "../src/audio-playout.js";

test("25 turns: fast provider chunks stay contiguous with the existing 60 ms startup", () => {
  const p = new AudioPlayoutClock();
  for (let turn = 0; turn < 25; turn++) {
    const now = turn * 5;
    const first = p.schedule(now, 0.96);
    assert.ok(Math.abs(first.start - now - 0.06) < 1e-8);
    let next = first.start + 0.96;
    for (let i = 1; i <= 50; i++) {
      const c = p.schedule(now + i * 0.02, 0.04);
      assert.ok(Math.abs(c.start - next) < 1e-8);
      assert.equal(c.underrunMs, 0);
      next += 0.04;
    }
    p.complete();
  }
});

// Reconstructed burst boundaries from the user's 18:41 call trace. Durations
// are drain - schedule - 60 ms, so this is NOT raw provider-chunk replay and
// includes callback timing error. It reproduces the old scheduler's restart loop.
const recordedBursts = [
  [0, 1796],
  [2246, 247],
  [2815, 270],
  [3404, 270],
  [3893, 214],
  [4390, 237],
  [4809, 324],
  [5419, 168],
  [5699, 407],
  [6343, 160],
  [6644, 168],
  [7068, 198],
  [7359, 152],
  [7827, 278],
  [8336, 439],
  [8841, 166],
  [9209, 164],
  [9552, 593],
  [10224, 322],
  [10659, 324],
  [11131, 322],
  [11673, 601],
];
test("recorded burst pattern: reduce restart loop without waiting for the full reply", () => {
  let oldEnd = 0,
    oldGaps = 0,
    newGaps = 0;
  const p = new AudioPlayoutClock();
  for (const [ms, durationMs] of recordedBursts) {
    const now = ms / 1000;
    if (oldEnd && oldEnd <= now) oldGaps++;
    oldEnd = (oldEnd > now ? oldEnd : now + 0.06) + durationMs / 1000;
    if (p.schedule(now, durationMs / 1000).underrunMs > 0) newGaps++;
  }
  assert.equal(oldGaps, 21);
  assert.equal(newGaps, 8);
  assert.ok(p.next - oldEnd <= 0.4);
  assert.equal(p.target, 0.4);
});
test("interruption/reconnect reset never replays queued or delayed old audio", () => {
  const p = new AudioPlayoutClock();
  p.schedule(0, 10);
  p.reset();
  assert.equal(p.schedule(0.1, 0.2).start, 0.16);
  p.complete();
  // A long idle period is not counted as network jitter in the next turn.
  assert.equal(p.schedule(30, 0.1).underrunMs, 0);
  assert.equal(p.target, 0.06);
});
test("lost/slow events remain bounded; invalid frames do not poison the clock", () => {
  const p = new AudioPlayoutClock();
  p.schedule(0, 0.04);
  for (let i = 1; i <= 100; i++) {
    const r = p.schedule(i * 2, 0.04);
    assert.ok(r.bufferMs <= 400);
    assert.ok(r.start <= i * 2 + 0.4);
  }
  assert.throws(() => p.schedule(201, NaN), /Invalid/);
  assert.ok(Number.isFinite(p.next));
  p.complete();
  assert.equal(p.schedule(205, 0.96).start, 205.06);
});
