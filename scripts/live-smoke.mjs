import "dotenv/config";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { speechFixture, mixNoise } from "./audio-fixtures.mjs";
const hindi = process.argv.includes("--hindi");
const noisy = process.argv.includes("--noise");
const shortConfirmation = process.argv.includes("--short-confirmation");
const splitFields = process.argv.includes("--separate-fields");
const withAdvice = process.argv.includes("--advice");
const expectedKg = splitFields ? 500 : 650,
  expectedDays = splitFields ? 1 : 2;
const root = "http://127.0.0.1:8787/api";
async function req(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(root + path, {
    signal: AbortSignal.timeout(8000),
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
}
let crop, call, ws;
try {
  const farmer = await req("/farmers", {
    name: "Live Voice QA",
    phone: "+910000000019",
    location: "Nashik",
    language: hindi ? "Hindi" : "English",
    consent: false,
    crop: "Tomato",
    quantityKg: 1000,
    maturity: "Ready",
    storageDays: 1,
    currentPrice: 24,
  });
  crop = (await req("/farmers")).find((f) => f.id === farmer.id);
  call = await req("/demo/calls", {
    cropId: crop.crop_id,
    language: hindi ? "Hindi" : "English",
  });
  const samples = await Promise.all(
    (splitFields
      ? hindi
        ? ["मेरे पाँच सौ केजी बाकी हैं।", "एक दिन तक।", "हाँ, सही है।"]
        : [
            "I have five hundred kilograms remaining.",
            "One day.",
            "Yes, that is correct.",
          ]
      : hindi
        ? [
            "मेरे पास छह सौ पचास किलो टमाटर बचे हैं। मैं इन्हें दो दिन तक रख सकता हूँ।",
            shortConfirmation ? "हाँ।" : "हाँ, सही है।",
          ]
        : [
            "I have six hundred and fifty kilograms of tomatoes. I can safely store them for two days.",
            "Yes, that is correct.",
          ]
    )
      .concat(
        withAdvice
          ? [
              hindi
              ? "अब मैं इन टमाटरों का क्या करूँ? आज का मौसम भी बताइए।"
              : "What should I do with these tomatoes now? Please check today's weather too.",
            ]
          : [],
      )
      .map(async (text) => {
        const pcm = await speechFixture(text, hindi ? "Lekha" : "Samantha");
        return noisy ? mixNoise(pcm) : pcm;
      }),
  );
  let turns = 0,
    bytes = 0,
    turnBytes = 0,
    adviceRequested = false,
    readyAt,
    openingAudioMs;
  let turnChain = Promise.resolve();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Live call timed out")), 90000);
    ws = new WebSocket("ws://127.0.0.1:8787/api/live");
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          type: "start",
          id: call.id,
          token: process.env.ADMIN_TOKEN || "",
        }),
      ),
    );
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const event = JSON.parse(raw);
      if (event.type === "ready") readyAt = performance.now();
      if (event.type === "audio") {
        bytes += event.data.length;
        turnBytes += event.data.length;
        if (openingAudioMs === undefined)
          openingAudioMs = Math.round(performance.now() - readyAt);
      }
      if (event.type === "error" || event.type === "closed") {
        clearTimeout(timer);
        reject(Error(event.message));
        return;
      }
      const audible = turnBytes > 0;
      if (event.type === "turnComplete") turnBytes = 0;
      turnChain = turnChain.then(async () => {
        try {
          const m = event;
          if (m.type === "error" || m.type === "closed") {
            clearTimeout(timer);
            reject(Error(m.message));
          }
          if (m.type === "transcript" && m.inputUpdated)
            console.log("INPUT", m.input);
          if (m.type === "turnComplete") {
            if (!audible) return; // A bounded empty-opening retry must finish before test input.
            const s = await req(`/demo/calls/${call.id}`);
            console.log("TURN", turns, s.messages.at(-1)?.text);
            if (splitFields && turns === 1) {
              const answer = s.messages.at(-1)?.text || "";
              assert.match(
                answer,
                /दिन|day/i,
                "quantity-only answer must ask for storage, not repeat the greeting",
              );
              assert.doesNotMatch(
                answer,
              /AgriSell|एग्रीसेल|how many kilo|कितने किलो|कितने किलोग्राम/i,
              );
              assert.equal(
                s.pending,
                null,
                "must not infer storage from baseline",
              );
            }
            if (s.saved && (!withAdvice || adviceRequested)) {
              assert.equal(s.saved.quantityKg, expectedKg);
              assert.equal(s.saved.storageDays, expectedDays);
              if (withAdvice)
                assert.ok(
                  s.lastAdvice?.report,
                  "advice must use grounded tool facts",
                );
              assert.ok(bytes > 1000);
              clearTimeout(timer);
              resolve();
              return;
            }
            if (turns >= samples.length + 1) {
              clearTimeout(timer);
              reject(Error("No confirmed stock after three replies"));
              return;
            }
            const pcm =
              s.saved && withAdvice
                ? samples.at(-1)
                : samples[Math.min(turns, samples.length - 1)];
            if (s.saved && withAdvice) adviceRequested = true;
            turns++;
            for (let i = 0; i < pcm.length; i += 2048) {
              ws.send(
                JSON.stringify({
                  type: "audio",
                  data: pcm.subarray(i, i + 2048).toString("base64"),
                }),
              );
              await new Promise((r) => setTimeout(r, 64));
            }
            for (let i = 0; i < 24; i++) {
              ws.send(
                JSON.stringify({
                  type: "audio",
                  data: Buffer.alloc(2048).toString("base64"),
                }),
              );
              await new Promise((r) => setTimeout(r, 64));
            }
          }
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  });
  const changed = (await req("/farmers")).find(
    (f) => f.crop_id === crop.crop_id,
  );
  assert.equal(changed.quantity_kg, expectedKg);
  assert.equal(changed.storage_days, expectedDays);
  await req(`/demo/calls/${call.id}/end`, {});
  const receipt = await req(`/demo/calls/${call.id}/receipt`);
  assert.match(receipt.title, /Confirmed/);
  assert.ok(receipt.body.includes(`${expectedKg} kg`));
  assert.equal(receipt.transport, "in-app");
  assert.deepEqual(await req(`/demo/calls/${call.id}/receipt`), receipt);
  console.log(
    "PASS: Gemini streaming audio + structured stock tool → spoken confirmation → SQLite update",
  );
  const diagnostics = await req(`/intelligence/calls/${call.id}/diagnostics`);
  const timings = diagnostics.vad.inferenceMs.toSorted((a, b) => a - b);
  console.log(
    JSON.stringify({
      language: hindi ? "Hindi" : "English",
      noisy,
      shortConfirmation,
      splitFields,
      withAdvice,
      openingAudioMs,
      speechEndToAudioMs: diagnostics.providerActivityEndToFirstAudioMs,
      transcriptToAudioMs: diagnostics.transcriptToFirstAudioMs,
      vadP95Ms: timings[Math.floor(timings.length * 0.95)],
      maxInputQueueMs: diagnostics.vad.maxQueueMs,
    }),
  );
} finally {
  ws?.close();
  if (call) await req(`/demo/calls/${call.id}/end`, {});
  if (crop)
    await req(
      `/crops/${crop.crop_id}`,
      { quantityKg: 0, currentPrice: 24, storageDays: 0 },
      "PATCH",
    );
}
