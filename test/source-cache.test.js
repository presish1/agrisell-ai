import test from "node:test";
import assert from "node:assert/strict";
import { SourceCache } from "../server/services/source-cache.js";
test("public source preload deduplicates concurrent reads and retains actual retrieval timestamp", async () => {
  const cache = new SourceCache();
  let reads = 0;
  const load = async () => {
    reads++;
    return { source: "Open-Meteo", retrievedAt: "original" };
  };
  const [a, b] = await Promise.all([
    cache.get("location", load),
    cache.get("location", load),
  ]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.equal((await cache.get("location", load)).retrievedAt, "original");
  assert.equal(reads, 1);
});
test("expired sources refresh; failed and unavailable sources are not sticky", async () => {
  let now = 0,
    reads = 0;
  const cache = new SourceCache({ ttlMs: 100, now: () => now });
  const load = async () => ++reads;
  await cache.get("weather", load);
  now = 101;
  assert.equal(await cache.get("weather", load), 2);
  await assert.rejects(
    cache.get("failed", async () => {
      throw Error("offline");
    }),
  );
  assert.equal(await cache.get("failed", async () => 3), 3);
  await cache.get(
    "unavailable",
    async () => null,
    (v) => v !== null,
  );
  assert.equal(await cache.get("unavailable", async () => 4), 4);
});
test("cache is bounded and separates coordinates/crops", async () => {
  const cache = new SourceCache({ limit: 2 });
  await cache.get("weather:a", async () => 1);
  await cache.get("weather:b", async () => 2);
  await cache.get("market:Tomato", async () => 3);
  assert.equal(cache.entries.size, 2);
  assert.ok(!cache.entries.has("weather:a"));
  assert.equal(await cache.get("weather:b", async () => 9), 2);
});
