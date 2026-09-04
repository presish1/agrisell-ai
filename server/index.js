import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { db, listFarmers } from "./database.js";
import { getWeather } from "./services/weather.js";
import { getMandiSignal } from "./services/mandi.js";
import { decide } from "./services/decision.js";
import { demoRouter } from './demo.js';
import {
  createMessage,
  placeCall,
  fetchCallStatus,
  getAudio,
  voiceReady,
} from "./services/voice.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", (_, res) =>
  res.json({
    ok: true,
    database: "SQLite",
    weather: "Open-Meteo",
    mandi: process.env.DATA_GOV_API_KEY ? "AGMARKNET" : "demo",
    voice: voiceReady() ? "Twilio" : "simulator",
    authRequired: Boolean(process.env.ADMIN_TOKEN),
  }),
);
app.get("/api/audio/:token", (req, res) => {
  const audio = getAudio(req.params.token);
  if (!audio) return res.sendStatus(404);
  res.type("audio/wav").send(audio);
});
app.use("/api", (req, res, next) => {
  if (!process.env.ADMIN_TOKEN) return next();
  const expected = Buffer.from(process.env.ADMIN_TOKEN),
    supplied = Buffer.from(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
    );
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return res
      .status(401)
      .json({ error: "Sign in with your operator access token." });
  next();
});
app.use('/api/demo', demoRouter);
app.get("/api/farmers", (_, res) => res.json(listFarmers()));
app.post("/api/farmers", async (req, res, next) => {
  try {
    const {
      name,
      phone,
      location,
      language = "Marathi",
      consent = false,
      crop,
      quantityKg,
      maturity = "Ready",
      storageDays = 0,
      currentPrice,
    } = req.body;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof location !== "string" ||
      !location.trim() ||
      location.length > 100 ||
      !/^\+[1-9]\d{7,14}$/.test(phone || "")
    )
      return res.status(400).json({
        error:
          "A name, location and valid international phone number are required.",
      });
    if (
      !["Tomato", "Onion", "Grapes", "Potato"].includes(crop) ||
      !["Marathi", "Hindi", "English"].includes(language) ||
      !["Ready", "Near ready", "Overripe"].includes(maturity)
    )
      return res
        .status(400)
        .json({ error: "Unsupported crop, language or maturity." });
    if (
      !Number.isFinite(quantityKg) ||
      quantityKg <= 0 ||
      quantityKg > 1000000 ||
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0 ||
      currentPrice > 10000 ||
      !Number.isInteger(storageDays) ||
      storageDays < 0 ||
      storageDays > 7
    )
      return res.status(400).json({
        error: "Quantity, price and storage days are outside supported limits.",
      });
    const w = await getWeather(location);
    db.exec("BEGIN");
    try {
      const f = db
        .prepare(
          "INSERT INTO farmers(name,phone,location,language,consent,latitude,longitude) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          name.trim(),
          phone,
          location.trim(),
          language,
          consent === true ? 1 : 0,
          w.latitude || null,
          w.longitude || null,
        );
      db.prepare(
        "INSERT INTO crops(farmer_id,crop,quantity_kg,maturity,storage_days,current_price) VALUES(?,?,?,?,?,?)",
      ).run(
        f.lastInsertRowid,
        crop,
        quantityKg,
        maturity,
        storageDays,
        currentPrice,
      );
      db.exec("COMMIT");
      res.status(201).json({ ok: true, id: Number(f.lastInsertRowid) });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    next(e);
  }
});
app.patch("/api/crops/:id", (req, res) => {
  const { quantityKg, storageDays, currentPrice } = req.body;
  if (
    !Number.isFinite(quantityKg) ||
    quantityKg < 0 ||
    quantityKg > 1000000 ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0 ||
    currentPrice > 10000 ||
    !Number.isInteger(storageDays) ||
    storageDays < 0 ||
    storageDays > 7
  )
    return res
      .status(400)
      .json({ error: "Enter valid stock, price and storage values." });
  const result = db
    .prepare(
      "UPDATE crops SET quantity_kg=?,storage_days=?,current_price=?,active=?,needs_review=1 WHERE id=?",
    )
    .run(
      quantityKg,
      storageDays,
      currentPrice,
      quantityKg > 0 ? 1 : 0,
      req.params.id,
    );
  if (!result.changes) return res.status(404).json({ error: "Crop not found" });
  res.json({ ok: true });
});
let running = false;
app.post("/api/recommendations/run", async (_, res, next) => {
  if (running)
    return res
      .status(409)
      .json({ error: "An intelligence refresh is already running." });
  running = true;
  try {
    const rows = db
      .prepare(
        "SELECT c.*,f.location,f.latitude,f.longitude FROM crops c JOIN farmers f ON f.id=c.farmer_id WHERE c.active=1",
      )
      .all();
    let count = 0;
    for (const row of rows) {
      const [weather, market] = await Promise.all([
        getWeather(row.location, row.latitude, row.longitude),
        getMandiSignal(row.crop),
      ]);
      const d = decide({
        currentPrice: row.current_price,
        marketAverage: market.average,
        alternative: market.alternative,
        quantity: row.quantity_kg,
        storageDays: row.storage_days,
        maturity: row.maturity,
        weather,
      });
      db.prepare(
        "INSERT INTO recommendations(crop_id,action,current_price,forecast_low,forecast_high,expected_gain,confidence,reason,weather_json,market_source) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        row.id,
        d.action,
        row.current_price,
        d.forecastLow,
        d.forecastHigh,
        d.expectedGain,
        d.confidence,
        d.reason,
        JSON.stringify(weather),
        market.source,
      );
      db.prepare("UPDATE crops SET needs_review=0 WHERE id=?").run(row.id);
      count++;
    }
    res.json({ ok: true, count });
  } catch (e) {
    next(e);
  } finally {
    running = false;
  }
});
const calling = new Set();
app.post("/api/recommendations/:id/call", async (req, res, next) => {
  const key = req.params.id;
  if (calling.has(key))
    return res
      .status(409)
      .json({ error: "This call is already being queued." });
  calling.add(key);
  try {
    const f = db
      .prepare(
        `SELECT f.*,c.crop,c.current_price,c.active,c.needs_review,r.action,r.market_source,r.forecast_low,r.forecast_high,r.id recommendation_id FROM recommendations r JOIN crops c ON c.id=r.crop_id JOIN farmers f ON f.id=c.farmer_id WHERE r.id=? AND r.id=(SELECT MAX(id) FROM recommendations WHERE crop_id=c.id)`,
      )
      .get(key);
    if (!f || !f.active || f.needs_review)
      return res.status(404).json({ error: "Active recommendation not found" });
    if (!f.consent)
      return res.status(409).json({
        error:
          "Farmer consent is required before calling. Add a consented test farmer first.",
      });
    if (voiceReady() && f.market_source === "Demo market feed")
      return res.status(409).json({
        error:
          "Live calls are blocked for demo market recommendations. Configure AGMARKNET data first.",
      });
    const recent = db
      .prepare(
        `SELECT calls.id FROM calls JOIN recommendations r ON r.id=calls.recommendation_id JOIN crops c ON c.id=r.crop_id WHERE c.farmer_id=? AND calls.created_at>datetime('now','-12 hours') LIMIT 1`,
      )
      .get(f.id);
    if (recent)
      return res.status(409).json({
        error: "This farmer has already been contacted in the last 12 hours.",
      });
    const message = createMessage(f, f),
      result = await placeCall(f.phone, message, f.language);
    db.prepare(
      "INSERT INTO calls(recommendation_id,provider,provider_id,status,message) VALUES(?,?,?,?,?)",
    ).run(
      f.recommendation_id,
      result.provider,
      result.id,
      result.status,
      message,
    );
    res.json({ ...result, message });
  } catch (e) {
    next(e);
  } finally {
    calling.delete(key);
  }
});
app.get("/api/calls", async (_, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT calls.*,farmers.name FROM calls JOIN recommendations r ON r.id=calls.recommendation_id JOIN crops c ON c.id=r.crop_id JOIN farmers ON farmers.id=c.farmer_id ORDER BY calls.id DESC LIMIT 100`,
      )
      .all();
    for (const call of rows.filter(
      (c) =>
        c.provider === "twilio" &&
        ["queued", "ringing", "in-progress"].includes(c.status),
    )) {
      try {
        const status = await fetchCallStatus(call.provider_id);
        if (status) {
          call.status = status;
          db.prepare("UPDATE calls SET status=? WHERE id=?").run(
            status,
            call.id,
          );
        }
      } catch {}
    }
    res.json(rows);
  } catch (e) {
    next(e);
  }
});
app.use((e, _, res, next) => {
  console.error(e.message);
  res.status(500).json({
    error: e.message?.startsWith("Regional")
      ? e.message
      : "The request failed. Check server configuration or provider availability.",
  });
});
if (existsSync("dist")) app.use(express.static("dist"));
const port = Number(process.env.PORT || 8787),
  host = process.env.HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  !process.env.ADMIN_TOKEN
)
  throw new Error(
    "ADMIN_TOKEN is required when exposing the server beyond localhost.",
  );
app.listen(port, host, () =>
  console.log(`AgriSell API listening on http://${host}:${port}`),
);
