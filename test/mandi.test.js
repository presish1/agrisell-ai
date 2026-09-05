import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenAgmarknetReport,
  normalizeMandiRecord,
  parseArrivalDate,
  summarizeMandiRecords,
  summarizeVegetableRecords,
} from "../server/services/mandi.js";

const row = (overrides = {}) => ({
  state: "Maharashtra",
  district: "Nashik",
  market: "Lasalgaon",
  commodity: "Onion",
  variety: "Red",
  grade: "FAQ",
  arrival_date: "04/09/2026",
  min_price: "1800",
  max_price: "2400",
  modal_price: "2200",
  ...overrides,
});

test("AGMARKNET rows are validated and converted from rupees/quintal to rupees/kg", () => {
  assert.deepEqual(normalizeMandiRecord(row()), {
    state: "Maharashtra",
    district: "Nashik",
    market: "Lasalgaon",
    commodity: "Onion",
    variety: "Red",
    grade: "FAQ",
    arrivalDate: "2026-09-04",
    minPrice: 18,
    maxPrice: 24,
    modalPrice: 22,
  });
  assert.equal(parseArrivalDate("31/02/2026"), null);
  assert.equal(normalizeMandiRecord(row({ modal_price: "0" })), null);
});

test("latest matching observations produce transparent market evidence", () => {
  const signal = summarizeMandiRecords(
    [
      row({ market: "Lasalgaon", modal_price: "2200" }),
      row({ market: "Pimpalgaon", modal_price: "2800", max_price: "3000", variety: "Other" }),
      row({ arrival_date: "03/09/2026", modal_price: "9900" }),
      row({ district: "Pune", modal_price: "50000" }),
      row({ commodity: "Tomato", modal_price: "50000" }),
    ],
    {
      crop: "Onion",
      state: "Maharashtra",
      district: "Nashik",
      now: Date.parse("2026-09-05T06:00:00Z"),
    },
  );
  assert.equal(signal.current, 25);
  assert.equal(signal.average, 25);
  assert.equal(signal.records, 2);
  assert.equal(signal.markets, 2);
  assert.equal(signal.arrivalDate, "2026-09-04");
  assert.equal(signal.alternative, null);
  assert.equal(signal.observations[0].market, "Pimpalgaon");
});

test("stale, mismatched and malformed records never become live prices", () => {
  const options = {
    crop: "Onion",
    state: "Maharashtra",
    district: "Nashik",
    now: Date.parse("2026-09-05T06:00:00Z"),
  };
  assert.equal(
    summarizeMandiRecords([row({ arrival_date: "01/09/2026" })], options),
    null,
  );
  assert.equal(
    summarizeMandiRecords([row({ district: "Pune" })], options),
    null,
  );
});

test("vegetable board groups produce, removes cross-resource duplicates and excludes fruit", () => {
  const onion = row();
  const tomato = row({
    commodity: "Tomato",
    market: "Pimpalgaon",
    modal_price: "2600",
    max_price: "2800",
  });
  const prices = summarizeVegetableRecords(
    [onion, { ...onion }, tomato, row({ commodity: "Grapes" })],
    {
      state: "Maharashtra",
      district: "Nashik",
      now: Date.parse("2026-09-05T06:00:00Z"),
    },
  );
  assert.deepEqual(
    prices.map((price) => [price.commodity, price.records]),
    [
      ["Onion", 1],
      ["Tomato", 1],
    ],
  );
});

test("invalid price ranges and future publication dates are not displayed", () => {
  assert.equal(normalizeMandiRecord(row({min_price:"2400"})), null);
  assert.equal(normalizeMandiRecord(row({max_price:"2000"})), null);
  assert.equal(summarizeMandiRecords([row({arrival_date:"06/09/2026"})], {crop:"Onion",state:"Maharashtra",district:"Nashik",now:Date.parse("2026-09-05T06:00:00Z")}), null);
});

test("a partial new-day report does not erase another vegetable's recent dated observation", () => {
  const prices = summarizeVegetableRecords([row({arrival_date:"05/09/2026"}),row({commodity:"Tomato",arrival_date:"04/09/2026"})], {state:"Maharashtra",district:"Nashik",now:Date.parse("2026-09-05T06:00:00Z")});
  assert.deepEqual(prices.map(p=>[p.commodity,p.arrivalDate]), [["Onion","2026-09-05"],["Tomato","2026-09-04"]]);
});

test("AGMARKNET 2.0 market reports are converted into the existing validated row format", () => {
  const records = flattenAgmarknetReport(
    {
      states: [
        {
          stateName: "Maharashtra",
          markets: [
            {
              marketName: "APMC Nashik",
              commodities: [
                {
                  commodityName: "Tomato",
                  data: [
                    {
                      variety: "Local",
                      grade: "FAQ",
                      minimumPrice: 1800,
                      maximumPrice: 2600,
                      modalPrice: 2400,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { state: "Maharashtra", district: "Nashik", date: "2026-09-04" },
  );
  assert.deepEqual(normalizeMandiRecord(records[0]), {
    state: "Maharashtra",
    district: "Nashik",
    market: "APMC Nashik",
    commodity: "Tomato",
    variety: "Local",
    grade: "FAQ",
    arrivalDate: "2026-09-04",
    minPrice: 18,
    maxPrice: 26,
    modalPrice: 24,
  });
});
