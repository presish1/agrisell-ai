const RESOURCE =
  process.env.DATA_GOV_RESOURCE_ID || "9ef84268-d588-465a-a308-a864a43d0070";
const VARIETY_RESOURCE =
  process.env.DATA_GOV_VARIETY_RESOURCE_ID ||
  "35985678-0d79-46b4-9ed6-6f13308a1d24";
export const MANDI_SOURCE_URL =
  "https://www.data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi";
export const AGMARKNET_SOURCE_URL = "https://agmarknet.gov.in/home";
const AGMARKNET_API = "https://api.agmarknet.gov.in/v1";
const VARIETY_SOURCE_URL =
  "https://www.data.gov.in/resource/variety-wise-daily-market-prices-data-commodity";
const cache = new Map();
let agmarknetFilters;
const VEGETABLES = new Set(
  [
    "Amaranthus",
    "Ashgourd",
    "Beetroot",
    "Bhindi(Ladies Finger)",
    "Bitter gourd",
    "Bottle gourd",
    "Brinjal",
    "Cabbage",
    "Capsicum",
    "Carrot",
    "Cauliflower",
    "Cluster beans",
    "Colacasia",
    "Coriander(Leaves)",
    "Cowpea(Veg)",
    "Cucumbar(Kheera)",
    "Drumstick",
    "Elephant Yam (Suran)",
    "French Beans (Frasbean)",
    "Garlic",
    "Ginger(Green)",
    "Green Chilli",
    "Green Peas",
    "Little gourd (Kundru)",
    "Onion",
    "Onion Green",
    "Peas Wet",
    "Pointed gourd (Parval)",
    "Potato",
    "Pumpkin",
    "Raddish",
    "Ridgeguard(Tori)",
    "Snakeguard",
    "Spinach",
    "Sponge gourd",
    "Sweet Potato",
    "Tinda",
    "Tomato",
    "Turnip",
  ].map((name) => name.toLowerCase()),
);

const value = (record, ...keys) => {
  for (const key of keys) if (record[key] !== undefined) return record[key];
};
export function parseArrivalDate(raw) {
  const match = String(raw || "")
    .trim()
    .match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}
const perKg = (raw) => {
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 && price <= 1000000
    ? +(price / 100).toFixed(2)
    : null;
};
export function normalizeMandiRecord(record) {
  const modal = perKg(value(record, "modal_price", "Modal_x0020_Price"));
  const arrivalDate = parseArrivalDate(
    value(record, "arrival_date", "Arrival_Date"),
  );
  const market = String(value(record, "market", "Market") || "").trim();
  const commodity = String(
    value(record, "commodity", "Commodity") || "",
  ).trim();
  if (!modal || !arrivalDate || !market || !commodity) return null;
  const minPrice = perKg(value(record, "min_price", "Min_x0020_Price"));
  const maxPrice = perKg(value(record, "max_price", "Max_x0020_Price"));
  if ((minPrice !== null && minPrice > modal) || (maxPrice !== null && maxPrice < modal)) return null;
  return {
    state: String(value(record, "state", "State") || "").trim(),
    district: String(value(record, "district", "District") || "").trim(),
    market,
    commodity,
    variety: String(
      value(record, "variety", "Variety") || "Unspecified",
    ).trim(),
    grade: String(value(record, "grade", "Grade") || "Unspecified").trim(),
    arrivalDate,
    minPrice: perKg(value(record, "min_price", "Min_x0020_Price")),
    maxPrice: perKg(value(record, "max_price", "Max_x0020_Price")),
    modalPrice: modal,
  };
}
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
export function summarizeMandiRecords(
  records,
  { crop, state, district, now = Date.now() },
) {
  const normalized = records.map(normalizeMandiRecord).filter(Boolean);
  const matches = normalized.filter(
    (record) =>
      record.commodity.toLowerCase() === crop.toLowerCase() &&
      record.state.toLowerCase() === state.toLowerCase() &&
      record.district.toLowerCase() === district.toLowerCase(),
  );
  if (!matches.length) return null;
  const latestDate = matches
    .map((r) => r.arrivalDate)
    .sort()
    .at(-1);
  const latest = matches.filter((r) => r.arrivalDate === latestDate);
  const ageDays = Math.floor(
    (now - Date.parse(`${latestDate}T00:00:00Z`)) / 86400000,
  );
  const todayIndia = new Date(now + 19800000).toISOString().slice(0, 10);
  if (latestDate > todayIndia || ageDays > 3) return null;
  const modalPrices = latest.map((r) => r.modalPrice);
  return {
    available: true,
    status: "live",
    commodity: crop,
    state,
    district,
    current: +median(modalPrices).toFixed(2),
    average: +(
      modalPrices.reduce((sum, price) => sum + price, 0) / modalPrices.length
    ).toFixed(2),
    low: Math.min(...latest.map((r) => r.minPrice || r.modalPrice)),
    high: Math.max(...latest.map((r) => r.maxPrice || r.modalPrice)),
    records: latest.length,
    markets: new Set(latest.map((r) => r.market)).size,
    varieties: [...new Set(latest.map((r) => r.variety))],
    arrivalDate: latestDate,
    ageDays,
    observations: latest
      .sort((a, b) => b.modalPrice - a.modalPrice)
      .slice(0, 12),
    // Farmer variety and actual logistics are not yet recorded. Do not turn the
    // highest unmatched wholesale observation into a travel recommendation.
    alternative: null,
    source: "AGMARKNET / data.gov.in",
    sourceUrl: MANDI_SOURCE_URL,
    unit: "₹/kg (converted from ₹/quintal)",
    retrievedAt: new Date(now).toISOString(),
  };
}
export function summarizeVegetableRecords(
  records,
  { state, district, now = Date.now() },
) {
  const grouped = new Map();
  const seen = new Set();
  for (const raw of records) {
    const record = normalizeMandiRecord(raw);
    if (!record || !VEGETABLES.has(record.commodity.toLowerCase())) continue;
    const identity = [
      record.state,
      record.district,
      record.market,
      record.commodity,
      record.variety,
      record.grade,
      record.arrivalDate,
      record.modalPrice,
    ].join("\u0000");
    if (seen.has(identity)) continue;
    seen.add(identity);
    const commodity = record.commodity.toLowerCase();
    if (!grouped.has(commodity)) grouped.set(commodity, []);
    grouped.get(commodity).push(raw);
  }
  return [...grouped.values()]
    .map((commodityRecords) => {
      const crop = normalizeMandiRecord(commodityRecords[0]).commodity;
      return summarizeMandiRecords(commodityRecords, {
        crop,
        state,
        district,
        now,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.commodity.localeCompare(b.commodity));
}
export function flattenAgmarknetReport(report, { state, district, date, marketIds }) {
  const [year, month, day] = date.split("-");
  const arrivalDate = `${day}/${month}/${year}`;
  return (report.states || []).flatMap((stateGroup) =>
    (stateGroup.markets || []).filter(market => !marketIds || marketIds.includes(market.marketId)).flatMap((market) =>
      (market.commodities || []).flatMap((commodity) =>
        (commodity.data || []).filter(row => !row.unitOfPrice || /^Rs\.\/Quintal$/i.test(row.unitOfPrice.trim())).map((row) => ({
          state: stateGroup.stateName || state,
          district,
          market: row.marketCenter || market.marketName,
          commodity: commodity.commodityName,
          variety: row.variety || "Unspecified",
          grade: row.grade || "Unspecified",
          arrival_date: arrivalDate,
          min_price: row.minimumPrice,
          max_price: row.maximumPrice,
          modal_price: row.modalPrice,
        })),
      ),
    ),
  );
}

const agmarknetHeaders = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://agmarknet.gov.in",
  Referer: "https://agmarknet.gov.in/",
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36",
};
export async function agmarknetJson(path, options = {}) {
  const response = await fetch(`${AGMARKNET_API}${path}`, {
    ...options,
    headers: { ...agmarknetHeaders, ...options.headers },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error(`AGMARKNET 2.0 HTTP ${response.status}`);
  return response.json();
}
export async function getAgmarknetFilters() {
  if (agmarknetFilters) return agmarknetFilters;
  const response = await agmarknetJson("/daily-price-arrival/filters");
  if (!response.status || !response.data)
    throw Error(response.message || "AGMARKNET filters unavailable");
  agmarknetFilters = response.data;
  return agmarknetFilters;
}
const isoDay = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
async function readAgmarknetDistrict(state, district, force = false) {
  const rawCacheKey = JSON.stringify(["agmarknet2", state, district]);
  const saved = cache.get(rawCacheKey);
  if (!force && saved && saved.expiresAt > Date.now()) return saved.value;
  const filters = await getAgmarknetFilters();
  const stateRow = filters.state_data.find(
    (row) => row.state_name.toLowerCase() === state.toLowerCase(),
  );
  const districtRow = filters.district_data.find(
    (row) =>
      row.state_id === stateRow?.state_id &&
      row.district_name.toLowerCase() === district.toLowerCase(),
  );
  const marketIds = filters.market_data
    .filter(
      (row) =>
        row.state_id === stateRow?.state_id &&
        row.district_id === districtRow?.id,
    )
    .map((row) => row.id);
  if (!stateRow || !districtRow || !marketIds.length)
    throw Error(`No AGMARKNET markets found for ${district}, ${state}`);

  const batches = await Promise.allSettled([0,1,2,3].map(async ageDays => {
    const date = isoDay(Date.now() + 19800000 - ageDays * 86400000);
    const report = await agmarknetJson(
      "/prices-and-arrivals/market-report/daily",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          marketIds,
          stateIds: [stateRow.state_id],
          includeExcel: false,
        }),
      },
    );
    return flattenAgmarknetReport(report, { state, district, date, marketIds });
  }));
  const records = batches.filter(batch => batch.status === "fulfilled").flatMap(batch => batch.value);
  if (records.length) {
      const value = {
        records,
        total: records.length,
        partial: batches.some(batch => batch.status === "rejected"),
        source: "AGMARKNET 2.0",
        sourceUrl: AGMARKNET_SOURCE_URL,
      };
      cache.set(rawCacheKey, {
        value,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return value;
  }
  throw Error("No AGMARKNET observations from the last four days");
}
function unavailable(crop, state, district, reason) {
  return {
    available: false,
    status: "unavailable",
    commodity: crop,
    state,
    district,
    current: null,
    average: null,
    records: 0,
    observations: [],
    alternative: null,
    source: "AGMARKNET unavailable",
    sourceUrl: MANDI_SOURCE_URL,
    reason,
    retrievedAt: new Date().toISOString(),
  };
}
async function readResource(resourceId, key, filters, limit = "100") {
  const url = new URL(`https://api.data.gov.in/resource/${resourceId}`);
  url.search = new URLSearchParams({
    "api-key": key,
    format: "json",
    limit,
    ...Object.fromEntries(
      Object.entries(filters).map(([name, filterValue]) => [
        `filters[${name}]`,
        filterValue,
      ]),
    ),
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const json = await response.json();
  return {
    records: json.records || [],
    total: Number(json.total || 0),
    resourceId,
  };
}

export async function getVegetablePrices(
  state = "Maharashtra",
  district = "Nashik",
  force = false,
) {
  const key = process.env.DATA_GOV_API_KEY;
  const failed = (reason) => ({
    status: "unavailable",
    state,
    district,
    prices: [],
    reason,
    sourceUrl: MANDI_SOURCE_URL,
    retrievedAt: new Date().toISOString(),
  });
  const resources = [...new Set([RESOURCE, VARIETY_RESOURCE])];
  const cacheKey = JSON.stringify(["vegetables", resources, state, district]);
  const saved = cache.get(cacheKey);
  if (!force && saved && saved.expiresAt > Date.now()) return saved.value;
  const liveResult = (prices, upstream, truncated = false) => {
    const result = {
      status: "live",
      state,
      district,
      prices: prices.map((price) => ({
        ...price,
        source: upstream.source,
        sourceUrl: upstream.sourceUrl,
      })),
      commodities: prices.length,
      records: prices.reduce((sum, price) => sum + price.records, 0),
      latestDate: prices
        .map((price) => price.arrivalDate)
        .sort()
        .at(-1),
      truncated: truncated || upstream.partial === true,
      source: upstream.source,
      sourceUrl: upstream.sourceUrl,
      retrievedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return result;
  };
  let modernError;
  try {
    const upstream = await readAgmarknetDistrict(state, district, force);
    const prices = summarizeVegetableRecords(upstream.records, {
      state,
      district,
    });
    if (!prices.length) throw Error("No fresh vegetable observations found");
    return liveResult(prices, upstream);
  } catch (error) {
    modernError = error;
  }
  if (!key)
    return failed(
      `${modernError.message}; legacy data.gov.in API key is not configured`,
    );
  try {
    const reads = await Promise.allSettled(
      resources.map((id) => readResource(id, key, { state, district }, "1000")),
    );
    const successful = reads
      .filter((read) => read.status === "fulfilled")
      .map((read) => read.value);
    if (!successful.length) {
      const errors = reads.map((read) => read.reason).filter(Boolean);
      throw errors.find((error) => error.name === "TimeoutError") || errors[0];
    }
    const prices = summarizeVegetableRecords(
      successful.flatMap((read) => read.records),
      { state, district },
    );
    if (!prices.length) throw Error("No fresh vegetable observations found");
    return liveResult(
      prices,
      { source: "AGMARKNET / data.gov.in", sourceUrl: MANDI_SOURCE_URL },
      successful.some(
        (read) => read.total > 0 && read.total > read.records.length,
      ),
    );
  } catch (error) {
    return failed(
      `${modernError.message}; ${
        error.name === "TimeoutError"
          ? "legacy data.gov.in timed out"
          : error.message
      }`,
    );
  }
}
export async function getMandiSignal(
  crop,
  state = "Maharashtra",
  district = "Nashik",
) {
  const key = process.env.DATA_GOV_API_KEY;
  const resources = [...new Set([RESOURCE, VARIETY_RESOURCE])];
  const cacheKey = JSON.stringify([resources, crop, state, district]);
  const saved = cache.get(cacheKey);
  if (saved && saved.expiresAt > Date.now()) return saved.value;
  let modernError;
  try {
    const upstream = await readAgmarknetDistrict(state, district);
    const signal = summarizeMandiRecords(upstream.records, {
      crop,
      state,
      district,
    });
    if (!signal) throw Error("No observations from the last three days");
    const result = {
      ...signal,
      source: upstream.source,
      sourceUrl: upstream.sourceUrl,
    };
    cache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return result;
  } catch (error) {
    modernError = error;
  }
  if (!key)
    return unavailable(
      crop,
      state,
      district,
      `${modernError.message}; legacy data.gov.in API key is not configured`,
    );
  try {
    // The catalog exposes a current resource and a newer variety-wise resource.
    // Query both concurrently so an unavailable endpoint never doubles latency.
    const reads = await Promise.allSettled(
      resources.map(async (resourceId) => {
        const json = await readResource(
          resourceId,
          key,
          { state, district, commodity: crop },
          "100",
        );
        const signal = summarizeMandiRecords(json.records, {
          crop,
          state,
          district,
        });
        if (!signal) throw Error("No observations from the last three days");
        return {
          ...signal,
          resourceId,
          sourceUrl:
            resourceId === VARIETY_RESOURCE
              ? VARIETY_SOURCE_URL
              : MANDI_SOURCE_URL,
        };
      }),
    );
    const signal = reads.find((read) => read.status === "fulfilled")?.value;
    if (!signal) {
      const errors = reads.map((read) => read.reason).filter(Boolean);
      throw errors.find((error) => error.name === "TimeoutError") || errors[0];
    }
    cache.set(cacheKey, {
      value: signal,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return signal;
  } catch (error) {
    return unavailable(
      crop,
      state,
      district,
      `${modernError.message}; ${
        error.name === "TimeoutError"
          ? "legacy data.gov.in timed out"
          : error.message
      }`,
    );
  }
}
