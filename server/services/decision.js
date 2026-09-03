export function decide({
  currentPrice,
  marketAverage,
  quantity,
  storageDays,
  maturity,
  weather,
  alternative,
}) {
  const trend = Math.max(
    -0.08,
    Math.min(0.12, (marketAverage - currentPrice) / Math.max(currentPrice, 1)),
  );
  const rainRisk = weather.rainProbability >= 65 ? 0.025 : 0;
  const maturityRisk =
    maturity === "Overripe" ? 0.05 : maturity === "Ready" ? 0.015 : 0.008;
  const expected = currentPrice * (1 + trend);
  const low = Math.max(0, expected * 0.96),
    high = expected * 1.04;
  const storageCost = quantity * currentPrice * (maturityRisk + rainRisk);
  let expectedGain = (expected - currentPrice) * quantity - storageCost;
  let action = "SELL NOW",
    reason = "Waiting does not cover spoilage and weather risk.";
  if (storageDays > 0 && expectedGain >= 1000) {
    action = "WAIT";
    reason = `The expected price improvement covers an estimated ₹${Math.round(storageCost).toLocaleString("en-IN")} of waiting risk.`;
  }
  const alternativeGain = alternative
    ? (alternative.price - currentPrice - alternative.transportPerKg) * quantity
    : 0;
  if (
    alternativeGain >= 1000 &&
    alternativeGain > Math.max(0, storageDays > 0 ? expectedGain : 0)
  ) {
    action = "OTHER MANDI";
    expectedGain = alternativeGain;
    reason = `Check ${alternative.name}: ₹${alternative.price}/kg, less an assumed ₹${alternative.transportPerKg}/kg transport cost. Confirm grade, availability and actual transport before travelling.`;
  } else if (action === "SELL NOW") expectedGain = 0;
  const confidence = Math.max(
    0.52,
    Math.min(0.88, 0.76 - rainRisk * 2 - (maturity === "Overripe" ? 0.12 : 0)),
  );
  return {
    action,
    forecastLow: +low.toFixed(1),
    forecastHigh: +high.toFixed(1),
    expectedGain: Math.round(expectedGain),
    confidence: +confidence.toFixed(2),
    reason,
  };
}
