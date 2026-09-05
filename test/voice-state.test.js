import test from "node:test";
import assert from "node:assert/strict";
import { VoiceState, PcmQueue } from "../src/voice-state.js";
import {
  ReplyWatch,
  VoiceDiagnostics,
} from "../server/services/voice-diagnostics.js";
import { isConfirmation } from "../server/services/demo-state.js";
test("regression: chunk drains before provider finishes, do not invite premature response", () => {
  const s = new VoiceState();
  s.event("ready");
  s.event("audio");
  s.playing = 1;
  s.playing = 0;
  assert.equal(s.label(), "AgriSell is responding…");
  s.event("generationComplete");
  assert.equal(s.label(), "Listening — just speak");
});
test("generation completes while playback remains: speaking until queue drains", () => {
  const s = new VoiceState();
  s.event("ready");
  s.event("audio");
  s.playing = 5;
  s.event("generationComplete");
  assert.equal(s.label(), "AgriSell is speaking");
  s.playing = 0;
  assert.equal(s.label(), "Listening — just speak");
});
test("50 turns with interruptions, slow tools, mute, suspended audio and late completion reset state", () => {
  const s = new VoiceState();
  s.event("ready");
  for (let i = 0; i < 50; i++) {
    s.event("input");
    s.event("working");
    assert.match(s.label(), /Checking/);
    s.event("updated");
    s.event("audio");
    s.playing = 3;
    if (i % 3 === 0) {
      s.event("interrupted");
      assert.equal(s.playing, 0);
      s.event("audio");
      s.playing = 1;
    }
    s.event("generationComplete");
    s.playing = 0;
    s.event("turnComplete");
    assert.equal(s.label(), "Listening — just speak");
    s.muted = true;
    assert.equal(s.label(), "Microphone muted");
    s.muted = false;
    s.suspended = true;
    assert.match(s.label(), /paused/);
    s.suspended = false;
  }
  s.event("closed");
  s.event("ready");
  assert.match(s.label(), /responding/);
});
test("brief congestion preserves packet order; failed writes retain their packet", () => {
  const q = new PcmQueue(8),
    sent = [];
  for (let i = 0; i < 6; i++) {
    q.push(i);
    q.drain((p) => sent.push(p.seq), true, 99999);
  }
  assert.equal(sent.length, 0);
  assert.throws(() =>
    q.drain(
      () => {
        throw Error("broken socket");
      },
      true,
      0,
    ),
  );
  assert.equal(q.items.length, 6);
  for (let i = 0; i < 3; i++) q.drain((p) => sent.push(p.seq), true, 0);
  assert.deepEqual(sent, [0, 1, 2, 3, 4, 5]);
});
test("sustained overflow is explicit, never silently drops a packet", () => {
  const q = new PcmQueue(2);
  q.push(1);
  q.push(2);
  assert.throws(() => q.push(3), /too slow/);
  assert.equal(q.items.length, 2);
});
test("regression: completed generation cannot trip recovery timer during long playback", () => {
  const w = new ReplyWatch();
  w.progress(0);
  w.complete();
  assert.equal(w.check(40000), null);
  w.progress(50000);
  assert.equal(w.check(56001), "slow");
  assert.equal(w.check(57000), null);
  assert.equal(w.check(80000), "timeout");
});
test("diagnostics distinguish packet gaps and transcript-to-audio latency", () => {
  const d = new VoiceDiagnostics();
  d.packet(0);
  d.packet(2);
  d.event("input", {}, 100);
  d.event("first_audio", {}, 350);
  assert.equal(d.snapshot().sequenceGaps, 1);
  assert.deepEqual(d.snapshot().transcriptToFirstAudioMs, [250]);
});
test("natural confirmations accepted but corrections stay unconfirmed", () => {
  for (const x of ["haan", "ji haan", "Yep.", "Yes, sure!", "हाँ सही है।"])
    assert.equal(isConfirmation(x), true, x);
  for (const x of [
    "haan but 20 kg",
    "yes, actually no",
    "हाँ 200 किलो",
    "not correct",
  ])
    assert.equal(isConfirmation(x), false, x);
});
test("provider waiting-for-input leaves natural pauses idle, not stuck checking", () => {
  const s = new VoiceState(),
    w = new ReplyWatch();
  s.event("ready");
  s.event("input");
  w.progress(0);
  s.event("waitingForInput");
  w.complete();
  assert.equal(w.check(120000), null);
  assert.equal(s.label(), "Listening — just speak");
  s.event("input");
  w.progress(120000);
  assert.match(s.label(), /responding/);
  assert.equal(w.check(150000), "timeout");
});
