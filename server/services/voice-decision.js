// Evidence rules, computed locally so advice needs no second model round trip.
export function voiceDecision({ farmer: f, weather = {}, market = {}, priceForecast = {} }) {
  const reasons = [];
  const missing = [];
  const forecast =
    weather.source === "Open-Meteo"
      ? (weather.daily || []).slice(
          0,
          Math.max(1, Math.min(3, Number(f.storage_days) + 1)),
        )
      : [];
  const rain = forecast.length
    ? Math.max(...forecast.map((day) => Number(day.rainProbability) || 0))
    : weather.source === "Open-Meteo"
      ? Number(weather.rainProbability)
      : null;
  const marketUsable =
    market.available === true &&
    Number.isFinite(market.current) &&
    market.ageDays >= 0 &&
    market.ageDays <= 3;
  if (!marketUsable) missing.push("Fresh matching mandi price");
  if (rain === null || !Number.isFinite(rain)) missing.push("Weather forecast");
  let action = "CHECK BUYER QUOTES";
  if (Number(f.quantity_kg) <= 0) {
    action = "NO STOCK TO SELL";
    reasons.push("The saved remaining stock is zero.");
  } else {
    if (Number(f.storage_days) <= 0 || f.maturity === "Overripe") {
      action = "ARRANGE SALE TODAY";
      reasons.push(
        "The recorded safe storage window is exhausted or the crop is overripe.",
      );
    } else {
      reasons.push(
        `Arrange a buyer within the recorded ${f.storage_days}-day safe storage window.`,
      );
    }
    if (rain >= 65) {
      reasons.push(
        `Open-Meteo forecasts up to ${rain}% rain probability within the available forecast/storage window. Keep stock covered and plan dry loading and transport.`,
      );
      if (action === "CHECK BUYER QUOTES")
        action = "CHECK QUOTES AND PROTECT STOCK";
    }
    if (marketUsable)
      reasons.push(
        `${market.source} reports a median modal wholesale price of ₹${market.current}/kg on ${market.arrivalDate}; compare a buyer's offer for matching variety and grade.`,
      );
  }
  return {
    action,
    reasons,
    missing,
    quantityKg: f.quantity_kg,
    storageDays: f.storage_days,
    priceForecastAvailable: priceForecast.available === true,
    priceForecastStatus: priceForecast.status || "unavailable",
    instruction:
      "Do not recommend waiting for a price rise: a current wholesale observation is not a future price forecast. Verify buyer quote and transport costs before choosing a mandi. Stock may be historical until farmer confirmation.",
  };
}
