export const prepareStockTool = {
  name: "prepare_stock",
  description:
    "Propose the CURRENT remaining stock and storage days explicitly stated by the farmer in this conversation. Convert tonnes/quintals to kg. Use the latest correction, never copy the database baseline or infer values from yes/no. Call only when both fields are known; otherwise ask for the missing field. This does not save stock. Read the returned values back and wait for confirmation. After yes or haan you MUST call confirm_stock before saying saved; this tool never saves.",
  parameters: {
    type: "OBJECT",
    properties: {
      quantityKg: {
        type: "NUMBER",
        description: "Current remaining stock in kilograms, from 0 to 1000000.",
      },
      storageDays: {
        type: "INTEGER",
        description: "Safe storage days, 0 to 7. Use 0 when no stock remains.",
      },
    },
    required: ["quantityKg", "storageDays"],
  },
};

// Tool arguments are untrusted model output, not permission to write stock.
export function validateStockArguments(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).some(
      (key) => !["quantityKg", "storageDays"].includes(key),
    ) ||
    typeof args.quantityKg !== "number" ||
    !Number.isFinite(args.quantityKg) ||
    args.quantityKg < 0 ||
    args.quantityKg > 1000000 ||
    !Number.isInteger(args.storageDays) ||
    args.storageDays < 0 ||
    args.storageDays > 7
  ) {
    throw new Error(
      "Provide both explicitly stated fields: quantityKg (0–1000000) and integer storageDays (0–7). Ask only for missing or ambiguous information; nothing has been saved.",
    );
  }
  return {
    quantityKg: args.quantityKg,
    storageDays: args.quantityKg === 0 ? 0 : args.storageDays,
  };
}

// Schema-valid model values are not evidence the farmer actually supplied both
// fields. In particular native audio sometimes invents 0 days after kg-only input.
export function validateStockEvidence(args, messages) {
  const proposal = validateStockArguments(args);
  if (proposal.quantityKg === 0) return proposal;
  const hasDays = messages.some((m, i) => {
    if (m.role !== "user") return false;
    if (/\b(days?|today|tomorrow)\b|दिन|दिवस|आज|कल/iu.test(m.text)) return true;
    // A bare number is valid only as the answer to a storage-days question.
    const previous = messages
      .slice(0, i)
      .findLast((x) => x.role === "assistant");
    return (
      /days?|दिन|दिवस/iu.test(previous?.text || "") &&
      /^(?:[0-7०-७]|zero|one|two|three|four|five|six|seven|शून्य|एक|दो|तीन|चार|पांच|पाँच|छह|सात)[.!।\s]*$/iu.test(
        m.text.trim(),
      )
    );
  });
  if (!hasDays)
    throw Error(
      `Storage days have not been stated. The farmer supplied ${proposal.quantityKg} kg. Ask ONLY how many days it can safely stay; do not repeat the introduction or quantity question. Do not invent 0 days. Nothing is prepared or saved.`,
    );
  return proposal;
}
