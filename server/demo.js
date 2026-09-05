import express from "express";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { callReceipt } from "./services/call-receipt.js";
import { stockConfirmation } from "./services/stock-confirmation.js";
import {
  conversation,
  speech,
  transcribe,
  chatModel,
} from "./services/groq.js";
import {
  validProposal,
  completeProposal,
  isConfirmation,
  fallbackReply,
} from "./services/demo-state.js";

export const demoRouter = express.Router();
db.exec(`CREATE TABLE IF NOT EXISTS demo_sessions (
 id TEXT PRIMARY KEY, crop_id INTEGER NOT NULL REFERENCES crops(id), language TEXT NOT NULL,
 status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
); CREATE INDEX IF NOT EXISTS idx_demo_crop_status ON demo_sessions(crop_id,status);
CREATE TABLE IF NOT EXISTS demo_stock_updates (
 id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES demo_sessions(id), crop_id INTEGER NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
const sessions = () =>
  db
    .prepare(
      "SELECT * FROM demo_sessions ORDER BY created_at DESC,rowid DESC LIMIT 50",
    )
    .all()
    .map((row) => ({
      ...JSON.parse(row.payload),
      id: row.id,
      status: row.status,
    }));
export function get(id) {
  const row = db.prepare("SELECT * FROM demo_sessions WHERE id=?").get(id);
  if (!row) throw new Error("Call not found.");
  return { ...JSON.parse(row.payload), id: row.id, status: row.status };
}
export function save(s) {
  db.prepare("UPDATE demo_sessions SET status=?,payload=? WHERE id=?").run(
    s.status,
    JSON.stringify(s),
    s.id,
  );
  return s;
}
export function append(s, role, text) {
  s.messages.push({
    id: randomUUID(),
    role,
    text,
    at: new Date().toISOString(),
  });
}
const locks = new Set();
function endpoint(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}
const active = (s) => {
  if (s.status !== "connected")
    throw new Error("Answer the call before talking.");
};
export function confirm(s) {
  active(s);
  if (!completeProposal(s.pending))
    throw new Error("First provide stock quantity and storage days.");
  const current = db.prepare("SELECT * FROM crops WHERE id=?").get(s.cropId);
  if (
    current.quantity_kg !== s.snapshot.quantityKg ||
    current.storage_days !== s.snapshot.storageDays ||
    current.current_price !== s.snapshot.price ||
    current.active !== s.snapshot.active
  )
    throw new Error(
      "Stock changed in the dashboard during this call. End the call and ring again to review the latest values.",
    );
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE crops SET quantity_kg=?,storage_days=?,active=?,needs_review=1 WHERE id=?",
    ).run(
      s.pending.quantityKg,
      s.pending.storageDays,
      s.pending.quantityKg > 0 ? 1 : 0,
      s.cropId,
    );
    db.prepare(
      "INSERT INTO demo_stock_updates(session_id,crop_id,before_json,after_json) VALUES(?,?,?,?)",
    ).run(
      s.id,
      s.cropId,
      JSON.stringify(s.snapshot),
      JSON.stringify(s.pending),
    );
    s.saved = { ...s.pending, at: new Date().toISOString() };
    s.snapshot = {
      ...s.snapshot,
      ...s.pending,
      active: s.pending.quantityKg > 0 ? 1 : 0,
    };
    s.pending = null;
    append(
      s,
      "assistant",
      stockConfirmation(s.language, s.saved),
    );
    save(s);
    db.exec("COMMIT");
    return s;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
demoRouter.get("/status", (_, res) =>
  res.json({
    groq: Boolean(process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    model: chatModel(),
    stt: "whisper-large-v3-turbo",
    tts: "canopylabs/orpheus-v1-english",
  }),
);
demoRouter.get("/calls", (_, res) => res.json(sessions()));
demoRouter.get(
  "/calls/:id/receipt",
  endpoint((req, res) => {
    const s = get(req.params.id);
    if (s.status !== "ended")
      throw new Error("Receipt is available after the call ends.");
    if (!s.receipt) {
      s.receipt = callReceipt(s);
      save(s);
    }
    res.json(s.receipt);
  }),
);
demoRouter.post(
  "/calls",
  endpoint((req, res) => {
    const f = db
      .prepare(
        "SELECT c.*,f.name FROM crops c JOIN farmers f ON f.id=c.farmer_id WHERE c.id=? AND c.active=1",
      )
      .get(Number(req.body.cropId));
    if (!f) throw new Error("Active crop not found.");
    const old = sessions().find(
      (s) => s.cropId === f.id && ["ringing", "connected"].includes(s.status),
    );
    if (old) return res.json(old);
    const language = ["English", "Hindi", "Marathi"].includes(req.body.language)
      ? req.body.language
      : "English";
    const s = {
      id: randomUUID(),
      cropId: f.id,
      name: f.name,
      crop: f.crop,
      language,
      status: "ringing",
      snapshot: {
        quantityKg: f.quantity_kg,
        storageDays: f.storage_days,
        price: f.current_price,
        active: f.active,
      },
      messages: [],
      pending: null,
      saved: null,
      engine: "Groq",
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO demo_sessions(id,crop_id,language,status,payload) VALUES(?,?,?,?,?)",
    ).run(s.id, f.id, language, s.status, JSON.stringify(s));
    res.status(201).json(s);
  }),
);
demoRouter.get(
  "/calls/:id",
  endpoint((req, res) => res.json(get(req.params.id))),
);
demoRouter.post(
  "/calls/:id/answer",
  endpoint((req, res) => {
    const s = get(req.params.id);
    if (s.status === "connected") return res.json(s);
    if (s.status !== "ringing") throw new Error("This call has ended.");
    s.status = "connected";
    append(
      s,
      "assistant",
      s.language === "English"
        ? `Hello! This is AgriSell, your AI farming assistant. I can help review your stock and available price information. Before we review your ${s.crop.toLowerCase()} sale, how many kilograms do you currently have available?`
        : s.language === "Hindi"
          ? `नमस्ते! मैं एग्रीसेल का एआई सहायक हूँ। मैं आपके माल और उपलब्ध भाव की जानकारी में मदद कर सकता हूँ। आपके पास अभी कितने किलो माल बाकी है?`
          : `नमस्कार! मी अ‍ॅग्रीसेलचा एआय सहाय्यक आहे. मी तुमच्या मालाची माहिती घेण्यासाठी फोन केला आहे. तुमच्याकडे आता किती किलो माल शिल्लक आहे?`,
    );
    res.json(save(s));
  }),
);
demoRouter.post(
  "/calls/:id/turn",
  endpoint(async (req, res) => {
    const id = req.params.id;
    if (locks.has(id)) throw new Error("Please wait for the current response.");
    locks.add(id);
    try {
      const s = get(id);
      active(s);
      const text = req.body.text;
      if (typeof text !== "string" || !text.trim() || text.length > 1500)
        throw new Error("Enter a reply under 1,500 characters.");
      if (s.messages.length >= 100)
        throw new Error("Call turn limit reached. Please start another call.");
      if (isConfirmation(text) && completeProposal(s.pending)) {
        append(s, "user", text);
        return res.json(confirm(s));
      }
      if (
        /^(no|cancel|don't save|do not save|नहीं|नाही)[.!\s]*$/iu.test(
          text.trim(),
        )
      ) {
        s.pending = null;
        append(s, "user", text);
        append(
          s,
          "assistant",
          "No changes saved. Please tell me the correct remaining stock in kilograms.",
        );
        return res.json(save(s));
      }
      let result;
      try {
        result = await conversation(s, text);
        s.engine = chatModel();
        s.warning = null;
      } catch (e) {
        result = fallbackReply(text);
        s.engine = "Scripted fallback";
        s.warning = e.message;
      }
      if (get(id).status !== "connected")
        throw new Error("Call ended before the response arrived.");
      append(s, "user", text);
      s.pending = validProposal(result, s.pending || {});
      let reply = result.reply;
      if (completeProposal(s.pending))
        reply =
          s.language === "English"
            ? `Just to confirm: ${s.pending.quantityKg} kilograms remaining, safe to store for ${s.pending.storageDays} days. Should I save that to your dashboard? Say “yes” or tap Confirm stock.`
            : s.language === "Hindi"
              ? `${s.pending.quantityKg} किलो बाकी है और ${s.pending.storageDays} दिन रख सकते हैं। क्या इसे सहेज दूँ?`
              : `${s.pending.quantityKg} किलो शिल्लक आणि ${s.pending.storageDays} दिवस साठवण. हे जतन करू का?`;
      else if (s.pending.quantityKg !== undefined)
        reply =
          s.language === "English"
            ? `Got it, ${s.pending.quantityKg} kilograms. How many days can you safely store that stock?`
            : s.language === "Hindi"
              ? "इसे कितने दिन सुरक्षित रख सकते हैं?"
              : "हे किती दिवस सुरक्षित ठेवू शकता?";
      append(s, "assistant", reply);
      res.json(save(s));
    } finally {
      locks.delete(id);
    }
  }),
);
demoRouter.post(
  "/calls/:id/confirm",
  endpoint((req, res) => {
    if (locks.has(req.params.id))
      throw new Error("Wait for the current reply.");
    res.json(confirm(get(req.params.id)));
  }),
);
demoRouter.post(
  "/calls/:id/end",
  endpoint((req, res) => {
    const s = get(req.params.id);
    s.status = "ended";
    s.pending = null;
    res.json(save(s));
  }),
);
demoRouter.post(
  "/calls/:id/speech",
  endpoint(async (req, res) => {
    const s = get(req.params.id);
    active(s);
    if (s.language !== "English")
      throw new Error(
        "Use browser speech for Hindi or Marathi. Groq speech here supports English.",
      );
    const message = s.messages.find(
      (m) => m.id === req.body.messageId && m.role === "assistant",
    );
    if (!message) throw new Error("Message not found.");
    const result = await speech(message.text);
    res
      .set("Cache-Control", "no-store")
      .set("X-Speech-Provider", result.provider)
      .type("audio/wav")
      .send(result.audio);
  }),
);
demoRouter.post(
  "/calls/:id/transcribe",
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "8mb" }),
  endpoint(async (req, res) => {
    const s = get(req.params.id);
    active(s);
    if (!Buffer.isBuffer(req.body) || req.body.length < 100)
      throw new Error("No audio received. Record a short reply first.");
    const text = await transcribe(
      req.body,
      req.headers["content-type"] || "audio/webm",
      s.language,
    );
    res.json({ text });
  }),
);
