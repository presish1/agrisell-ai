import "./demo.css";
let poll;
let selectedCrop, selectedLanguage;
export function selectFarmer(cropId) {
  selectedCrop = String(cropId);
  selectedLanguage = undefined;
}
export function unmountDemo() {
  clearInterval(poll);
  poll = undefined;
}
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function mountDemo({ farmers, api, toast }) {
  unmountDemo();
  const header = document.querySelector("main header");
  if (!header) return;
  header.insertAdjacentHTML(
    "afterend",
    `<section class="demo-console"><div class="demo-title"><span class="demo-dot"></span><div><p>CALL A FARMER</p><h2>A conversation goes further.</h2></div><span id="demo-engine">Connecting…</span></div><p class="demo-description">Review their stock, share market prices and plan the next sale.</p><div class="demo-controls"><label>Farmer<select id="demo-farmer">${farmers.map((f) => `<option value="${f.crop_id}">${escape(f.name)} · ${escape(f.crop)} · ${f.quantity_kg} kg</option>`).join("")}</select></label><label>Call language<select id="demo-language"><option>English</option><option>Hindi</option><option>Marathi</option></select></label><button class="ghost" id="demo-open" ${!farmers.length ? "disabled" : ""}>Open phone ↗</button><button class="primary" id="demo-ring" ${!farmers.length ? "disabled" : ""}>Call now</button></div><div class="demo-live" id="demo-live" aria-live="polite">Choose a farmer to start a call.</div></section>`,
  );
  document.querySelector("#demo-open").onclick = () =>
    window.open(
      `/?phone=1&crop=${document.querySelector("#demo-farmer").value}`,
      `agrisell-farmer-${document.querySelector("#demo-farmer").value}`,
    );
  const farmerSelect = document.querySelector("#demo-farmer");
  const languageSelect = document.querySelector("#demo-language");
  if (farmers.some((f) => String(f.crop_id) === selectedCrop))
    farmerSelect.value = selectedCrop;
  else selectedLanguage = undefined;
  const chooseLanguage = () => {
    selectedCrop = farmerSelect.value;
    selectedLanguage =
      farmers.find((f) => String(f.crop_id) === selectedCrop)?.language ||
      "English";
    languageSelect.value = selectedLanguage;
  };
  if (selectedLanguage) languageSelect.value = selectedLanguage;
  else chooseLanguage();
  farmerSelect.onchange = chooseLanguage;
  languageSelect.onchange = () => {
    selectedLanguage = languageSelect.value;
  };
  document.querySelector("#demo-ring").onclick = async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    const cropId = Number(farmerSelect.value);
    const language = languageSelect.value;
    window.open(`/?phone=1&crop=${cropId}`, `agrisell-farmer-${cropId}`);
    try {
      await api("/api/demo/calls", {
        method: "POST",
        body: JSON.stringify({
          cropId,
          language,
        }),
      });
      toast("The farmer screen is ringing.");
      await refresh();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  api("/api/demo/status")
    .then((s) => {
      const el = document.querySelector("#demo-engine");
      if (el) el.textContent = s.gemini ? "Voice ready" : "Gemini key missing";
    })
    .catch(() => {});
  async function refresh() {
    try {
      const calls = await api("/api/demo/calls");
      const el = document.querySelector("#demo-live");
      if (!el) return;
      const call = calls.find(
        (c) =>
          String(c.cropId) === document.querySelector("#demo-farmer")?.value,
      );
      if (!call) return;
      el.innerHTML = `<span class="status-chip">${escape(call.status)}</span><strong>${escape(call.name)}</strong><span>${call.saved ? `Stock saved: ${call.saved.quantityKg} kg · ${call.saved.storageDays} storage days` : call.status === "ended" ? "Call complete · summary available on the farmer’s phone" : "Waiting for the farmer to answer…"}</span>`;
    } catch {}
  }
  refresh();
  poll = setInterval(refresh, 1600);
}
