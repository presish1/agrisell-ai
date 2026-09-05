import test from "node:test";
import assert from "node:assert/strict";
import {
  openingInstruction,
  liveInstructions,
  databaseSnapshot,
} from "../server/services/call-context.js";
test("new farmer opening is one-shot and does not restate historical stock", () => {
  const farmer = {
    name: "Neha Patil",
    crop: "Onion",
    location: "Lasalgaon",
    quantity_kg: 875,
    storage_days: 3,
    current_price: 21,
    active: 1,
  };
  const hook = openingInstruction({ language: "Hindi" }, farmer);
  for (const value of ["Hindi", "Neha Patil", "Onion", "now connected"])
    assert.ok(hook.includes(value));
  assert.ok(!hook.includes("875"));
  const instruction = liveInstructions({ language: "Hindi" }, { farmer });
  assert.match(instruction, /AFTER the opening, listen/);
  assert.match(instruction, /Greet ONCE/);
  assert.deepEqual(databaseSnapshot(farmer), {
    quantityKg: 875,
    storageDays: 3,
    price: 21,
    active: 1,
  });
});
