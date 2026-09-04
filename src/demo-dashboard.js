import "./demo.css";
let poll;
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function mountDemo({ farmers, api, toast }) {
  clearInterval(poll);
  const header = document.querySelector("main header");
  if (!header) return;
  header.insertAdjacentHTML(
    "afterend",
    `<section class="demo-console"><div class="demo-title"><span class="demo-dot"></span><div><p>INTERACTIVE VOICE DEMO</p><h2>Call the farmer. Update the field desk.</h2></div><span id="demo-engine">Connecting…</span></div><p class="demo-description">A call in a separate browser screen. Real AI conversation and speech, no phone number or telephony account needed.</p><div class="demo-controls"><label>Farmer<select id="demo-farmer">${farmers.map((f) => `<option value="${f.crop_id}">${escape(f.name)} · ${escape(f.crop)} · ${f.quantity_kg} kg</option>`).join("")}</select></label><label>Call language<select id="demo-language"><option>English</option><option>Hindi</option><option>Marathi</option></select></label><button class="ghost" id="demo-open" ${!farmers.length ? "disabled" : ""}>↗ Open farmer phone</button><button class="primary" id="demo-ring" ${!farmers.length ? "disabled" : ""}>☎ Ring demo call</button></div><div class="demo-live" id="demo-live" aria-live="polite">1. Open the phone screen. 2. Ring it here. 3. Answer and tell the assistant your current stock.</div></section>`,
  );
  document.querySelector("#demo-open").onclick = () =>
    window.open(
      `/?phone=1&crop=${document.querySelector("#demo-farmer").value}`,
      "agrisell-farmer",
    );
  document.querySelector("#demo-ring").onclick = async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api("/api/demo/calls", {
        method: "POST",
        body: JSON.stringify({
          cropId: Number(document.querySelector("#demo-farmer").value),
          language: document.querySelector("#demo-language").value,
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
      if (el)
        el.textContent = s.groq
          ? `Groq connected · ${s.model}`
          : "Scripted mode · key missing";
    })
    .catch(() => {});
  async function refresh() {
    try {
      const calls = await api("/api/demo/calls");
      const el = document.querySelector("#demo-live");
      if (!el) return;
      const call = calls[0];
      if (!call) return;
      el.innerHTML = `<span class="status-chip">${escape(call.status)}</span><strong>${escape(call.name)}</strong><span>${call.saved ? `Stock saved: ${call.saved.quantityKg} kg · ${call.saved.storageDays} storage days` : call.messages.at(-1) ? escape(call.messages.at(-1).text) : "Waiting for the farmer to answer…"}</span>`;
    } catch {}
  }
  refresh();
  poll = setInterval(refresh, 1600);
}
