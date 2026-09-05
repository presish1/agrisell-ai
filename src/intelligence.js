const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function mountIntelligence({ api, farmers }) {
  const root = document.querySelector("#intelligence-data");
  if (!root) return;
  try {
    const data = await api("/api/intelligence");
    root.innerHTML = `<section class="demo-console"><p>GEMINI DECISION SUPPORT</p><h2>From farmer conversations to informed decisions</h2><p>Review collected evidence and confirmed stock changes. Analysis uses recorded prices and available weather, never invented market forecasts.</p><div class="demo-controls"><select id="analysis-crop" aria-label="Crop to analyze">${farmers.map((f) => `<option value="${f.crop_id}">${esc(f.name)} · ${esc(f.crop)}</option>`).join("")}</select><button class="primary" id="analyze-crop" ${farmers.length ? "" : "disabled"}>Analyze with Gemini</button><button class="ghost" id="refresh-data">Refresh records</button></div><p id="analysis-result" style="white-space:pre-wrap;line-height:1.8"></p></section><section class="demo-console"><h2>Received from calls · ${data.received.length}</h2>${data.received.map((r) => `<details><summary>Crop ${r.crop_id} · ${esc(r.created_at)} · Captured stock fields</summary><p>${esc(r.transcript)}</p><pre>${esc(r.extracted_json)}</pre></details>`).join("") || "<p>Collected stock information will appear here after a conversation.</p>"}</section><section class="demo-console"><h2>Confirmed database changes · ${data.updates.length}</h2>${data.updates.map((r) => `<p>Crop ${r.crop_id} · ${esc(r.created_at)}<br><code>${esc(r.after_json)}</code></p>`).join("") || "<p>No confirmed changes yet.</p>"}</section><section class="demo-console"><h2>Decision history</h2>${data.reports.map((r) => `<details><summary>Crop ${r.crop_id} · ${esc(r.created_at)}</summary><p style="white-space:pre-wrap;line-height:1.8">${esc(r.report)}</p><details><summary>Supporting source data</summary><pre style="white-space:pre-wrap">${esc(r.context_json)}</pre></details></details>`).join("") || "<p>Run an analysis to create the first report.</p>"}</section>`;
    root.querySelector("#refresh-data").onclick = () =>
      mountIntelligence({ api, farmers });
    root.querySelector("#analyze-crop").onclick = async (e) => {
      e.target.disabled = true;
      const out = root.querySelector("#analysis-result");
      out.textContent = "Retrieving weather and analyzing evidence…";
      try {
        const result = await api(
          `/api/intelligence/${root.querySelector("#analysis-crop").value}/analyze`,
          { method: "POST", body: "{}" },
        );
        out.textContent = result.report;
        root.querySelector("#forecast-evidence")?.remove();
        const forecast = result.context.priceForecast;
        if (forecast) out.insertAdjacentHTML("afterend", `<section id="forecast-evidence" class="forecast-evidence"><h3>Price history & forecast check</h3>${forecast.available ? `<p><b>Experimental estimate: ₹${esc(forecast.estimate)}/kg</b> · ${esc(forecast.targetDate)}</p><p>${esc(forecast.market)} · ${esc(forecast.variety)} · ${esc(forecast.grade)}</p><p>${esc(forecast.evaluation.observations)} daily observations · ${esc(forecast.evaluation.evaluatedPairs)} walk-forward checks · average absolute error ₹${esc(forecast.evaluation.maeKg)}/kg (${esc(forecast.evaluation.mapePercent)}%)</p><p>${esc(forecast.model)}. This is not a published live price or a guarantee.</p><details><summary>View verified source observations</summary>${forecast.history.map(r => `<p>${esc(r.date)} · ₹${esc(r.modalPrice)}/kg</p>`).join("")}</details>` : `<p>${esc(forecast.reason)}</p>`}</section>`);
        root.querySelector("#source-links")?.remove();
        out.insertAdjacentHTML(
          "afterend",
          `<div id="source-links"><b>Sources checked</b>${(result.context.sources || []).map((s) => `<p>${s.url && /^https:\/\//.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)} · ${esc(s.retrievedAt)}</p>`).join("")}</div>`,
        );
      } catch (err) {
        out.textContent = err.message;
      } finally {
        e.target.disabled = false;
      }
    };
    const calls = await api("/api/demo/calls");
    root.insertAdjacentHTML(
      "beforeend",
      `<section class="demo-console"><h2>Conversation archive</h2>${calls.map((c) => `<details><summary>${esc(c.name)} · ${esc(c.language)} · ${esc(c.status)}</summary>${c.messages.map((m) => `<p><b>${m.role === "user" ? "Farmer" : "AgriSell"}</b> · ${esc(m.text)}</p>`).join("")}</details>`).join("") || "<p>No calls yet.</p>"}</section>`,
    );
  } catch (e) {
    root.textContent = e.message;
  }
}
