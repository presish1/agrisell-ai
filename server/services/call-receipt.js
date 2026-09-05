export function callReceipt(session) {
  const saved = session.saved;
  const lines = saved
    ? [
        `Confirmed ✓`,
        `${session.name}, your ${session.crop.toLowerCase()} stock is updated.`,
        `${saved.quantityKg.toLocaleString("en-IN")} kg remaining · ${saved.storageDays} safe storage days`,
        `Saved ${new Date(saved.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
      ]
    : [
        "Call complete",
        `${session.name}, no new stock changes were confirmed during this call. Your previous record is unchanged.`,
      ];
  const advice = session.lastAdvice;
  const baseline = saved || session.snapshot;
  const matches =
    advice?.context?.farmer?.quantity_kg === baseline.quantityKg &&
    advice?.context?.farmer?.storage_days === baseline.storageDays;
  lines.push("Key insights");
  if (saved)
    lines.push(
      saved.quantityKg === 0
        ? "No stock remaining. This crop is now inactive."
        : saved.storageDays === 0
          ? "No safe storage window reported. Check current buyer quotes promptly."
          : `Plan your sale within the ${saved.storageDays}-day storage window you reported.`,
    );
  if (matches) {
    const report = advice.report.replace(/\*\*/g, "");
    // Voice advice is deliberately detailed; an SMS notification should be
    // scannable. Keep the farmer-facing facts and remove internal payloads.
    const useful = report
      .split(/\n+/)
      .filter(line => line && !/^Forecast days:/i.test(line) && !/^Decision:\s*\{/i.test(line))
      .map(line => line.replace(/^Field desk:\s*/i, "").replace(/^Recorded price\s*/i, "Recorded price "))
      .filter((line, index, all) => all.indexOf(line) === index);
    const decision = advice.context?.decision;
    if (decision?.action) useful.push(`Recommended next step: ${decision.action}.`);
    lines.push(...useful);
  }
  else
    lines.push(
      `Last recorded price: ₹${session.snapshot.price}/kg (field-desk record, not a live buyer quote).`,
      "Fresh market and weather advice was not saved for this stock update. Ask AgriSell to check before deciding.",
    );
  return {
    id: session.id,
    title: saved
      ? "Confirmed — stock updated"
      : "Call complete — no new changes",
    body: lines.join("\n\n"),
    createdAt: new Date().toISOString(),
    sources: matches
      ? advice.context.sources
      : [
          {
            name: "AgriSell field desk · farmer-confirmed call record",
            url: null,
          },
        ],
    transport: "in-app",
  };
}
