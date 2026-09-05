import test from "node:test";
import assert from "node:assert/strict";
import { connectRecoverable } from "../server/services/live-connection.js";
test("opening content is committed once and fails explicitly after close", async () => {
  const writes = [];
  const live = await connectRecoverable(
    async (p) => {
      return { sendClientContent: (c) => writes.push(c), close() {} };
    },
    { config: {}, callbacks: { onmessage() {}, onclose() {} } },
  );
  live.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "Greet once" }] }],
    turnComplete: true,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].turnComplete, true);
  live.close();
  assert.throws(
    () => live.sendClientContent({ turnComplete: true }),
    /disconnected/,
  );
});
const tick = () => new Promise((r) => setImmediate(r));
test("tool delivery during reconnect or after close fails explicitly, never reports false success", async () => {
  let params;
  const live = await connectRecoverable(
    async (p) => {
      params = p;
      return {
        close() {},
        sendToolResponse() {
          assert.fail("must not deliver");
        },
      };
    },
    { config: {}, callbacks: { onmessage() {}, onclose() {} } },
  );
  params.callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "safe" },
  });
  params.callbacks.onclose({ code: 1006 });
  assert.throws(
    () => live.sendToolResponse({ functionResponses: [] }),
    /disconnected/,
  );
  await tick();
  live.close();
  assert.throws(
    () => live.sendToolResponse({ functionResponses: [] }),
    /disconnected/,
  );
});
test("transient disconnect resumes clean checkpoint, suppresses old socket events, no replay", async () => {
  const attempts = [],
    states = [],
    events = [],
    writes = [];
  const connect = async (p) => {
    attempts.push(p);
    return {
      sendRealtimeInput: (x) => writes.push(x),
      sendToolResponse: () => {},
      close: () => {},
    };
  };
  const live = await connectRecoverable(
    connect,
    {
      config: {},
      callbacks: {
        onmessage: (e) => events.push(e),
        onclose: () => assert.fail("should resume"),
      },
    },
    (s) => states.push(s),
  );
  attempts[0].callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "checkpoint" },
  });
  attempts[0].callbacks.onclose({ code: 1006 });
  await tick();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].config.sessionResumption.handle, "checkpoint");
  assert.ok(states.includes("reconnected"));
  attempts[0].callbacks.onmessage({ stale: true });
  assert.equal(
    events.some((e) => e.stale),
    false,
  );
  assert.equal(writes.length, 0);
  live.close();
});
test("unsafe unacknowledged speech cannot resume/replay a stale checkpoint", async () => {
  let p,
    ended = false;
  const live = await connectRecoverable(
    async (params) => {
      p = params;
      return { sendRealtimeInput: () => {}, close: () => {} };
    },
    {
      config: {},
      callbacks: {
        onmessage: () => {},
        onclose: () => {
          ended = true;
        },
      },
    },
  );
  p.callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "old" },
  });
  live.sendRealtimeInput({
    audio: { data: Buffer.from([0, 10]).toString("base64") },
  });
  p.callbacks.onclose({ code: 1006 });
  await tick();
  assert.equal(ended, true);
  live.close();
});
test("model callback exception is surfaced instead of silently abandoning a turn", async () => {
  let p, reason;
  const live = await connectRecoverable(
    async (params) => {
      p = params;
      return { close: () => {} };
    },
    {
      config: {},
      callbacks: {
        onmessage: () => {
          throw Error("bad event");
        },
        onclose: (e) => {
          reason = e.reason;
        },
      },
    },
  );
  p.callbacks.onmessage({ serverContent: {} });
  assert.match(reason, /processing failed/);
  live.close();
});
test("unresolved SDK setup is bounded; late session is closed and late events ignored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve,
    p,
    closed = 0,
    events = 0;
  const pending = connectRecoverable(
    (params) => {
      p = params;
      return new Promise((r) => {
        resolve = r;
      });
    },
    { config: {}, callbacks: { onmessage: () => events++, onclose: () => {} } },
  );
  const failure = assert.rejects(pending, /12 seconds/);
  t.mock.timers.tick(12000);
  await failure;
  p.callbacks.onmessage({ serverContent: {} });
  resolve({ close: () => closed++ });
  await tick();
  assert.equal(closed, 1);
  assert.equal(events, 0);
});
test("failed resume explicitly closes the call rather than leaving reconnecting forever", async () => {
  const attempts = [];
  let reason;
  const live = await connectRecoverable(
    async (p) => {
      attempts.push(p);
      if (attempts.length === 2) throw Error("network unavailable");
      return { close: () => {} };
    },
    {
      config: {},
      callbacks: { onmessage: () => {}, onclose: (e) => (reason = e.reason) },
    },
  );
  attempts[0].callbacks.onmessage({
    sessionResumptionUpdate: { resumable: true, newHandle: "safe" },
  });
  attempts[0].callbacks.onclose({ code: 1012 });
  await tick();
  assert.match(reason, /reconnection failed/);
  live.close();
});
test("reconnect attempts are bounded across a long session", async () => {
  const attempts = [];
  let ended = 0;
  const live = await connectRecoverable(
    async (p) => {
      attempts.push(p);
      return { close: () => {} };
    },
    { config: {}, callbacks: { onmessage: () => {}, onclose: () => ended++ } },
  );
  for (let i = 0; i < 3; i++) {
    attempts[i].callbacks.onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: "checkpoint" + i },
    });
    attempts[i].callbacks.onclose({ code: 1006 });
    await tick();
  }
  assert.equal(attempts.length, 3);
  assert.equal(ended, 1);
  live.close();
});
test("socket error without a close event cannot wait indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let p,
    ended = 0;
  const live = await connectRecoverable(
    async (x) => {
      p = x;
      return { close: () => {} };
    },
    { config: {}, callbacks: { onmessage: () => {}, onclose: () => ended++ } },
  );
  p.callbacks.onerror({});
  t.mock.timers.tick(2500);
  assert.equal(ended, 1);
  live.close();
});
