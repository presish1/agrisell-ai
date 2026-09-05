export async function boundedRead(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function voiceFacts(data) {
  const f = data.farmer;
  const lines = [
    `Field desk: ${f.quantity_kg} kg of ${f.crop}, ${f.storage_days} safe storage days.`,
    `Recorded price ₹${f.current_price}/kg; not a live buyer quote.`,
  ];
  if (data.weather.source === "Open-Meteo")
    lines.push(
      `Open-Meteo forecast for ${data.weather.daily?.[0]?.date || "the reported forecast day"}: ${data.weather.rainProbability}% rain probability; ${data.weather.precipitation} mm expected precipitation.`,
    );
  else
    lines.push(
      "Weather lookup unavailable right now. Do not infer current weather.",
    );
  if (data.market.available !== false)
    lines.push(
      `${data.market.source}, ${data.market.arrivalDate}: median modal price ₹${data.market.current}/kg across ${data.market.records} observations in ${data.market.markets} markets; observed range ₹${data.market.low}–₹${data.market.high}/kg. Wholesale observations are converted from ₹/quintal. Verify crop variety, grade and a buyer quote before sale.`,
    );
  else
    lines.push(
      "No verified market quote is connected. Future market prices are unavailable.",
    );
  if (data.weather.daily?.length)
    lines.push(`Forecast days: ${JSON.stringify(data.weather.daily)}.`);
  if (data.decision) lines.push(`Decision: ${JSON.stringify(data.decision)}.`);
  return lines.join("\n");
}
