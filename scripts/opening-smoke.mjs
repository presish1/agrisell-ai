import "dotenv/config";
import WebSocket from "ws";
import assert from "node:assert/strict";
const root = "http://127.0.0.1:8787/api";
async function req(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(root + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
let crop;
const timings = [];
try {
  const farmer = await req("/farmers", {
    name: "Opening QA",
    phone: "+910000000018",
    location: "Nashik",
    language: "Hindi",
    consent: false,
    crop: "Tomato",
    quantityKg: 1000,
    maturity: "Ready",
    storageDays: 1,
    currentPrice: 24,
  });
  crop = (await req("/farmers")).find((f) => f.id === farmer.id);
  for (let i = 0; i < 6; i++) {
    const call = await req("/demo/calls", {
      cropId: crop.crop_id,
      language: i % 2 ? "English" : "Hindi",
    });
    const ws = new WebSocket("ws://127.0.0.1:8787/api/live");
    try {
      const ms = await new Promise((resolve, reject) => {
        let ready;
        const timer = setTimeout(
          () => reject(Error("Opening audio never arrived")),
          20000,
        );
        ws.on("open", () =>
          ws.send(
            JSON.stringify({
              type: "start",
              id: call.id,
              token: process.env.ADMIN_TOKEN || "",
            }),
          ),
        );
        ws.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        ws.on("message", (raw) => {
          const m = JSON.parse(raw);
          if (m.type === "ready") ready = performance.now();
          if (m.type === "audio") {
            clearTimeout(timer);
            resolve(Math.round(performance.now() - ready));
          }
          if (m.type === "error" || m.type === "closed") {
            clearTimeout(timer);
            reject(Error(m.message));
          }
        });
      });
      assert.ok(ms >= 0);
      timings.push(ms);
    } finally {
      ws.close();
      await req(`/demo/calls/${call.id}/end`, {});
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      consecutiveOpenings: 6,
      readyToFirstAudioMs: timings,
    }),
  );
} finally {
  if (crop)
    await req(
      `/crops/${crop.crop_id}`,
      { quantityKg: 0, currentPrice: 24, storageDays: 0 },
      "PATCH",
    );
}
