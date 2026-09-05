import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { attachVoice, intelligenceRouter, warmCallContext } from "./live.js";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { db, listFarmers, listFarmerProfiles } from "./database.js";
import { getWeather } from "./services/weather.js";
import { getMandiSignal, getVegetablePrices } from "./services/mandi.js";
import { decide } from "./services/decision.js";
import { demoRouter } from "./demo.js";
import { messagesRouter } from "./messages.js";
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
    mandi: process.env.DATA_GOV_API_KEY
      ? "AGMARKNET configured"
      : "API key required",
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
// Begin independent public-source work during ringing, before the farmer answers.
app.post("/api/demo/calls", (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode < 300)
      warmCallContext(Number(req.body.cropId)).catch((error) =>
        console.warn("Call source preload failed:", error.message),
      );
  });
  next();
});
app.use("/api/demo", demoRouter);
app.use("/api/messages", messagesRouter);
app.get("/api/farmers", (_, res) => res.json(listFarmers()));
app.get("/api/farmer-profiles", (_, res) => res.json(listFarmerProfiles()));
const languages = ["Marathi", "Hindi", "English"];
const crops = ["Tomato", "Onion", "Grapes", "Potato"];
const maturities = ["Ready", "Near ready", "Overripe"];
function validProfile({ name, phone, location, language }) {
  return (
    typeof name === "string" && !!name.trim() && name.length <= 100 &&
    typeof location === "string" && !!location.trim() && location.length <= 100 &&
    /^\+[1-9]\d{7,14}$/.test(phone || "") && languages.includes(language)
  );
}
function validCrop({ crop, quantityKg, maturity, storageDays, currentPrice }) {
  return crops.includes(crop) && maturities.includes(maturity) &&
    Number.isFinite(quantityKg) && quantityKg > 0 && quantityKg <= 1000000 &&
    Number.isFinite(currentPrice) && currentPrice > 0 && currentPrice <= 10000 &&
    Number.isInteger(storageDays) && storageDays >= 0 && storageDays <= 7;
}
function enrichFarmerLocation(id, location) {
  void getWeather(location).then(w => {
    if (Number.isFinite(w.latitude) && Number.isFinite(w.longitude))
      db.prepare("UPDATE farmers SET latitude=?,longitude=? WHERE id=?").run(w.latitude, w.longitude, id);
  }).catch(error => console.warn("Farmer weather enrichment failed:", error.message));
}
app.get("/api/market/vegetables", async (req, res, next) => {
  try {
    res.json(
      await getVegetablePrices(
        "Maharashtra",
        "Nashik",
        req.query.refresh === "1",
      ),
    );
  } catch (error) {
    next(error);
  }
});
app.get("/api/market", async (req, res, next) => {
  try {
    const crop = String(req.query.crop || "");
    if (!["Tomato", "Onion", "Grapes", "Potato"].includes(crop))
      return res.status(400).json({ error: "Choose a supported crop." });
    res.json(await getMandiSignal(crop, "Maharashtra", "Nashik"));
  } catch (error) {
    next(error);
  }
});
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
    if (!validProfile({ name, phone, location, language }))
      return res.status(400).json({
        error:
          "A name, location and valid international phone number are required.",
      });
    if (
      !validCrop({ crop, quantityKg, maturity, storageDays, currentPrice })
    )
      return res.status(400).json({
        error: "Quantity, price and storage days are outside supported limits.",
      });
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
          null,
          null,
        );
      const stock = db.prepare(
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
      res.status(201).json({ ok: true, id: Number(f.lastInsertRowid), cropId: Number(stock.lastInsertRowid) });
      // Profile creation must not depend on a third-party weather response.
      enrichFarmerLocation(Number(f.lastInsertRowid), location);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    next(e);
  }
});
app.patch("/api/farmers/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, location, language, consent = false } = req.body;
  if (!Number.isInteger(id) || !validProfile({ name, phone, location, language }))
    return res.status(400).json({ error: "Enter a valid name, phone, location and language." });
  const before = db.prepare("SELECT location FROM farmers WHERE id=?").get(id);
  if (!before) return res.status(404).json({ error: "Farmer not found." });
  db.prepare("UPDATE farmers SET name=?,phone=?,location=?,language=?,consent=?,latitude=CASE WHEN location=? THEN latitude ELSE NULL END,longitude=CASE WHEN location=? THEN longitude ELSE NULL END WHERE id=?")
    .run(name.trim(), phone, location.trim(), language, consent === true ? 1 : 0, location.trim(), location.trim(), id);
  if (before.location !== location.trim()) enrichFarmerLocation(id, location.trim());
  res.json({ ok: true, id });
});
app.post("/api/farmers/:id/crops", (req, res) => {
  const farmerId = Number(req.params.id);
  const { crop, quantityKg, maturity = "Ready", storageDays = 0, currentPrice } = req.body;
  if (!Number.isInteger(farmerId) || !db.prepare("SELECT id FROM farmers WHERE id=?").get(farmerId))
    return res.status(404).json({ error: "Farmer not found." });
  if (!validCrop({ crop, quantityKg, maturity, storageDays, currentPrice }))
    return res.status(400).json({ error: "Enter a supported crop with valid stock, price and storage values." });
  if (db.prepare("SELECT id FROM crops WHERE farmer_id=? AND crop=? AND active=1").get(farmerId, crop))
    return res.status(409).json({ error: `${crop} is already active for this farmer. Edit that stock record instead.` });
  const result = db.prepare("INSERT INTO crops(farmer_id,crop,quantity_kg,maturity,storage_days,current_price) VALUES(?,?,?,?,?,?)")
    .run(farmerId, crop, quantityKg, maturity, storageDays, currentPrice);
  res.status(201).json({ ok: true, farmerId, cropId: Number(result.lastInsertRowid) });
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
    // Start independent commodity reads together; one slow public API request
    // must not serially delay every farmer in the refresh.
    const marketReads = new Map(
      [...new Set(rows.map((row) => row.crop))].map((crop) => [
        crop,
        getMandiSignal(crop, "Maharashtra", "Nashik"),
      ]),
    );
    let count = 0;
    for (const row of rows) {
      const [weather, market] = await Promise.all([
        getWeather(row.location, row.latitude, row.longitude),
        marketReads.get(row.crop),
      ]);
      const d = decide({
        currentPrice: row.current_price,
        marketAverage: market.available ? market.average : row.current_price,
        alternative: market.alternative,
        quantity: row.quantity_kg,
        storageDays: row.storage_days,
        maturity: row.maturity,
        weather,
      });
      db.prepare(
        "INSERT INTO recommendations(crop_id,action,current_price,forecast_low,forecast_high,expected_gain,confidence,reason,weather_json,market_source,market_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
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
        JSON.stringify(market),
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
        `SELECT f.*,c.crop,c.current_price,c.active,c.needs_review,r.action,r.market_source,r.market_json,r.forecast_low,r.forecast_high,r.id recommendation_id FROM recommendations r JOIN crops c ON c.id=r.crop_id JOIN farmers f ON f.id=c.farmer_id WHERE r.id=? AND r.id=(SELECT MAX(id) FROM recommendations WHERE crop_id=c.id)`,
      )
      .get(key);
    if (!f || !f.active || f.needs_review)
      return res.status(404).json({ error: "Active recommendation not found" });
    if (!f.consent)
      return res.status(409).json({
        error:
          "Farmer consent is required before calling. Add a consented test farmer first.",
      });
    const market = f.market_json ? JSON.parse(f.market_json) : null;
    if (voiceReady() && market?.status !== "live")
      return res.status(409).json({
        error:
          "Live calls are blocked until a fresh AGMARKNET observation is available.",
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
app.use("/api/intelligence", intelligenceRouter);
const server = createServer(app);
attachVoice(server);
server.listen(port, host, () =>
  console.log(`AgriSell API listening on http://${host}:${port}`),
);
