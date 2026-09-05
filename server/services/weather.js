const fallback = {
  temperature: 28,
  rainProbability: 20,
  precipitation: 0,
  wind: 12,
  source: "demo",
};

export async function getWeather(location, latitude, longitude) {
  try {
    if (!latitude || !longitude) {
      const geo = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.split(',')[0].trim())}&count=5&countryCode=IN`,
        { signal: AbortSignal.timeout(10000) },
      );
      const match = (await geo.json()).results?.find(r => r.country_code === 'IN' && r.admin1 === 'Maharashtra');
      if (!match) throw new Error("Location not found");
      ({ latitude, longitude } = match);
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude,
      longitude,
      current: "temperature_2m,wind_speed_10m",
      daily: "precipitation_probability_max,precipitation_sum",
      forecast_days: "3",
      timezone: "Asia/Kolkata",
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Weather unavailable");
    const data = await response.json();
    return {
      temperature: data.current.temperature_2m,
      wind: data.current.wind_speed_10m,
      rainProbability: data.daily.precipitation_probability_max[0],
      precipitation: data.daily.precipitation_sum[0],
      latitude,
      longitude,
      source: "Open-Meteo",
      daily: data.daily.time.map((date, i) => ({
        date,
        rainProbability: data.daily.precipitation_probability_max[i],
        precipitationMm: data.daily.precipitation_sum[i],
      })),
    };
  } catch {
    return fallback;
  }
}
