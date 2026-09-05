const fallback = {
  available: false,
  temperature: null,
  rainProbability: null,
  precipitation: null,
  wind: null,
  source: "demo",
};

export async function getWeather(location, latitude, longitude) {
  try {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const geo = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.split(',')[0].trim())}&count=5&countryCode=IN`,
        { signal: AbortSignal.timeout(10000) },
      );
      const matches = (await geo.json()).results?.filter(r => r.country_code === 'IN') || [];
      const match = matches.length === 1 ? matches[0] : null;
      if (!match) throw new Error("Location not found");
      ({ latitude, longitude } = match);
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude,
      longitude,
      current: "temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code",
      daily: "precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min",
      forecast_days: "3",
      timezone: "Asia/Kolkata",
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Weather unavailable");
    const data = await response.json();
    if (!Number.isFinite(data.current?.temperature_2m) || !data.daily?.time?.length ||
        !data.daily.time.every((_, i) => Number.isFinite(data.daily.precipitation_probability_max?.[i]) && Number.isFinite(data.daily.precipitation_sum?.[i])))
      throw Error("Incomplete weather response");
    return {
      available: true,
      retrievedAt: new Date().toISOString(),
      observedAt: data.current.time,
      timezone: data.timezone,
      sourceUrl: url.toString(),
      humidity: data.current.relative_humidity_2m,
      weatherCode: data.current.weather_code,
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
        high: data.daily.temperature_2m_max?.[i],
        low: data.daily.temperature_2m_min?.[i],
      })),
    };
  } catch {
    return fallback;
  }
}
