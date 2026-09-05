import test from "node:test";
import assert from "node:assert/strict";
import { voiceDecision } from "../server/services/voice-decision.js";

const context = () => ({
  farmer: { quantity_kg: 500, storage_days: 2, maturity: "Ready" },
  weather: {
    source: "Open-Meteo",
    daily: [{ date: "2026-09-05", rainProbability: 80 }],
  },
  market: {
    available: true,
    ageDays: 1,
    current: 24,
    source: "AGMARKNET 2.0",
    arrivalDate: "2026-09-04",
  },
});
test("advice combines rain, dated market evidence and current storage without invented price trends", () => {
  const decision = voiceDecision(context());
  assert.equal(decision.action, "CHECK QUOTES AND PROTECT STOCK");
  assert.match(decision.reasons.join(" "), /80%/);
  assert.match(decision.reasons.join(" "), /2026-09-04/);
  assert.equal(decision.priceForecastAvailable, false);
  assert.deepEqual(decision.missing, []);
});
test("new confirmed storage or sold-out stock immediately changes the decision", () => {
  const data = context();
  data.farmer.storage_days = 0;
  assert.equal(voiceDecision(data).action, "ARRANGE SALE TODAY");
  data.farmer.quantity_kg = 0;
  assert.equal(voiceDecision(data).action, "NO STOCK TO SELL");
});
test("unavailable weather and stale mandi prices never supply recommendation evidence", () => {
  const data = context();
  data.weather = { source: "demo", rainProbability: 99 };
  data.market.ageDays = 10;
  const decision = voiceDecision(data);
  assert.equal(decision.missing.length, 2);
  assert.doesNotMatch(decision.reasons.join(" "), /99%|₹24/);
});
