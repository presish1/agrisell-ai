const RESOURCE =
  process.env.DATA_GOV_RESOURCE_ID || "9ef84268-d588-465a-a308-a864a43d0070";

export async function getMandiSignal(crop, state = "Maharashtra") {
  const key = process.env.DATA_GOV_API_KEY;
  if (key)
    try {
      const url = new URL(`https://api.data.gov.in/resource/${RESOURCE}`);
      url.search = new URLSearchParams({
        "api-key": key,
        format: "json",
        limit: "30",
        "filters[state]": state,
        "filters[district]": "Nashik",
        "filters[commodity]": crop,
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const json = await response.json();
      const recent = (json.records || []).filter((r) => {
        const [day, month, year] = String(r.arrival_date || "")
          .split("/")
          .map(Number);
        const age = Date.now() - Date.UTC(year, month - 1, day);
        return age >= -86400000 && age < 3 * 86400000;
      });
      const prices = recent
        .map((r) => Number(r.modal_price))
        .filter(Boolean)
        .map((p) => p / 100); // This AGMARKNET resource reports rupees per quintal.
      if (prices.length)
        return {
          current: prices[0],
          average: prices.reduce((a, b) => a + b, 0) / prices.length,
          records: prices.length,
          source: "AGMARKNET / data.gov.in",
          alternative: {
            name: recent.reduce((a, b) =>
              Number(a.modal_price) > Number(b.modal_price) ? a : b,
            ).market,
            price: Math.max(...prices),
            transportPerKg: 1.5,
          },
        };
    } catch {}
  const demo = {
    Tomato: [24, 26.5],
    Onion: [21, 21.5],
    Grapes: [82, 86],
    Potato: [18, 19.2],
  }[crop] || [25, 26];
  return {
    current: demo[0],
    average: demo[1],
    records: 14,
    source: "Demo market feed",
    alternative:
      crop === "Tomato"
        ? { name: "Pimpalgaon APMC (demo)", price: 28, transportPerKg: 1.5 }
        : null,
  };
}
