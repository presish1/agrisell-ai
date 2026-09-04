import "dotenv/config";
import assert from "node:assert/strict";
import { speech, transcribe } from "../server/services/groq.js";
const root = "http://127.0.0.1:8787/api";
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}` };
async function req(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(root + path, {
    method,
    headers: { ...auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}
let crop, session;
try {
  const f = await req("/farmers", {
    name: "Voice Demo QA",
    phone: "+910000000019",
    location: "Nashik",
    language: "English",
    consent: false,
    crop: "Tomato",
    quantityKg: 1000,
    maturity: "Ready",
    storageDays: 1,
    currentPrice: 24,
  });
  crop = (await req("/farmers")).find((row) => row.id === f.id);
  session = await req("/demo/calls", {
    cropId: crop.crop_id,
    language: "English",
  });
  assert.equal(session.status, "ringing");
  session = await req(`/demo/calls/${session.id}/answer`, {});
  assert.equal(session.status, "connected");
  const tts = await fetch(root + `/demo/calls/${session.id}/speech`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: session.messages[0].id }),
  });
  console.log("Call greeting TTS HTTP", tts.status);
  assert.equal(tts.status, 200, "TTS must actually produce audio");
  console.log("Speech provider:", tts.headers.get("x-speech-provider"));
  assert.ok((await tts.arrayBuffer()).byteLength > 1000);
  const spoken = await speech(
    "I currently have six hundred and fifty kilograms of tomatoes left.",
  );
  const transcription = await fetch(
    root + `/demo/calls/${session.id}/transcribe`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "audio/wav" },
      body: spoken.audio,
    },
  );
  const transcript = await transcription.json();
  assert.equal(transcription.status, 200);
  console.log("Whisper transcription:", transcript.text);
  session = await req(`/demo/calls/${session.id}/turn`, {
    text: transcript.text,
  });
  assert.notEqual(
    session.engine,
    "Scripted fallback",
    session.warning || "Groq conversation expected",
  );
  assert.equal(session.pending.quantityKg, 650);
  session = await req(`/demo/calls/${session.id}/turn`, {
    text: "I can safely store them for two days.",
  });
  assert.equal(session.pending.storageDays, 2);
  assert.equal(
    (await req("/farmers")).find((f) => f.crop_id === crop.crop_id).quantity_kg,
    1000,
    "Must not update before confirmation",
  );
  session = await req(`/demo/calls/${session.id}/turn`, { text: "yes" });
  assert.equal(session.saved.quantityKg, 650);
  const changed = (await req("/farmers")).find(
    (f) => f.crop_id === crop.crop_id,
  );
  assert.equal(changed.quantity_kg, 650);
  assert.equal(changed.storage_days, 2);
  console.log(
    "PASS: incoming call → answer → real synthesized speech → real Groq Whisper STT → real Groq conversation → explicit confirmation → SQLite dashboard update",
  );
} finally {
  if (session) await req(`/demo/calls/${session.id}/end`, {});
  if (crop)
    await req(
      `/crops/${crop.crop_id}`,
      { quantityKg: 0, currentPrice: 24, storageDays: 0 },
      "PATCH",
    );
}
