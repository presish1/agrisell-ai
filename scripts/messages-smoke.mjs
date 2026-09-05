// Live Gemini + HTTP + SQLite integration. Creates and retires its own QA stock.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}`,
};
async function request(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`http://127.0.0.1:8787/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
let crop;
try {
  const f = await request("/farmers", {
    name: "Messaging QA",
    phone: "+910000000020",
    location: "Nashik",
    language: "English",
    consent: false,
    crop: "Onion",
    quantityKg: 800,
    currentPrice: 24,
    storageDays: 2,
    maturity: "Ready",
  });
  crop = (await request("/farmers")).find((row) => row.id === f.id).crop_id;
  const post = (text, requestId = randomUUID()) =>
    request(`/messages/${crop}`, { text, requestId });
  let r = await post("I have 650 kg left.");
  assert.equal(r.pending, null);
  r = await post("I can keep it for 3 days.");
  assert.deepEqual(r.pending, { quantityKg: 650, storageDays: 3 });
  assert.equal(
    (await request("/farmers")).find((row) => row.crop_id === crop).quantity_kg,
    800,
  );
  const confirmId = randomUUID();
  r = await post("Yes", confirmId);
  assert.equal(r.saved, true);
  assert.match(r.messages.at(-1).text, /updated your stock status in our system/);
  const count = r.messages.length;
  r = await post("Yes", confirmId);
  assert.equal(r.messages.length, count);
  assert.equal(
    (await request("/farmers")).find((row) => row.crop_id === crop).quantity_kg,
    650,
  );
  r = await post("What is the weather and mandi price advice for my stock?");
  assert.equal(r.pending, null);
  assert.match(r.messages.at(-1).text, /Open-Meteo|AGMARKNET/i);
  assert.equal(
    (await request(`/messages/${crop}`)).messages.length,
    r.messages.length,
  );
  await post("Change my stock to 450 kg and 2 safe storage days.");
  await request(
    `/crops/${crop}`,
    { quantityKg: 600, storageDays: 2, currentPrice: 24 },
    "PATCH",
  );
  await assert.rejects(post("Yes"), /changed during/);
  assert.equal(
    (await request("/farmers")).find((row) => row.crop_id === crop).quantity_kg,
    600,
  );
  console.log(
    JSON.stringify({
      passed: true,
      missingField: true,
      confirmedSave: true,
      idempotency: true,
      sourceAdvice: true,
      persistence: true,
      conflictProtected: true,
    }),
  );
} finally {
  if (crop)
    await request(
      `/crops/${crop}`,
      { quantityKg: 0, storageDays: 0, currentPrice: 24 },
      "PATCH",
    );
}
