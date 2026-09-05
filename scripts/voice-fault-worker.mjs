// Integration fault injection: real local WS/router/SQLite; only provider boundary is fake.
import express from "express";
import { createServer } from "node:http";
import WebSocket from "ws";
import assert from "node:assert/strict";
import { demoRouter } from "../server/demo.js";
import { attachVoice, intelligenceRouter } from "../server/live.js";
import { db } from "../server/database.js";
const app = express();
app.use(express.json());
app.use("/api/demo", demoRouter);
app.use("/api/intelligence", intelligenceRouter);
const server = createServer(app);
let options,
  replyCount = 0;
let openingRequests = 0;
let groqRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => {
  if (String(url).includes("api.groq.com")) {
    groqRequests++;
    throw Error("Live flow must not contact Groq");
  }
  // Protocol faults must not depend on live weather/market availability.
  if (!/^http:\/\/127\.0\.0\.1:/.test(String(url)))
    return Promise.reject(Error("Public source unavailable (fault-test fixture)"));
  return originalFetch(url, ...args);
};
const audio = Buffer.alloc(2400).toString("base64");
const emit = (c) => options.callbacks.onmessage({ serverContent: c });
function reply(text = "Reply") {
  emit({
    outputTranscription: { text },
    modelTurn: { parts: [{ inlineData: { data: audio } }] },
    generationComplete: true,
  });
  emit({ turnComplete: true });
  replyCount++;
}
attachVoice(server, {
  inputMode: "provider", // This harness injects protocol events, not acoustic PCM.
  connectLive: async (p) => {
    options = p;
    return {
      sendClientContent: () => {
        const attempt = ++openingRequests;
        queueMicrotask(() =>
          attempt === 1
            ? emit({ generationComplete: true, turnComplete: true })
            : reply("Hello"),
        );
      },
      sendRealtimeInput: (m) => {
        if (m.text) {
          queueMicrotask(() => reply("Hello"));
          return;
        }
        if (!m.audio) return;
        const command = JSON.parse(
          Buffer.from(m.audio.data, "base64").toString(),
        );
        if (command.cancel) {
          p.callbacks.onmessage({
            toolCallCancellation: { ids: [command.cancel] },
          });
          return;
        }
        emit({ inputTranscription: { text: command.text, finished: true } });
        if (command.inputOnly) return;
        if (command.tool) {
          p.callbacks.onmessage({
            toolCall: {
              functionCalls: [
                {
                  id: command.id,
                  name: command.tool,
                  args: command.args || {},
                },
              ],
            },
          });
          if (command.correction)
            emit({ inputTranscription: { text: command.correction } });
          if (command.cancelImmediately)
            p.callbacks.onmessage({
              toolCallCancellation: { ids: [command.id] },
            });
        } else if (command.interrupt) {
          emit({ interrupted: true });
          reply("Correction heard");
        } else reply("Answer received");
      },
      sendToolResponse: (r) => {
        const result = r.functionResponses[0].response;
        reply(
          result.error ? "Not saved: " + result.error : JSON.stringify(result),
        );
      },
      close: () => {},
    };
  },
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const root = `http://127.0.0.1:${server.address().port}`;
async function req(path, body) {
  const r = await fetch(root + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.status < 400, true, await r.clone().text());
  return r.json();
}
const call = await req("/api/demo/calls", { cropId: 1, language: "English" });
const ws = new WebSocket(root.replace("http", "ws") + "/api/live");
const events = [];
ws.on("message", (b) => events.push(JSON.parse(b)));
async function until(fn) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) throw Error("Fault test stalled");
    await new Promise((r) => setTimeout(r, 5));
  }
}
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ type: "start", id: call.id }));
await until(() => events.some((e) => e.type === "audio"));
assert.equal(
  openingRequests,
  2,
  "empty opening must recover before farmer input",
);
let seq = 0;
function send(command) {
  ws.send(
    JSON.stringify({
      type: "audio",
      seq: seq++,
      data: Buffer.from(JSON.stringify(command)).toString("base64"),
    }),
  );
}
try {
  for (let i = 0; i < 25; i++) {
    const count = replyCount;
    send({
      text:
        i % 2 ? "Yes." : "This is a longer response with a pause and context.",
      interrupt: i % 5 === 0,
    });
    await until(() => replyCount > count);
  }
  // Rapid back-and-forth: enqueue twenty turns without waiting for each response.
  const rapidStart = replyCount;
  for (let i = 0; i < 20; i++) send({ text: "Turn " + i });
  await until(() => replyCount === rapidStart + 20);
  // Invalid model arguments must resolve with a tool error, with no external request.
  let count = replyCount;
  send({ text: "650 kg, two days", tool: "prepare_stock", id: "failed" });
  await until(() => replyCount > count);
  assert.equal(
    db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,
    1000,
  );
  // A queued proposal cannot overwrite a correction that arrived before processing.
  count = replyCount;
  send({
    text: "650 kg",
    tool: "prepare_stock",
    id: "stale",
    args: { quantityKg: 650, storageDays: 2 },
    correction: "Actually 800 kg",
  });
  await until(() => replyCount > count);
  assert.equal(
    db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,
    1000,
  );
  const afterStale = await req(`/api/demo/calls/${call.id}`);
  assert.equal(afterStale.pending, null);
  // Cancellation before dispatch must skip the job and allow the next proposal.
  send({
    text: "650 kilograms and 2 days",
    tool: "prepare_stock",
    id: "cancelled",
    args: { quantityKg: 650, storageDays: 2 },
    cancelImmediately: true,
  });
  await until(() =>
    events.some(
      (e) => e.type === "transcript" && e.input.includes("650 kilograms"),
    ),
  );
  send({
    text: "Actually 650 kilograms, two days.",
    tool: "prepare_stock",
    id: "fresh",
    args: { quantityKg: 650, storageDays: 2 },
  });
  await until(() =>
    db
      .prepare("SELECT payload FROM demo_sessions WHERE id=?")
      .get(call.id)
      .payload.includes("preparedAfter"),
  );
  assert.equal(
    db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,
    1000,
  );
  send({ text: "haan", tool: "confirm_stock", id: "confirm" });
  await until(
    () =>
      db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get()
        .quantity_kg === 650,
  );
  const saved = await req(`/api/demo/calls/${call.id}`);
  assert.equal(saved.saved.storageDays, 2);
  // Replay the real failure: a duplicate preparation must not reset readback,
  // and an Urdu-script affirmative must commit even if Gemini repeats prepare.
  count = replyCount;
  send({text:"मेरे पास 1000 किलो हैं और चार दिन सुरक्षित रख सकता हूं।",tool:"prepare_stock",id:"regression-prepare",args:{quantityKg:1000,storageDays:4}});
  await until(() => replyCount > count);
  const prepared = await req(`/api/demo/calls/${call.id}`);
  count = replyCount;
  send({text:"हाँ सही",tool:"prepare_stock",id:"reject-changed-confirmation",args:{quantityKg:999,storageDays:3}});
  await until(() => replyCount > count);
  assert.deepEqual((await req(`/api/demo/calls/${call.id}`)).pending,{quantityKg:1000,storageDays:4});
  assert.equal(db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,650);
  count = replyCount;
  send({text:"कृपया जानकारी दोबारा बताएं",tool:"prepare_stock",id:"regression-repeat",args:{quantityKg:1000,storageDays:4}});
  await until(() => replyCount > count);
  assert.equal((await req(`/api/demo/calls/${call.id}`)).preparedAfter, prepared.preparedAfter);
  assert.equal(db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,650);
  count = replyCount;
  send({text:"ہاں صحیح ہے۔ <noise>",tool:"prepare_stock",id:"regression-confirm",args:{quantityKg:1000,storageDays:4}});
  await until(() => replyCount > count);
  assert.equal(db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,1000);
  assert.equal((await req(`/api/demo/calls/${call.id}`)).saved.storageDays,4);
  // The other exact phrase from the user's call follows the explicit confirm path.
  count = replyCount;
  send({text:"Actually 650 kg and two days",tool:"prepare_stock",id:"hindi-prepare",args:{quantityKg:650,storageDays:2}});
  await until(() => replyCount > count);
  count = replyCount;
  send({text:"हां सही।",tool:"confirm_stock",id:"hindi-confirm"});
  await until(() => replyCount > count);
  assert.equal(db.prepare("SELECT quantity_kg FROM crops WHERE id=1").get().quantity_kg,650);
  const trace = await req(`/api/intelligence/calls/${call.id}/diagnostics`);
  assert.equal(trace.sequenceGaps, 0);
  assert.ok(trace.events.some((e) => e.type === "generation_complete"));
  assert.ok(trace.events.some((e) => e.type === "tool_cancel"));
  await req(`/api/demo/calls/${call.id}/end`, {});
  const receipt = await req(`/api/demo/calls/${call.id}/receipt`);
  assert.match(receipt.title, /Confirmed/);
  assert.ok(
    events.some(
      (e) => e.type === "transcript" && e.output && e.inputUpdated === false,
    ),
  );
  assert.equal(groqRequests, 0);
  const firstTool = events.findIndex((e) => e.type === "working");
  const firstUpdate = events.findIndex(
    (e, i) => i > firstTool && e.type === "updated",
  );
  const firstToolAudio = events.findIndex(
    (e, i) => i > firstTool && e.type === "audio",
  );
  assert.ok(
    firstUpdate < firstToolAudio,
    "tool status must precede an immediate provider reply, never overwrite it",
  );
  console.log(
    JSON.stringify({
      passed: true,
      emptyOpeningRecovered: true,
      normalTurns: 25,
      rapidTurns: 20,
      interruptions: 5,
      invalidArguments: 1,
      rejectedStaleResults: 1,
      cancelledJobs: 1,
      groqRequests,
      replies: replyCount,
      packetGaps: trace.sequenceGaps,
      confirmedKg: saved.saved.quantityKg,
    }),
  );
} finally {
  ws.close();
  await new Promise((r) => setTimeout(r, 20));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
