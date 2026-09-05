// Real ONNX ingress + real WS/router. Only the Gemini boundary is mocked.
import express from "express";
import { createServer } from "node:http";
import WebSocket from "ws";
import assert from "node:assert/strict";
import { demoRouter } from "../server/demo.js";
import { attachVoice, intelligenceRouter } from "../server/live.js";
import { speechFixture, noiseFixture, mixNoise } from "./audio-fixtures.mjs";
const app = express();
app.use(express.json());
app.use("/api/demo", demoRouter);
app.use("/api/intelligence", intelligenceRouter);
const server = createServer(app);
let replies = 0,
  active = false,
  received = 0;
attachVoice(server, {
  inputMode: "local",
  connectLive: async (options) => {
    assert.deepEqual(
      options.config.realtimeInputConfig.automaticActivityDetection,
      { disabled: true },
    );
    return {
      sendClientContent(m) {
        assert.equal(m.turnComplete, true);
        assert.equal(m.turns[0].role, "user");
        assert.equal(
          active,
          false,
          "text opening must not create a fake microphone activity",
        );
        replies++;
        options.callbacks.onmessage({
          serverContent: {
            modelTurn: {
              parts: [
                { inlineData: { data: Buffer.alloc(2400).toString("base64") } },
              ],
            },
            generationComplete: true,
            turnComplete: true,
          },
        });
      },
      close() {},
      sendToolResponse() {},
      sendRealtimeInput(m) {
        assert.equal(
          m.audioStreamEnd,
          undefined,
          "manual activity mode must not send audioStreamEnd",
        );
        if (m.activityStart) {
          assert.equal(active, false);
          active = true;
        }
        if (m.text)
          assert.equal(
            active,
            true,
            "opening text requires explicit activity boundaries",
          );
        if (m.audio) {
          assert.equal(active, true);
          received++;
        }
        if (m.activityEnd) {
          assert.equal(active, true);
          active = false;
          replies++;
          options.callbacks.onmessage({
            serverContent: {
              modelTurn: {
                parts: [
                  {
                    inlineData: { data: Buffer.alloc(2400).toString("base64") },
                  },
                ],
              },
              generationComplete: true,
              turnComplete: true,
            },
          });
        }
      },
    };
  },
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = await fetch(base + "/api/demo/calls", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cropId: 1, language: "Hindi" }),
}).then((r) => r.json());
const ws = new WebSocket(base.replace("http", "ws") + "/api/live");
const errors = [],
  events = [];
ws.on("message", (raw) => {
  const e = JSON.parse(raw);
  events.push(e.type);
  if (e.type === "error") errors.push(e.message);
});
async function until(fn) {
  const end = Date.now() + 5000;
  while (!fn()) {
    assert.deepEqual(errors, []);
    if (Date.now() > end) throw Error("Local input pipeline stalled");
    await new Promise((r) => setTimeout(r, 2));
  }
}
let seq = 0;
async function send(pcm) {
  for (let i = 0; i < pcm.length; i += 1024) {
    const frame = Buffer.alloc(1024);
    pcm.copy(frame, 0, i, i + 1024);
    ws.send(
      JSON.stringify({
        type: "audio",
        seq: seq++,
        data: frame.toString("base64"),
      }),
    );
    await new Promise((r) => setTimeout(r, 2));
  }
}
try {
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "start", id: call.id }));
  await until(() => replies === 1);
  await send(noiseFixture());
  assert.equal(received, 0);
  assert.equal(replies, 1);
  const samples = await Promise.all([
    speechFixture("Yes."),
    speechFixture("हाँ।", "Lekha"),
    speechFixture("I have six hundred and fifty kilograms. Two days."),
  ]);
  for (let i = 0; i < 25; i++) {
    const pcm = i % 2 ? mixNoise(samples[i % 3]) : samples[i % 3];
    await send(Buffer.concat([Buffer.alloc(16000), pcm, Buffer.alloc(32000)]));
    await until(() => replies === i + 2);
  }
  assert.deepEqual(errors, []);
  assert.equal(events.filter((e) => e === "speechStart").length, 25);
  assert.equal(events.filter((e) => e === "speechEnd").length, 25);
  const trace = await fetch(
    `${base}/api/intelligence/calls/${call.id}/diagnostics`,
  ).then((r) => r.json());
  assert.equal(trace.sequenceGaps, 0);
  console.log(
    JSON.stringify({
      passed: true,
      localInputTurns: 25,
      noiseOnlyForwardedFrames: 0,
      receivedSpeechFrames: received,
      packetGaps: trace.sequenceGaps,
    }),
  );
} finally {
  ws.close();
  await new Promise((r) => setTimeout(r, 20));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
