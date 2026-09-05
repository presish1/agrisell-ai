import test from "node:test";
import assert from "node:assert/strict";
import { boundedRead, voiceFacts } from "../server/services/latency.js";
test("slow read returns fallback without blocking the voice turn", async () => {
  const start = Date.now();
  assert.equal(
    await boundedRead(new Promise(() => {}), 25, "unavailable"),
    "unavailable",
  );
  assert.ok(Date.now() - start < 500);
});
test("fast read keeps real data", async () =>
  assert.equal(
    await boundedRead(Promise.resolve("live"), 1000, "fallback"),
    "live",
  ));
test("voice facts never treat missing weather or recorded prices as live", () => {
  const report = voiceFacts({
    farmer: {
      crop: "Tomato",
      quantity_kg: 650,
      storage_days: 2,
      current_price: 24,
    },
    weather: { available: false },
    market: { available: false },
  });
  assert.match(report, /not a live buyer quote/);
  assert.match(report, /Weather lookup unavailable/);
  assert.match(report, /650 kg/);
});
