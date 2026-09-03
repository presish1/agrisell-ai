import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../server/services/decision.js";
test("chooses another mandi after transport costs", () => {
  const r = decide({
    currentPrice: 24,
    marketAverage: 25,
    quantity: 1000,
    storageDays: 0,
    maturity: "Ready",
    weather: { rainProbability: 10 },
    alternative: { name: "Nearby market", price: 29, transportPerKg: 2 },
  });
  assert.equal(r.action, "OTHER MANDI");
  assert.equal(r.expectedGain, 3000);
});
test("small opportunities do not trigger waiting", () => {
  const r = decide({
    currentPrice: 24,
    marketAverage: 24.3,
    quantity: 100,
    storageDays: 2,
    maturity: "Ready",
    weather: { rainProbability: 10 },
  });
  assert.equal(r.action, "SELL NOW");
  assert.equal(r.expectedGain, 0);
});
test("recommends wait for material upside and available storage", () => {
  const r = decide({
    currentPrice: 24,
    marketAverage: 27,
    quantity: 1000,
    storageDays: 2,
    maturity: "Ready",
    weather: { rainProbability: 10 },
  });
  assert.equal(r.action, "WAIT");
  assert.ok(r.expectedGain > 1000);
});
test("recommends sell when farmer cannot wait", () => {
  const r = decide({
    currentPrice: 24,
    marketAverage: 29,
    quantity: 1000,
    storageDays: 0,
    maturity: "Ready",
    weather: { rainProbability: 10 },
  });
  assert.equal(r.action, "SELL NOW");
});
