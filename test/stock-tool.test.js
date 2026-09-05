import test from "node:test";
import assert from "node:assert/strict";
import { validateStockEvidence } from "../server/services/stock-tool.js";
test("kg-only speech cannot produce invented storage days, even if model arguments are valid", () => {
  assert.throws(
    () =>
      validateStockEvidence({ quantityKg: 500, storageDays: 0 }, [
        { role: "user", text: "मेरे 500 केजी बाकी हैं।" },
      ]),
    /days have not been stated/,
  );
  const messages = [
    { role: "user", text: "500 kg" },
    { role: "assistant", text: "How many days can you safely store it?" },
    { role: "user", text: "One." },
  ];
  assert.equal(
    validateStockEvidence({ quantityKg: 500, storageDays: 1 }, messages)
      .storageDays,
    1,
  );
  assert.equal(
    validateStockEvidence({ quantityKg: 500, storageDays: 1 }, [
      { role: "user", text: "एक दिन तक।" },
    ]).storageDays,
    1,
  );
  assert.throws(
    () =>
      validateStockEvidence({ quantityKg: 500, storageDays: 1 }, [
        { role: "user", text: "One." },
      ]),
    /not been stated/,
  );
  assert.equal(
    validateStockEvidence({ quantityKg: 0, storageDays: 0 }, []).storageDays,
    0,
  );
});
import {
  prepareStockTool,
  validateStockArguments,
} from "../server/services/stock-tool.js";
test("Gemini receives a typed stock tool and locally validated fields", () => {
  assert.deepEqual(prepareStockTool.parameters.required, [
    "quantityKg",
    "storageDays",
  ]);
  assert.deepEqual(
    validateStockArguments({ quantityKg: 650.5, storageDays: 2 }),
    { quantityKg: 650.5, storageDays: 2 },
  );
  assert.deepEqual(validateStockArguments({ quantityKg: 0, storageDays: 2 }), {
    quantityKg: 0,
    storageDays: 0,
  });
});
test("missing, ambiguous, coercible and out-of-range model fields are rejected", () => {
  for (const args of [
    undefined,
    null,
    [],
    {},
    { quantityKg: 650 },
    { quantityKg: "650", storageDays: 2 },
    { quantityKg: NaN, storageDays: 2 },
    { quantityKg: Infinity, storageDays: 2 },
    { quantityKg: -1, storageDays: 2 },
    { quantityKg: 1000001, storageDays: 2 },
    { quantityKg: 650, storageDays: 8 },
    { quantityKg: 650, storageDays: 1.5 },
    { quantityKg: 650, storageDays: 2, confirmed: true },
  ])
    assert.throws(() => validateStockArguments(args));
});
