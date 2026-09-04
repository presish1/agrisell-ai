export function validProposal(result, pending = {}) {
  const proposal = { ...pending };
  if (
    typeof result.quantityKg === "number" &&
    Number.isFinite(result.quantityKg) &&
    result.quantityKg >= 0 &&
    result.quantityKg <= 1000000
  )
    proposal.quantityKg = result.quantityKg;
  if (
    typeof result.storageDays === "number" &&
    Number.isInteger(result.storageDays) &&
    result.storageDays >= 0 &&
    result.storageDays <= 7
  )
    proposal.storageDays = result.storageDays;
  if (proposal.quantityKg === 0) proposal.storageDays = 0;
  return proposal;
}
export const completeProposal = (p) =>
  p && Number.isFinite(p.quantityKg) && Number.isInteger(p.storageDays);
export const isConfirmation = (text) =>
  /^(yes|yes please|yes correct|correct|confirm|save|save it|yes save it|हाँ|हां|हाँ सही है|हो|होय)[.!\s]*$/iu.test(
    text.trim(),
  );
export function fallbackReply(text) {
  const qty = text.match(
    /(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|kilograms?|kilos?|tonnes?|quintals?)\b/i,
  );
  const days = text.match(/(\d+)\s*days?\b/i);
  return {
    reply:
      "How much stock remains in kilograms, and how many days can you safely store it?",
    quantityKg: qty
      ? Number(qty[1]) *
        (/^tonne/i.test(qty[2]) ? 1000 : /^quintal/i.test(qty[2]) ? 100 : 1)
      : null,
    storageDays: days ? Number(days[1]) : null,
  };
}
