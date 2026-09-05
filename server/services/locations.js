const cache = new Map();
function normalize(row) {
  if (row.country_code !== "IN" || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) throw Error("Choose an Indian location.");
  return { id: row.id, name: row.name, state: row.admin1 || "", district: row.admin2 || "",
    latitude: row.latitude, longitude: row.longitude,
    label: [...new Set([row.name, row.admin2, row.admin1].filter(Boolean))].join(", ") };
}
export async function searchLocations(query) {
  if (typeof query !== "string" || query.trim().length < 2) return [];
  const response = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + new URLSearchParams({name:query.trim().slice(0,100),count:"10",countryCode:"IN",language:"en"}), {signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error("Location search unavailable. Please retry.");
  return ((await response.json()).results || []).filter(row => row.country_code === "IN").map(normalize);
}
export async function resolveLocation(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw Error("Select a location from the search results.");
  if (cache.has(id)) return cache.get(id);
  const response = await fetch("https://geocoding-api.open-meteo.com/v1/get?id=" + id, {signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error("Unable to verify this location.");
  const location = normalize(await response.json());
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(id, location);
  return location;
}
export function marketRegion(farmer) {
  if (farmer.region_state && farmer.region_district) return [farmer.region_state, farmer.region_district.replace(/ district$/i,"").trim()];
  // Explicit mapping for the existing pilot profiles only.
  if (["nashik","nasik","dindori","lasalgaon"].includes(String(farmer.location).trim().toLowerCase()))
    return ["Maharashtra","Nashik"];
  return null;
}
