import "./product.css";
import "./refined.css";
import { mountDemo, unmountDemo, selectFarmer } from "./demo-dashboard.js";

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
const state = {
  farmers: [],
  profiles: [],
  health: {},
  marketPrices: null,
  marketLoading: false,
  view: "overview",
  busy: false,
};
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
const farmerProfiles = () => {
  const profiles = new Map();
  for (const row of state.profiles) {
    if (!profiles.has(row.id)) profiles.set(row.id, { ...row, crops: [] });
    if (row.crop_id) profiles.get(row.id).crops.push(row);
  }
  return [...profiles.values()];
};
const activeFarmerProfiles = () =>
  farmerProfiles().filter((profile) =>
    profile.crops.some((crop) => Boolean(crop.active)),
  );
const refreshFarmerState = async () => {
  [state.farmers, state.profiles] = await Promise.all([
    api("/api/farmers"),
    api("/api/farmer-profiles"),
  ]);
};
const tone = (a) =>
  a === "WAIT" ? "wait" : a === "SELL NOW" ? "sell" : "other";
const parsed = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
function marketEvidence(market) {
  if (!market)
    return '<div class="market-evidence unavailable"><span>MANDI EVIDENCE</span><b>Run intelligence to retrieve prices</b></div>';
  if (market.status !== "live")
    return `<div class="market-evidence unavailable"><span>AGMARKNET · UNAVAILABLE</span><b>No fresh wholesale observation</b><small>${safe(market.reason || "Source did not return current data")}</small></div>`;
  const observations = (market.observations || [])
    .slice(0, 3)
    .map(
      (row) =>
        `<li><b>${safe(row.market)}</b><span>₹${Number(row.modalPrice).toLocaleString("en-IN")}/kg</span><small>${safe(row.variety)}</small></li>`,
    )
    .join("");
  return `<div class="market-evidence"><div class="market-head"><span>AGMARKNET · ${safe(market.arrivalDate)}</span><a href="${safe(market.sourceUrl)}" target="_blank" rel="noopener noreferrer">Government source ↗</a></div><div class="market-stats"><p><small>Median modal</small><b>₹${market.current}/kg</b></p><p><small>Observed range</small><b>₹${market.low}–${market.high}</b></p><p><small>Coverage</small><b>${market.records} rows · ${market.markets} markets</b></p></div>${observations ? `<ol>${observations}</ol>` : ""}<footer>Wholesale observations · converted from ₹/quintal · verify variety, grade and buyer quote</footer></div>`;
}
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
    await refreshFarmerState();
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
    ["prices", "Prices", "Live prices"],
    ["farmers", "Users", "Farmers"],
    ["calls", "Phone", "Call centre"],
    ["intelligence", "Grid", "Data & decisions"],
  ]
    .map(
      ([id, icon, label]) =>
        `<button data-view="${id}" class="${state.view === id ? "active" : ""}"><i>${icon === "Grid" ? "◫" : icon === "Users" ? "♧" : icon === "Prices" ? "₹" : "⌁"}</i>${label}${id === "farmers" ? `<em>${activeFarmerProfiles().length}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sources"><p>DATA SOURCES</p><div><i class="live"></i><span><b>Weather</b><small>${state.health.weather || "checking"}</small></span></div><div><i class="demo"></i><span><b>Mandi prices</b><small>${state.health.mandi || "checking"}</small></span></div><div><i class="${state.health.voice === "simulator" ? "demo" : "live"}"></i><span><b>Voice calls</b><small>${state.health.voice || "checking"}</small></span></div></div><div class="operator"><span>AK</span><div><b>Anita Kulkarni</b><small>Field officer</small></div></div></aside>`;
}

function topbar(title, kicker) {
  return `<header><div><p>${kicker}</p><h1>${title}</h1></div><div class="head-actions"><button class="ghost" id="syncBtn">↻ Refresh insights</button><button class="primary" id="addBtn">＋ Add farmer</button></div></header>`;
}

function overview() {
  const profileCount = activeFarmerProfiles().length;
  const total = state.farmers.reduce((n, f) => n + Number(f.quantity_kg), 0);
  const urgent = state.farmers.filter(
    (f) => Number(f.storage_days) <= 1,
  ).length;
  return `${topbar("The field desk", "NASHIK, MAHARASHTRA")}<section class="desk-summary"><div><span>Active farmers</span><strong>${profileCount}</strong></div><div><span>Active vegetables</span><strong>${state.farmers.length}</strong></div><div><span>Stock on hand</span><strong>${total.toLocaleString("en-IN")} <small>kg</small></strong></div><div><span>Needs attention</span><strong>${urgent}<small> limited storage</small></strong></div></section><section class="stock-board"><div class="section-title"><h2>Farmers & stock</h2><span>Latest recorded information</span></div><div class="stock-table"><div class="stock-row stock-heading"><span>Farmer</span><span>Crop</span><span>Stock</span><span>Safe storage</span><span></span></div>${state.farmers.map((f) => `<div class="stock-row"><div><b>${safe(f.name)}</b><small>${safe(f.location)} · ${safe(f.language)}</small></div><span>${safe(f.crop)}</span><strong>${Number(f.quantity_kg).toLocaleString("en-IN")} <small>kg</small></strong><span class="${f.storage_days <= 1 ? "storage-urgent" : ""}">${f.storage_days} days</span><button class="ghost" data-stock="${f.crop_id}">Edit stock ↗</button></div>`).join("") || '<p class="empty">Add your first farmer to start calling.</p>'}</div></section>`;
}

function queue() {
  const rows = state.farmers;
  return `<section class="queue"><div class="section-title"><div><p>BASELINE DECISION ENGINE</p><h3>Decision queue</h3></div><span>${rows.length} active records</span></div>
  <p class="pilot-note">Pilot estimates, not validated forecasts. Review prices, variety, grade and crop condition before acting. Missing or stale mandi data cannot trigger live calls.</p>
  <div class="cards">${
    rows.length
      ? rows
          .map((f) => {
            const weather = f.weather_json ? JSON.parse(f.weather_json) : null;
            const market = parsed(f.market_json);
            return `<article class="decision"><div class="farmer-line"><span class="avatar">${safe(initials(f.name))}</span><div><b>${safe(f.name)}</b><small>${safe(f.location)} · ${safe(f.language)}</small></div><button class="dots" data-stock="${f.crop_id}" aria-label="Edit stock for ${safe(f.name)}">Edit</button></div>
    <div class="crop-line"><span>${safe(f.crop)}</span><b>${Number(f.quantity_kg).toLocaleString("en-IN")} kg</b><small>${f.storage_days} day storage</small></div>
    ${f.action ? `<div class="action ${tone(f.action)}"><small>RECOMMENDATION</small><b>${f.action}</b><span>Baseline estimate</span></div><div class="prices"><span>Farmer-recorded<b>₹${f.current_price}/kg</b></span><i>→</i><span>Scenario band<b>₹${f.forecast_low}–${f.forecast_high}</b></span></div><p class="reason">${safe(f.reason)}</p><div class="weather-mini"><span>☀ ${weather?.temperature ?? "—"}°C</span><span>☂ ${weather?.rainProbability ?? "—"}% rain</span><small>${safe(weather?.source || "No weather")}</small></div>${marketEvidence(market)}<div class="card-foot"><span class="gain">${f.expected_gain > 0 ? `+${money(f.expected_gain)} estimated upside` : "No material upside"}</span><button class="call-btn ${f.call_status ? "done" : ""}" data-call="${f.recommendation_id}" ${f.call_status ? "disabled" : ""}>${f.call_status ? "✓ " + safe(f.call_status) : "⌁ Call farmer"}</button></div>` : `<div class="empty-rec"><b>Awaiting analysis</b><span>Run intelligence to create a recommendation.</span></div>`}</article>`;
          })
          .join("")
      : '<div class="empty">No active crop stock yet.</div>'
  }</div></section>`;
}

function profileCard(farmer) {
  const crops = farmer.crops.length
    ? farmer.crops
        .map(
          (crop) =>
            `<div class="${crop.active ? "" : "inactive-crop"}"><span><b>${safe(crop.crop)}${crop.active ? "" : " · sold"}</b><small>${Number(crop.quantity_kg).toLocaleString("en-IN")} kg · ${crop.storage_days} safe days · ₹${crop.current_price}/kg</small></span>${crop.active ? `<button class="ghost compact" data-stock="${crop.crop_id}">Edit stock</button><button class="primary compact" data-direct-call="${crop.crop_id}">Call</button>` : ""}</div>`,
        )
        .join("")
    : '<p class="no-crops">No stock history yet. Add a vegetable when the next harvest is ready.</p>';
  return `<article class="profile-card"><header><span class="farmer-cell"><i class="avatar">${safe(initials(farmer.name))}</i><b>${safe(farmer.name)}<small>${safe(farmer.location)} · ${safe(farmer.language)}</small></b></span><button class="ghost compact" data-profile="${farmer.id}">Edit profile</button></header><div class="profile-contact"><span>${safe(farmer.phone)}</span><i class="consent ${farmer.consent ? "yes" : ""}">${farmer.consent ? "Call consent granted" : "Call consent not recorded"}</i></div><div class="profile-crops">${crops}</div><button class="add-crop" data-add-crop="${farmer.id}">＋ Add vegetable stock</button></article>`;
}

function farmersView() {
  const profiles = farmerProfiles();
  const active = profiles.filter((profile) =>
    profile.crops.some((crop) => Boolean(crop.active)),
  );
  const inactive = profiles.filter(
    (profile) => !profile.crops.some((crop) => Boolean(crop.active)),
  );
  const activeCards = active.length
    ? active.map(profileCard).join("")
    : '<p class="empty">No farmers currently have active stock.</p>';
  const inactiveProfiles = inactive.length
    ? `<details class="inactive-profiles"><summary><span>Inactive profiles</span><b>${inactive.length}</b><small>No current stock · open to reactivate</small></summary><div class="profile-grid">${inactive.map(profileCard).join("")}</div></details>`
    : "";
  return `${topbar("Farmer profiles", "FPO REGISTRY")}<section class="registry profile-registry"><div class="section-title"><div><p>ACTIVE FARMERS</p><h3>${active.length} profiles · ${state.farmers.length} active vegetables</h3></div></div><div class="profile-grid">${activeCards}</div>${inactiveProfiles}</section>`;
}

function pricesView() {
  const data = state.marketPrices;
  let body;
  if (state.marketLoading || !data)
    body = `<section class="price-state"><span class="price-loader"></span><p>Opening the government mandi feed</p><small>Checking Nashik vegetable observations…</small></section>`;
  else if (data.status !== "live")
    body = `<section class="price-state outage"><span>!</span><p>Live mandi feed is temporarily unavailable</p><small>${safe(data.reason)}. No old or estimated prices are being shown.</small><button class="primary" id="refreshPrices">Try the source again</button></section>`;
  else {
    const rows = data.prices
      .map(
        (price) =>
          `<details class="price-row" data-commodity="${safe(price.commodity.toLowerCase())}"><summary><span class="produce-mark">${safe(price.commodity.slice(0, 2).toUpperCase())}</span><b>${safe(price.commodity)}<small>${price.varieties.length} ${price.varieties.length === 1 ? "variety" : "varieties"}</small></b><strong>₹${price.current}<small>median modal / kg</small></strong><span>₹${price.low}–${price.high}<small>observed range</small></span><span>${price.markets}<small>${price.markets === 1 ? "market" : "markets"}</small></span><time>${safe(price.arrivalDate)}</time><i>⌄</i></summary><div class="price-observations">${price.observations
            .slice(0, 6)
            .map(
              (row) =>
                `<div><b>${safe(row.market)}</b><span>${safe(row.variety)}</span><span>${safe(row.grade)}</span><strong>₹${row.modalPrice}/kg</strong><small>₹${row.minPrice ?? "—"}–${row.maxPrice ?? "—"}</small></div>`,
            )
            .join("")}</div></details>`,
      )
      .join("");
    body = `<section class="market-tape"><div><p>FRESH VEGETABLES</p><b>${data.commodities}</b><small>commodities reported</small></div><div><p>WHOLESALE ROWS</p><b>${data.records}</b><small>validated observations</small></div><div><p>LATEST ARRIVAL DATE</p><b>${safe(data.latestDate)}</b><small>Nashik district</small></div><a href="${safe(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open government source ↗</a></section>${data.truncated ? '<p class="market-warning">The government response exceeded 1,000 rows; this view shows the returned portion.</p>' : ""}<section class="price-board"><div class="price-tools"><div><p>AGMARKNET WHOLESALE BOARD</p><h2>Vegetable prices across Nashik mandis</h2></div><label>Search produce<input id="priceSearch" type="search" placeholder="Tomato, onion, potato…"></label><button class="ghost" id="refreshPrices">↻ Refresh source</button></div><div class="price-legend"><span>Vegetable</span><span>Median modal</span><span>Range</span><span>Coverage</span><span>Arrival date</span></div><div id="priceRows">${rows}</div><footer>Prices are wholesale observations converted from ₹/quintal to ₹/kg—not guaranteed buyer quotes. Open a row to inspect market, variety and grade.</footer></section>`;
  }
  return `${topbar("Live vegetable prices", "AGMARKNET · NASHIK MANDIS")}${body}`;
}

async function callsView() {
  let calls = [];
  try {
    calls = await api("/api/demo/calls");
  } catch {}
  return `${topbar("Calls", "FARMER CONVERSATIONS")}<section class="stock-board"><div class="section-title"><h2>Recent calls</h2><span>${calls.length} conversations</span></div><div class="conversation-list">${calls.map((call) => `<details><summary><b>${safe(call.name)}</b><span>${safe(call.language)}</span><span>${safe(call.status)}</span><time>${new Date(call.createdAt).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></summary><div>${call.messages.map((message) => `<p><b>${message.role === "user" ? "Farmer" : "AgriSell"}</b> ${safe(message.text)}</p>`).join("") || "<p>No conversation recorded.</p>"}</div></details>`).join("") || '<p class="empty">Your calls will appear here.</p>'}</div></section>`;
}

function modal() {
  return `<div class="modal" id="modal"><form id="farmerForm"><button type="button" class="close">×</button><p>NEW ACTIVE CROP</p><h2>Record harvest stock</h2><small>Only collect information needed to produce and deliver a selling recommendation.</small><div class="form"><label>Farmer name<input name="name" required placeholder="Ramesh Kumar"></label><label>Phone in E.164 format<input name="phone" required placeholder="+919876543210"></label><label>Village / location<input name="location" required value="Nashik"></label><label>Preferred language<select name="language"><option>Marathi</option><option>Hindi</option><option>English</option></select></label><label>Crop<select name="crop"><option>Tomato</option><option>Onion</option><option>Grapes</option><option>Potato</option></select></label><label>Quantity in kg<input name="quantityKg" required type="number" min="1" value="1000"></label><label>Today’s price ₹/kg<input name="currentPrice" required type="number" min="1" step=".1" value="24"></label><label>Safe storage days<input name="storageDays" required type="number" min="0" max="7" value="1"></label><label>Crop maturity<select name="maturity"><option>Ready</option><option>Near ready</option><option>Overripe</option></select></label><label class="check"><input name="consent" type="checkbox"><span><b>Farmer consent recorded</b><small>Required before AgriSell can place a call.</small></span></label></div><button class="primary submit">Save and add to analysis</button></form></div>`;
}

async function render() {
  let content =
    state.view === "overview"
      ? overview()
      : state.view === "prices"
        ? pricesView()
        : state.view === "farmers"
          ? farmersView()
          : state.view === "intelligence"
            ? topbar("Data & decisions", "COLLECTED EVIDENCE") +
              '<section id="intelligence-data">Loading received information…</section>'
            : await callsView();
  document.querySelector("#app").innerHTML =
    `<div class="app">${sidebar()}<main>${content}</main></div>${modal()}<div class="modal" id="stockModal"></div><div class="modal" id="profileModal"></div><div class="modal" id="cropModal"></div><div class="toast" id="toast"></div>`;
  bind();
  if (["overview", "calls"].includes(state.view))
    mountDemo({ farmers: state.farmers, api, toast });
  else unmountDemo();
  if (state.view === "prices" && !state.marketPrices && !state.marketLoading)
    loadPrices();
  if (state.view === "intelligence")
    import("./intelligence.js").then((m) =>
      m.mountIntelligence({ api, farmers: state.farmers }),
    );
}
function bind() {
  document
    .querySelector("#refreshPrices")
    ?.addEventListener("click", () => loadPrices(true));
  document.querySelector("#priceSearch")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    document.querySelectorAll(".price-row").forEach((row) => {
      row.hidden = !row.dataset.commodity.includes(query);
    });
  });
  document
    .querySelectorAll("[data-stock]")
    .forEach(
      (button) =>
        (button.onclick = () => editStock(Number(button.dataset.stock))),
    );
  document.querySelectorAll("[data-stock]").forEach(button => {
    if (button.closest(".profile-card")) return;
    const cropId = Number(button.dataset.stock);
    const farmer = state.farmers.find(f => f.crop_id === cropId);
    const callButton = document.createElement("button");
    callButton.className = "primary";
    callButton.textContent = "Call";
    callButton.setAttribute("aria-label", `Call ${farmer?.name || "farmer"}`);
    button.insertAdjacentElement("afterend", callButton);
    callButton.onclick = () => callFarmer(cropId, callButton);
  });
  document.querySelectorAll("[data-direct-call]").forEach(button =>
    button.addEventListener("click", () => callFarmer(Number(button.dataset.directCall), button)),
  );
  document.querySelectorAll("[data-profile]").forEach(button =>
    button.addEventListener("click", () => editProfile(Number(button.dataset.profile))),
  );
  document.querySelectorAll("[data-add-crop]").forEach(button =>
    button.addEventListener("click", () => addCrop(Number(button.dataset.addCrop))),
  );
  document.querySelectorAll("[data-call]").forEach(button => {
    button.disabled = false;
    button.textContent = "Call farmer";
  });
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
      await refreshFarmerState();
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
      const created = await api("/api/farmers", { method: "POST", body: JSON.stringify(raw) });
      await refreshFarmerState();
      selectFarmer(created.cropId);
      state.view = "overview";
      document.querySelector("#modal").classList.remove("open");
      render();
      toast("Farmer created and selected. Choose Call now to ring their phone.");
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
          const farmer = state.farmers.find(f => String(f.recommendation_id) === b.dataset.call);
          if (!farmer) throw Error("Farmer record not found. Refresh and try again.");
          window.open(`/?phone=1&crop=${farmer.crop_id}`, `agrisell-farmer-${farmer.crop_id}`);
          await api("/api/demo/calls", {
            method: "POST",
            body: JSON.stringify({cropId: farmer.crop_id, language: farmer.language}),
          });
          await refreshFarmerState();
          render();
          toast("The farmer’s phone is ringing.");
        } catch (e) {
          b.disabled = false;
          b.textContent = "⌁ Call farmer";
          toast(e.message, "error");
        }
      }),
  );
}
async function callFarmer(cropId, button) {
  const farmer = state.farmers.find(f => f.crop_id === cropId);
  if (!farmer) return toast("Farmer crop record not found.", "error");
  button.disabled = true;
  selectFarmer(cropId);
  window.open(`/?phone=1&crop=${cropId}`, `agrisell-farmer-${cropId}`);
  try {
    await api("/api/demo/calls", { method: "POST", body: JSON.stringify({ cropId, language: farmer.language }) });
    toast(`${farmer.name}’s ${farmer.crop.toLowerCase()} call is ringing.`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}
async function loadPrices(force = false) {
  if (state.marketLoading) return;
  state.marketLoading = true;
  render();
  try {
    state.marketPrices = await api(
      `/api/market/vegetables${force ? "?refresh=1" : ""}`,
    );
  } catch (error) {
    state.marketPrices = { status: "unavailable", reason: error.message };
  } finally {
    state.marketLoading = false;
    if (state.view === "prices") render();
  }
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
      await refreshFarmerState();
      render();
      toast("Stock updated. Run intelligence for a fresh recommendation.");
    } catch (error) {
      toast(error.message, "error");
    }
  };
}
function editProfile(id) {
  const farmer = farmerProfiles().find(f => f.id === id);
  const modal = document.querySelector("#profileModal");
  if (!farmer || !modal) return;
  modal.innerHTML = `<form id="profileForm"><button type="button" class="close">×</button><p>FARMER PROFILE</p><h2>Edit ${safe(farmer.name)}</h2><small>These details apply to every vegetable recorded for this farmer.</small><div class="form"><label>Farmer name<input name="name" required value="${safe(farmer.name)}"></label><label>Phone in E.164 format<input name="phone" required value="${safe(farmer.phone)}"></label><label>Village / location<input name="location" required value="${safe(farmer.location)}"></label><label>Preferred language<select name="language">${["Marathi","Hindi","English"].map(x => `<option ${x === farmer.language ? "selected" : ""}>${x}</option>`).join("")}</select></label><label class="check"><input name="consent" type="checkbox" ${farmer.consent ? "checked" : ""}><span><b>Farmer consent recorded</b><small>Applies to calls for every crop.</small></span></label></div><button class="primary submit">Save profile</button></form>`;
  modal.classList.add("open");
  modal.querySelector(".close").onclick = () => modal.classList.remove("open");
  modal.querySelector("#profileForm").onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.consent = body.consent === "on";
    try {
      await api(`/api/farmers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await refreshFarmerState();
      modal.classList.remove("open");
      render();
      toast("Farmer profile updated across all vegetables.");
    } catch (error) { toast(error.message, "error"); }
  };
}
function addCrop(id) {
  const farmer = farmerProfiles().find(f => f.id === id);
  const modal = document.querySelector("#cropModal");
  if (!farmer || !modal) return;
  const active = new Set(farmer.crops.filter(f => f.active).map(f => f.crop));
  const available = ["Tomato","Onion","Grapes","Potato"].filter(crop => !active.has(crop));
  if (!available.length) return toast("All supported vegetables are already active for this farmer.");
  modal.innerHTML = `<form id="cropForm"><button type="button" class="close">×</button><p>ANOTHER VEGETABLE</p><h2>Add stock for ${safe(farmer.name)}</h2><small>The new crop gets its own stock record, messages, call history and recommendation.</small><div class="form"><label>Vegetable<select name="crop">${available.map(crop => `<option>${crop}</option>`).join("")}</select></label><label>Quantity in kg<input name="quantityKg" required type="number" min="1" value="500"></label><label>Current price ₹/kg<input name="currentPrice" required type="number" min="1" step=".1" value="24"></label><label>Safe storage days<input name="storageDays" required type="number" min="0" max="7" value="1"></label><label>Crop maturity<select name="maturity"><option>Ready</option><option>Near ready</option><option>Overripe</option></select></label></div><button class="primary submit">Add vegetable</button></form>`;
  modal.classList.add("open");
  modal.querySelector(".close").onclick = () => modal.classList.remove("open");
  modal.querySelector("#cropForm").onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.quantityKg = Number(body.quantityKg);
    body.currentPrice = Number(body.currentPrice);
    body.storageDays = Number(body.storageDays);
    try {
      const created = await api(`/api/farmers/${id}/crops`, { method: "POST", body: JSON.stringify(body) });
      await refreshFarmerState();
      selectFarmer(created.cropId);
      modal.classList.remove("open");
      render();
      toast(`${body.crop} added to ${farmer.name} and selected for calling.`);
    } catch (error) { toast(error.message, "error"); }
  };
}
if (new URLSearchParams(location.search).has("phone")) {
  import("./phone.js").then((module) => module.startPhone());
} else {
  load();
  setInterval(async () => {
    if (document.querySelector(".modal.open") || document.hidden) return;
    try {
      const [farmers, profiles] = await Promise.all([api("/api/farmers"), api("/api/farmer-profiles")]);
      if (JSON.stringify(farmers) !== JSON.stringify(state.farmers) || JSON.stringify(profiles) !== JSON.stringify(state.profiles)) {
        state.farmers = farmers;
        state.profiles = profiles;
        render();
      }
    } catch {}
  }, 2000);
}
