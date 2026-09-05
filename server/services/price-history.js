import { agmarknetJson, getAgmarknetFilters, normalizeMandiRecord, AGMARKNET_SOURCE_URL } from "./mandi.js";

const cache = new Map();
const pending = new Map();
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const round = n => Math.round(n * 100) / 100;
const keyName = name => String(name).trim().toLowerCase();
export function cachedPriceHistory(crop, state = "Maharashtra", district = "Nashik") {
  const day = new Date(Date.now() + 19800000).toISOString().slice(0,10);
  const saved = cache.get(JSON.stringify([crop,state,district,day]));
  return saved?.expiresAt > Date.now() ? saved.value : null;
}

// Fixed persistence baseline: every prediction uses ONLY the prior observation.
// No fitting on the evaluation window and no mixing market/variety series.
export function evaluatePriceHistory(rows, now = Date.now()) {
  const today = new Date(now + 19800000).toISOString().slice(0, 10);
  const groups = new Map();
  for (const row of rows) {
    if (!row || row.arrivalDate > today) continue;
    const key = JSON.stringify([row.market, row.variety, row.grade]);
    if (!groups.has(key)) groups.set(key, new Map());
    const dates = groups.get(key);
    // Conflicting observations on one date are excluded, not silently averaged.
    if (dates.has(row.arrivalDate) && dates.get(row.arrivalDate)?.modalPrice !== row.modalPrice)
      dates.set(row.arrivalDate, null);
    else if (!dates.has(row.arrivalDate)) dates.set(row.arrivalDate, row);
  }
  const series = [...groups.values()].map(dates => [...dates.values()].filter(Boolean).sort((a,b) => a.arrivalDate.localeCompare(b.arrivalDate)))
    .filter(rows => rows.length >= 30 && (Date.parse(today) - Date.parse(rows.at(-1).arrivalDate)) / 86400000 <= 3)
    .sort((a,b) => b.length - a.length || a[0].market.localeCompare(b[0].market))[0];
  if (!series) return {available: false, reason: "History connected; no fresh same-market, same-variety series with at least 30 valid daily observations.", observations: rows.length};
  const errors = [];
  for (let i = 1; i < series.length; i++) {
    // Daily horizon only: do not score Friday→Monday as a one-day prediction.
    if (Date.parse(series[i].arrivalDate) - Date.parse(series[i-1].arrivalDate) !== 86400000) continue;
    errors.push({absolute: Math.abs(series[i].modalPrice - series[i-1].modalPrice), actual: series[i].modalPrice});
  }
  const evaluation = errors.slice(-30);
  if (evaluation.length < 15) return {available: false, reason: "History connected, but fewer than 15 adjacent-day evaluation pairs; no reliable daily error estimate.", observations: series.length};
  const last = series.at(-1);
  const targetDate = new Date(Date.parse(last.arrivalDate) + 86400000).toISOString().slice(0,10);
  if (targetDate < today) return {available: false, reason: "History is too old for a forward daily estimate.", lastObservation: last.arrivalDate};
  const mae = mean(evaluation.map(e => e.absolute));
  const mape = mean(evaluation.map(e => e.absolute / e.actual)) * 100;
  return {
    available: true, status: "experimental", model: "Previous-day modal-price baseline (no-change)",
    source: "AGMARKNET daily commodity history", sourceUrl: AGMARKNET_SOURCE_URL,
    market: last.market, variety: last.variety, grade: last.grade,
    commodity: last.commodity, unit: "INR/kg", targetDate, lastObservation: last.arrivalDate,
    estimate: last.modalPrice, historicalErrorBand: [round(Math.max(0,last.modalPrice - mae)), round(last.modalPrice + mae)],
    evaluation: {method: "Walk-forward, adjacent-day predictions; no future data", observations: series.length, evaluatedPairs: evaluation.length, maeKg: round(mae), mapePercent: round(mape)},
    caution: "Historical error band is not a calibrated confidence interval. Experimental baseline, not a buyer quote or evidence of a price rise. Grade is unspecified when absent upstream; verify matching grade before sale.",
    history: series.map(r => ({date:r.arrivalDate, modalPrice:r.modalPrice})),
  };
}

export async function getPriceHistory(crop, state = "Maharashtra", district = "Nashik") {
  const day = new Date(Date.now() + 19800000).toISOString().slice(0,10);
  const key = JSON.stringify([crop,state,district,day]);
  if (cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
  if (pending.has(key)) return pending.get(key);
  const work = (async () => {
    try {
      const filters = await getAgmarknetFilters();
      const s = filters.state_data.find(r => keyName(r.state_name) === keyName(state));
      const d = filters.district_data.find(r => r.state_id === s?.state_id && keyName(r.district_name) === keyName(district));
      const c = filters.cmdt_data.find(r => keyName(r.cmdt_name) === keyName(crop));
      if (!s || !d || !c) throw Error("No matching official commodity/district mapping");
      const names = new Set(filters.market_data.filter(r => r.state_id === s.state_id && r.district_id === d.id).map(r => keyName(r.mkt_name)));
      const anchor = new Date(`${day}T00:00:00Z`);
      const reports = await Promise.all([0,1,2].map(async offset => {
        const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth()-offset,1));
        const query = new URLSearchParams({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,stateId:s.state_id,commodityId:c.cmdt_id,includeExcel:"false"});
        const report = await agmarknetJson(`/prices-and-arrivals/date-wise/specific-commodity?${query}`);
        if (!report.success || !report.columns?.some(col => col.key === "modalPrice" && /Quintal/i.test(col.title))) throw Error("Historical price units or response could not be verified");
        return report;
      }));
      const rows = reports.flatMap(report => (report.markets || []).filter(m => names.has(keyName(m.marketName))).flatMap(m => (m.dates || []).flatMap(day => (day.data || []).map(r => normalizeMandiRecord({state,district,market:m.marketName.trim(),commodity:crop,variety:r.variety,grade:r.grade,arrival_date:day.arrivalDate,min_price:r.minimumPrice,max_price:r.maximumPrice,modal_price:r.modalPrice}))))).filter(Boolean);
      const value = {...evaluatePriceHistory(rows), retrievedAt:new Date().toISOString(), sourceUrl:AGMARKNET_SOURCE_URL};
      cache.set(key,{value,expiresAt:Date.now()+3600000});
      return value;
    } catch (error) {
      const value = {available:false, reason:`Historical data could not be validated: ${error.message}`};
      cache.set(key,{value,expiresAt:Date.now()+60000});
      return value;
    } finally {pending.delete(key);}
  })();
  pending.set(key,work);
  return work;
}
