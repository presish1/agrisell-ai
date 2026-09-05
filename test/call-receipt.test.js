import test from "node:test";
import assert from "node:assert/strict";
import { callReceipt } from "../server/services/call-receipt.js";
const session = {
  id: "call-1",
  name: "Neha",
  crop: "Tomato",
  snapshot: { quantityKg: 900, storageDays: 3, price: 24 },
};
test("only committed stock receives a confirmed receipt", () => {
  const r = callReceipt({
    ...session,
    saved: { quantityKg: 650, storageDays: 2, at: "2026-09-04T09:00:00Z" },
  });
  assert.match(r.title, /Confirmed/);
  assert.match(r.body, /650 kg/);
  assert.match(r.body, /2 safe storage days/);
  assert.equal(r.transport, "in-app");
});
test("unconfirmed proposal cannot appear as a saved update", () => {
  const r = callReceipt({
    ...session,
    pending: { quantityKg: 20, storageDays: 1 },
  });
  assert.doesNotMatch(r.title, /Confirmed/);
  assert.match(r.body, /previous record is unchanged/);
  assert.doesNotMatch(r.body, /20 kg/);
});
test("stale decision advice is excluded from receipt", () => {
  const r = callReceipt({
    ...session,
    saved: { quantityKg: 650, storageDays: 2, at: "2026-09-04T09:00:00Z" },
    lastAdvice: {
      report: "STALE REPORT",
      context: { farmer: { quantity_kg: 900, storage_days: 3 } },
    },
  });
  assert.doesNotMatch(r.body, /STALE REPORT/);
});
test("matching advice carries its source into receipt", () => {
  const r = callReceipt({
    ...session,
    lastAdvice: {
      report: "Rain risk from Open-Meteo.",
      context: {
        farmer: { quantity_kg: 900, storage_days: 3 },
        sources: [
          { name: "Open-Meteo", url: "https://open-meteo.com/en/docs" },
        ],
      },
    },
  });
  assert.match(r.body, /Rain risk/);
  assert.equal(r.sources[0].name, "Open-Meteo");
});
test("receipt removes machine payloads and keeps a readable farmer summary", () => {
  const r = callReceipt({
    ...session,
    saved: { quantityKg: 800, storageDays: 3, at: "2026-09-05T09:00:00Z" },
    lastAdvice: {
      report: "Field desk: 800 kg of Tomato, 3 safe storage days.\nRecorded price ₹24/kg; not a live buyer quote.\nOpen-Meteo forecast for 2026-09-05: 100% rain probability; 3.6 mm expected precipitation.\nAGMARKNET 2.0, 2026-09-05: median modal price ₹19/kg across 1 observations in 1 markets; observed range ₹19–₹19/kg.\nForecast days: [{\"date\":\"2026-09-05\",\"rainProbability\":100}].\nDecision: {\"action\":\"CHECK QUOTES AND PROTECT STOCK\"}.",
      context: { farmer: { quantity_kg: 800, storage_days: 3 }, decision: { action: "CHECK QUOTES AND PROTECT STOCK" }, sources: [] },
    },
  });
  assert.match(r.body, /Open-Meteo forecast/);
  assert.match(r.body, /Recommended next step/);
  assert.doesNotMatch(r.body, /Forecast days: \[/);
  assert.doesNotMatch(r.body, /Decision: \{\"action/);
});
