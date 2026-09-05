import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePriceHistory} from "../server/services/price-history.js";
import {stockConfirmation} from "../server/services/stock-confirmation.js";
const now = Date.parse("2026-09-05T06:00:00Z");
const rows = Array.from({length:40}, (_,i) => ({arrivalDate:new Date(Date.parse("2026-07-27")+i*86400000).toISOString().slice(0,10),modalPrice:20,market:"Nashik",variety:"Local",grade:"FAQ",commodity:"Tomato"}));
test("walk-forward baseline evaluates held-out daily observations", () => {
  const result = evaluatePriceHistory(rows, now);
  assert.equal(result.available,true);
  assert.equal(result.estimate,20);
  assert.equal(result.targetDate,"2026-09-05");
  assert.equal(result.evaluation.evaluatedPairs,30);
  assert.equal(result.evaluation.maeKg,0);
});
test("a price shock is scored against the previous day, never leaked into its forecast", () => {
  const result = evaluatePriceHistory([...rows.slice(0,-1),{...rows.at(-1),modalPrice:50}],now);
  assert.equal(result.evaluation.maeKg,1);
  assert.equal(result.estimate,50);
});
test("sparse, stale and mixed-variety series cannot claim an evaluated forecast", () => {
  assert.equal(evaluatePriceHistory(rows.slice(0,10),now).available,false);
  assert.equal(evaluatePriceHistory(rows,now+7*86400000).available,false);
  assert.equal(evaluatePriceHistory(rows.map((r,i)=>({...r,variety:String(i%2)})),now).available,false);
});
test("stock confirmations explicitly describe system updates in every supported language", () => {
  const stock={quantityKg:150,storageDays:2};
  assert.match(stockConfirmation("English",stock),/updated your stock status in our system/);
  assert.match(stockConfirmation("Hindi",stock),/सिस्टम.*अपडेट/);
  assert.match(stockConfirmation("Marathi",stock),/सिस्टीममध्ये.*अपडेट/);
});
