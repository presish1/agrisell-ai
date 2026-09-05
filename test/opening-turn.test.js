import test from "node:test";
import assert from "node:assert/strict";
import { OpeningTurn } from "../server/services/opening-turn.js";
function rig() {
  const tasks = [],
    events = [];
  let requests = 0,
    failures = 0;
  const opening = new OpeningTurn({
    send: () => requests++,
    event: (t) => events.push(t),
    exhausted: () => failures++,
    schedule: (f) => tasks.push(f),
  });
  return {
    opening,
    tasks,
    events,
    get requests() {
      return requests;
    },
    get failures() {
      return failures;
    },
  };
}
test("recent-call regression: completed opening with zero audio retries once, not silent success", () => {
  const r = rig();
  r.opening.start();
  assert.equal(r.opening.awaitingAudio, true);
  r.opening.complete();
  r.tasks.shift()();
  assert.equal(r.requests, 2);
  r.opening.audio();
  assert.equal(r.opening.awaitingAudio, false);
  r.opening.complete();
  assert.equal(r.tasks.length, 0);
  assert.equal(r.failures, 0);
});
test("farmer speech overtakes an empty opening: never replay greeting over their answer", () => {
  const r = rig();
  r.opening.start();
  r.opening.complete();
  r.opening.input();
  r.tasks.shift()();
  r.opening.complete();
  assert.equal(r.requests, 1);
  assert.equal(r.failures, 0);
});
test("empty opening retries are bounded; hangup cancels scheduled retry", () => {
  const r = rig();
  r.opening.start();
  r.opening.complete();
  r.tasks.shift()();
  r.opening.complete();
  r.opening.complete();
  assert.equal(r.requests, 2);
  assert.equal(r.failures, 1);
  const h = rig();
  h.opening.start();
  h.opening.complete();
  h.opening.close();
  h.tasks.shift()();
  assert.equal(h.requests, 1);
});
test("audible opening is never retried across 50 subsequent turns", () => {
  const r = rig();
  r.opening.start();
  r.opening.audio();
  for (let i = 0; i < 50; i++) r.opening.complete();
  assert.equal(r.requests, 1);
  assert.equal(r.tasks.length, 0);
});
test("opening retry delivery exception is surfaced instead of an uncaught microtask", () => {
  let count = 0,
    failures = 0;
  const tasks = [];
  const opening = new OpeningTurn({
    send: () => {
      if (++count === 2) throw Error("offline");
    },
    exhausted: () => failures++,
    schedule: (f) => tasks.push(f),
  });
  opening.start();
  opening.complete();
  assert.doesNotThrow(() => tasks.shift()());
  assert.equal(failures, 1);
});
