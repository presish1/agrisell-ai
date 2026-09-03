const base = "http://127.0.0.1:8787";
const request = async (path, method = "GET", body) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
};
const health = await request("/api/health");
if (health.voice !== "simulator")
  throw new Error("Smoke test refuses to run when live calling is enabled.");
const farmer = await request("/api/farmers", "POST", {
  name: "QA Test Farmer",
  phone: "+910000000009",
  location: "Nashik",
  language: "English",
  consent: true,
  crop: "Tomato",
  quantityKg: 1000,
  maturity: "Ready",
  storageDays: 2,
  currentPrice: 24,
});
let crop;
try {
  await request("/api/recommendations/run", "POST");
  crop = (await request("/api/farmers")).find((f) => f.id === farmer.id);
  if (!crop?.recommendation_id)
    throw new Error("Recommendation not persisted.");
  const call = await request(
    `/api/recommendations/${crop.recommendation_id}/call`,
    "POST",
  );
  if (call.status !== "simulated") throw new Error("Expected simulated call.");
  const calls = await request("/api/calls");
  if (!calls.some((c) => c.provider_id === call.id))
    throw new Error("Call log not persisted.");
  const duplicate = await fetch(
    base + `/api/recommendations/${crop.recommendation_id}/call`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN || ""}` },
    },
  );
  if (duplicate.status !== 409)
    throw new Error("Duplicate-call cooldown failed.");
  await request(`/api/crops/${crop.crop_id}`, "PATCH", {
    quantityKg: 900,
    storageDays: 1,
    currentPrice: 24,
  });
  const changed = (await request("/api/farmers")).find(
    (f) => f.id === farmer.id,
  );
  if (changed.recommendation_id !== null)
    throw new Error("Stock edits must invalidate old recommendations.");
  console.log(
    "PASS: farmer → SQLite → weather/market → decision → simulated call → call history; cooldown and stale-stock checks",
  );
} finally {
  crop ||= (await request("/api/farmers")).find((f) => f.id === farmer.id);
  if (crop)
    await request(`/api/crops/${crop.crop_id}`, "PATCH", {
      quantityKg: 0,
      storageDays: 0,
      currentPrice: 24,
    });
}
