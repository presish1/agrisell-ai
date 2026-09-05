import test from "node:test";
import assert from "node:assert/strict";
import {
  validProposal,
  completeProposal,
  isConfirmation,
  fallbackReply,
} from "../server/services/demo-state.js";
test("invalid or missing model fields cannot corrupt stock", () => {
  assert.deepEqual(
    validProposal({ quantityKg: -20, storageDays: 99 }, { quantityKg: 650 }),
    { quantityKg: 650 },
  );
  assert.deepEqual(validProposal({ quantityKg: null, storageDays: "2" }), {});
  assert.equal(completeProposal({ quantityKg: 650 }), false);
});
test("confirmation must be unambiguous", () => {
  assert.equal(isConfirmation("yes"), true);
  assert.equal(isConfirmation("हाँ सही है।"), true);
  assert.equal(isConfirmation("Yes that's correct."), true);
  assert.equal(isConfirmation("yes, but actually 300 kilograms"), false);
  assert.equal(isConfirmation("do not save"), false);
});
test("recent Hindi call confirmation variants survive script drift and noise markers", () => {
  for (const text of ["हां सही।", "हाँ सही", "ہاں صحیح ہے۔ <noise>", "जी हाँ। [noise]"])
    assert.equal(isConfirmation(text), true, text);
  for (const text of ["हां सही लेकिन 800 किलो", "نہیں", "<noise>", "हाँ नहीं", "yes but 3 days"])
    assert.equal(isConfirmation(text), false, text);
});
test("fallback converts explicit units, not unrelated numbers", () => {
  assert.equal(
    fallbackReply("I have 2 tonnes and can wait 3 days").quantityKg,
    2000,
  );
  assert.equal(fallbackReply("My code is 1234").quantityKg, null);
});
test("sold-out stock has no storage period", () =>
  assert.deepEqual(validProposal({ quantityKg: 0 }, { storageDays: 2 }), {
    quantityKg: 0,
    storageDays: 0,
  }));
