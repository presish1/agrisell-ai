import "./product.css";

const api = async (path, options = {}) => {
  const r = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("agrisell-token") || ""}`,
    },
    ...options,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Request failed");
  return body;
};
const state = { farmers: [], health: {}, view: "overview", busy: false };
const money = (n) => `₹${Math.abs(Number(n || 0)).toLocaleString("en-IN")}`;
const initials = (n) =>
  n
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2);
const safe = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const tone = (a) =>
  a === "WAIT" ? "wait" : a === "SELL NOW" ? "sell" : "other";
const toast = (message, type = "ok") => {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.className = `toast show ${type}`;
  setTimeout(() => (t.className = "toast"), 3000);
};

async function load() {
  try {
    state.health = await api("/api/health");
    if (state.health.authRequired && !sessionStorage.getItem("agrisell-token"))
      return signIn();
    state.farmers = await api("/api/farmers");
    render();
  } catch (e) {
    if (state.health.authRequired) return signIn(e.message);
    document.querySelector("#app").innerHTML =
      `<div class="fatal"><b>AgriSell API is offline</b><span>${safe(e.message)}</span><code>npm run dev</code></div>`;
  }
}

function signIn(error = "") {
  document.querySelector("#app").innerHTML =
    `<div class="fatal"><b>AgriSell operator access</b><span>Enter the access token configured by your administrator.</span><form id="login"><input type="password" name="token" required aria-label="Access token"><button class="primary">Sign in</button></form><small>${safe(error)}</small></div>`;
  document.querySelector("#login").onsubmit = (e) => {
    e.preventDefault();
    sessionStorage.setItem(
      "agrisell-token",
      new FormData(e.target).get("token"),
    );
    load();
  };
}

function sidebar() {
  return `<aside><div class="brand"><span>अ</span><div><b>AgriSell</b><small>FIELD INTELLIGENCE</small></div></div><div class="season"><small>PILOT REGION</small><b>Nashik, Maharashtra</b><span>Kharif · 2026</span></div><nav>${[
    ["overview", "Grid", "Overview"],
    ["farmers", "Users", "Farmers"],
    ["calls", "Phone", "Call centre"],
  ]
    .map(
      ([id, icon, label]) =>
        `<button data-view="${id}" class="${state.view === id ? "active" : ""}"><i>${icon === "Grid" ? "◫" : icon === "Users" ? "♧" : "⌁"}</i>${label}${id === "farmers" ? `<em>${state.farmers.length}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sources"><p>DATA SOURCES</p><div><i class="live"></i><span><b>Weather</b><small>${state.health.weather || "checking"}</small></span></div><div><i class="${state.health.mandi === "demo" ? "demo" : "live"}"></i><span><b>Mandi prices</b><small>${state.health.mandi || "checking"}</small></span></div><div><i class="${state.health.voice === "simulator" ? "demo" : "live"}"></i><span><b>Voice calls</b><small>${state.health.voice || "checking"}</small></span></div></div><div class="operator"><span>AK</span><div><b>Anita Kulkarni</b><small>Field officer</small></div></div></aside>`;
}

function topbar(title, kicker) {
  return `<header><div><p>${kicker}</p><h1>${title}</h1></div><div class="head-actions"><button class="ghost" id="syncBtn">↻ Run intelligence</button><button class="primary" id="addBtn">＋ Add crop stock</button></div></header>`;
}

function overview() {
  const recs = state.farmers.filter((f) => f.action),
    opportunity = recs.reduce(
      (s, f) => s + Math.max(0, f.expected_gain || 0),
      0,
    ),
    pending = recs.filter((f) => !f.call_status).length;
  return `${topbar("Today’s selling decisions", "FIELD DESK · LIVE OPERATIONS")}<section class="signal-card"><div class="signal-copy"><span class="flag">MORNING SIGNAL</span><h2><strong>${recs.filter((f) => f.action !== "SELL NOW").length}</strong> decisions could<br>change today’s outcome.</h2><p>Each recommendation combines market movement, crop condition, storage capacity and live weather risk.</p><button id="seeQueue">Open decision queue <b>→</b></button></div><div class="radar"><div class="pulse one"></div><div class="pulse two"></div><div class="pulse three"></div><span>₹</span><small>${money(opportunity)}<br>VALUE FOUND</small></div></section><section class="metrics"><article><span>ACTIVE STOCK</span><b>${state.farmers.length}</b><small>Farmer crop records</small></article><article><span>DECISIONS READY</span><b>${recs.length}</b><small>${pending} calls pending</small></article><article><span>VALUE AT STAKE</span><b>${money(opportunity)}</b><small>Expected gross opportunity</small></article><article><span>LIVE CALL DELIVERY</span><b>${state.health.voice === "Twilio" ? "ON" : "DEMO"}</b><small>${state.health.voice === "Twilio" ? "Twilio connected" : "Add credentials to activate"}</small></article></section>${queue(recs)}`;
}

function queue() {
  const rows = state.farmers;
  return `<section class="queue"><div class="section-title"><div><p>BASELINE DECISION ENGINE</p><h3>Decision queue</h3></div><span>${rows.length} active records</span></div>
  <p class="pilot-note">Pilot estimates, not validated forecasts. Review prices and crop condition before acting. Demo market data cannot trigger live calls.</p>
  <div class="cards">${
    rows.length
      ? rows
          .map((f) => {
            const weather = f.weather_json ? JSON.parse(f.weather_json) : null;
            return `<article class="decision"><div class="farmer-line"><span class="avatar">${safe(initials(f.name))}</span><div><b>${safe(f.name)}</b><small>${safe(f.location)} · ${safe(f.language)}</small></div><button class="dots" data-stock="${f.crop_id}" aria-label="Edit stock for ${safe(f.name)}">Edit</button></div>
    <div class="crop-line"><span>${safe(f.crop)}</span><b>${Number(f.quantity_kg).toLocaleString("en-IN")} kg</b><small>${f.storage_days} day storage</small></div>
    ${f.action ? `<div class="action ${tone(f.action)}"><small>RECOMMENDATION</small><b>${f.action}</b><span>Baseline estimate</span></div><div class="prices"><span>Today<b>₹${f.current_price}/kg</b></span><i>→</i><span>Scenario range<b>₹${f.forecast_low}–${f.forecast_high}</b></span></div><p class="reason">${safe(f.reason)}</p><div class="weather-mini"><span>☀ ${weather?.temperature ?? "—"}°C</span><span>☂ ${weather?.rainProbability ?? "—"}% rain</span><small>${safe(weather?.source || "No weather")}</small></div><p class="source-note">${safe(f.market_source)}</p><div class="card-foot"><span class="gain">${f.expected_gain > 0 ? `+${money(f.expected_gain)} net upside` : "No material upside"}</span><button class="call-btn ${f.call_status ? "done" : ""}" data-call="${f.recommendation_id}" ${f.call_status ? "disabled" : ""}>${f.call_status ? "✓ " + safe(f.call_status) : "⌁ Call farmer"}</button></div>` : `<div class="empty-rec"><b>Awaiting analysis</b><span>Run intelligence to create a recommendation.</span></div>`}</article>`;
          })
          .join("")
      : '<div class="empty">No active crop stock yet.</div>'
  }</div></section>`;
}

function farmersView() {
  return `${topbar("Farmers & active stock", "FPO REGISTRY")}<section class="registry"><div class="section-title"><div><p>CURRENT HARVEST</p><h3>${state.farmers.length} active crop records</h3></div></div><div class="registry-table"><div class="tr th"><span>FARMER</span><span>CONTACT</span><span>CROP / STOCK</span><span>STORAGE</span><span>CONSENT</span></div>${state.farmers.map((f) => `<div class="tr"><span class="farmer-cell"><i class="avatar">${initials(f.name)}</i><b>${safe(f.name)}<small>${safe(f.location)}</small></b></span><span>${safe(f.phone)}</span><span><b>${safe(f.crop)}</b><small>${Number(f.quantity_kg).toLocaleString("en-IN")} kg at ₹${f.current_price}/kg</small></span><span>${f.storage_days} days</span><span><i class="consent ${f.consent ? "yes" : ""}">${f.consent ? "Granted" : "Not granted"}</i></span></div>`).join("")}</div></section>`;
}

async function callsView() {
  let calls = [];
  try {
    calls = await api("/api/calls");
  } catch {}
  return `${topbar("Outbound call centre", "VOICE OPERATIONS")}<section class="call-hero"><span>⌁</span><div><p>CALL PROVIDER</p><h2>${state.health.voice === "Twilio" ? "Twilio is live" : "Safe simulation mode"}</h2><small>${state.health.voice === "Twilio" ? "Calls can be placed to consented farmers." : "Calls are logged but no phone is dialled until credentials and CALLS_ENABLED=true are set."}</small></div></section><section class="queue"><div class="section-title"><div><p>CALL LOG</p><h3>Recent activity</h3></div></div><div class="call-log">${calls.length ? calls.map((c) => `<div><span class="avatar">${initials(c.name)}</span><b>${safe(c.name)}<small>${safe(c.message)}</small></b><i>${safe(c.status)}</i><time>${new Date(c.created_at + "Z").toLocaleString()}</time></div>`).join("") : '<div class="empty">No calls have been placed yet.</div>'}</div></section>`;
}

function modal() {
  return `<div class="modal" id="modal"><form id="farmerForm"><button type="button" class="close">×</button><p>NEW ACTIVE CROP</p><h2>Record harvest stock</h2><small>Only collect information needed to produce and deliver a selling recommendation.</small><div class="form"><label>Farmer name<input name="name" required placeholder="Ramesh Kumar"></label><label>Phone in E.164 format<input name="phone" required placeholder="+919876543210"></label><label>Village / location<input name="location" required value="Nashik"></label><label>Preferred language<select name="language"><option>Marathi</option><option>Hindi</option><option>English</option></select></label><label>Crop<select name="crop"><option>Tomato</option><option>Onion</option><option>Grapes</option><option>Potato</option></select></label><label>Quantity in kg<input name="quantityKg" required type="number" min="1" value="1000"></label><label>Today’s price ₹/kg<input name="currentPrice" required type="number" min="1" step=".1" value="24"></label><label>Safe storage days<input name="storageDays" required type="number" min="0" max="7" value="1"></label><label>Crop maturity<select name="maturity"><option>Ready</option><option>Near ready</option><option>Overripe</option></select></label><label class="check"><input name="consent" type="checkbox"><span><b>Farmer consent recorded</b><small>Required before AgriSell can place a call.</small></span></label></div><button class="primary submit">Save and add to analysis</button></form></div>`;
}

async function render() {
  let content =
    state.view === "overview"
      ? overview()
      : state.view === "farmers"
        ? farmersView()
        : await callsView();
  document.querySelector("#app").innerHTML =
    `<div class="app">${sidebar()}<main>${content}</main></div>${modal()}<div class="modal" id="stockModal"></div><div class="toast" id="toast"></div>`;
  bind();
}
function bind() {
  document
    .querySelectorAll("[data-stock]")
    .forEach(
      (button) =>
        (button.onclick = () => editStock(Number(button.dataset.stock))),
    );
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        state.view = b.dataset.view;
        render();
      }),
  );
  document.querySelector("#addBtn").onclick = () =>
    document.querySelector("#modal").classList.add("open");
  document.querySelector(".close").onclick = () =>
    document.querySelector("#modal").classList.remove("open");
  document
    .querySelector("#seeQueue")
    ?.addEventListener("click", () =>
      document.querySelector(".queue").scrollIntoView({ behavior: "smooth" }),
    );
  document.querySelector("#syncBtn").onclick = async () => {
    if (state.busy) return;
    state.busy = true;
    toast("Collecting weather and mandi signals…");
    try {
      const r = await api("/api/recommendations/run", { method: "POST" });
      state.farmers = await api("/api/farmers");
      render();
      toast(`${r.count} recommendations refreshed.`);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      state.busy = false;
    }
  };
  document.querySelector("#farmerForm").onsubmit = async (e) => {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.target));
    raw.quantityKg = Number(raw.quantityKg);
    raw.currentPrice = Number(raw.currentPrice);
    raw.storageDays = Number(raw.storageDays);
    raw.consent = raw.consent === "on";
    try {
      await api("/api/farmers", { method: "POST", body: JSON.stringify(raw) });
      state.farmers = await api("/api/farmers");
      document.querySelector("#modal").classList.remove("open");
      render();
      toast("Crop stock saved. Run intelligence when ready.");
    } catch (err) {
      toast(err.message, "error");
    }
  };
  document.querySelectorAll("[data-call]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Queuing call…";
        try {
          const r = await api(`/api/recommendations/${b.dataset.call}/call`, {
            method: "POST",
          });
          state.farmers = await api("/api/farmers");
          render();
          toast(
            r.provider === "twilio"
              ? "Live call queued with Twilio."
              : "Call simulated and logged.",
          );
        } catch (e) {
          b.disabled = false;
          b.textContent = "⌁ Call farmer";
          toast(e.message, "error");
        }
      }),
  );
}
function editStock(id) {
  const farmer = state.farmers.find((f) => f.crop_id === id),
    modal = document.querySelector("#stockModal");
  modal.innerHTML = `<form id="stockForm"><button type="button" class="close" id="closeStock">×</button><p>UPDATE HARVEST STOCK</p><h2>${safe(farmer.name)}</h2><small>Set quantity to zero when the crop has been sold. A new analysis is required after changes.</small><div class="form"><label>Remaining quantity (kg)<input name="quantityKg" type="number" min="0" required value="${farmer.quantity_kg}"></label><label>Safe storage days<input name="storageDays" type="number" min="0" max="7" required value="${farmer.storage_days}"></label><label>Current price ₹/kg<input name="currentPrice" type="number" min="1" step=".1" required value="${farmer.current_price}"></label></div><button class="primary submit">Update stock</button></form>`;
  modal.classList.add("open");
  document.querySelector("#closeStock").onclick = () =>
    modal.classList.remove("open");
  document.querySelector("#stockForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(
      [...new FormData(e.target)].map(([k, v]) => [k, Number(v)]),
    );
    try {
      await api(`/api/crops/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      state.farmers = await api("/api/farmers");
      render();
      toast("Stock updated. Run intelligence for a fresh recommendation.");
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
load();
