import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/agrisell.db");
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS farmers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
    location TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'Marathi', consent INTEGER NOT NULL DEFAULT 0,
    latitude REAL, longitude REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS crops (
    id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    crop TEXT NOT NULL, quantity_kg REAL NOT NULL, maturity TEXT NOT NULL DEFAULT 'Ready',
    storage_days INTEGER NOT NULL DEFAULT 0, current_price REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crop_id INTEGER NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
    action TEXT NOT NULL, current_price REAL NOT NULL, forecast_low REAL NOT NULL, forecast_high REAL NOT NULL,
    expected_gain REAL NOT NULL, confidence REAL NOT NULL, reason TEXT NOT NULL, weather_json TEXT,
    market_source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recommendation_id INTEGER NOT NULL REFERENCES recommendations(id),
    provider TEXT NOT NULL, provider_id TEXT, status TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (
  !db
    .prepare("PRAGMA table_info(crops)")
    .all()
    .some((column) => column.name === "needs_review")
)
  db.exec(
    "ALTER TABLE crops ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0",
  );
const count = db.prepare("SELECT count(*) count FROM farmers").get().count;
if (!count) {
  const addFarmer = db.prepare(
    "INSERT INTO farmers(name,phone,location,language,consent,latitude,longitude) VALUES(?,?,?,?,?,?,?)",
  );
  const addCrop = db.prepare(
    "INSERT INTO crops(farmer_id,crop,quantity_kg,maturity,storage_days,current_price) VALUES(?,?,?,?,?,?)",
  );
  const seeds = [
    [
      "Ramesh Kumar",
      "+910000000001",
      "Nashik",
      "Marathi",
      0,
      19.9975,
      73.7898,
      "Tomato",
      1000,
      "Ready",
      2,
      24,
    ],
    [
      "Sunita Patil",
      "+910000000002",
      "Lasalgaon",
      "Marathi",
      0,
      20.1415,
      74.2396,
      "Onion",
      2400,
      "Ready",
      0,
      21,
    ],
    [
      "Mahesh Jadhav",
      "+910000000003",
      "Dindori",
      "Hindi",
      0,
      20.2038,
      73.8272,
      "Tomato",
      650,
      "Ready",
      1,
      24,
    ],
  ];
  for (const s of seeds) {
    const f = addFarmer.run(...s.slice(0, 7));
    addCrop.run(f.lastInsertRowid, ...s.slice(7));
  }
}

export function listFarmers() {
  return db
    .prepare(
      `SELECT f.*, c.id crop_id,c.crop,c.quantity_kg,c.maturity,c.storage_days,c.current_price,
    r.id recommendation_id,r.action,r.forecast_low,r.forecast_high,r.expected_gain,r.confidence,r.reason,r.market_source,r.weather_json,r.created_at recommendation_at,
    (SELECT status FROM calls WHERE recommendation_id=r.id ORDER BY id DESC LIMIT 1) call_status
    FROM farmers f JOIN crops c ON c.farmer_id=f.id AND c.active=1
    LEFT JOIN recommendations r ON c.needs_review=0 AND r.id=(SELECT id FROM recommendations WHERE crop_id=c.id ORDER BY id DESC LIMIT 1)
    ORDER BY f.id DESC`,
    )
    .all();
}
