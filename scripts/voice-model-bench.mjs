import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
// Isolated, read-only provider comparison. Does not touch farmer records.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
for (const model of process.argv.slice(2)) {
  let session,
    pending,
    started,
    toolEnd,
    audio = false,
    results = [];
  try {
    session = await ai.live.connect({
      model,
      config: {
        responseModalities: ["AUDIO"],
        outputAudioTranscription: {},
        thinkingConfig: model.includes("3.1")
          ? { thinkingLevel: "minimal" }
          : { thinkingBudget: 0 },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        systemInstruction:
          "You are a concise farming assistant. Always call read_stock when asked about stock. Say only the stock quantity and storage days from the tool, in one sentence. No preamble.",
        tools: [
          {
            functionDeclarations: [
              { name: "read_stock", description: "Read current saved stock." },
            ],
          },
        ],
      },
      callbacks: {
        onmessage: (event) => {
          for (const call of event.toolCall?.functionCalls || []) {
            toolEnd = performance.now();
            session.sendToolResponse({
              functionResponses: [
                {
                  id: call.id,
                  name: call.name,
                  response: { quantityKg: 650, storageDays: 2 },
                },
              ],
            });
          }
          const c = event.serverContent;
          if (c?.modelTurn?.parts?.some((p) => p.inlineData?.data) && !audio) {
            audio = true;
            results.push({
              requestToAudioMs: Math.round(performance.now() - started),
              toolToAudioMs: toolEnd
                ? Math.round(performance.now() - toolEnd)
                : null,
            });
          }
          if (c?.turnComplete) pending?.resolve();
        },
        onerror: () => pending?.reject(Error("provider error")),
        onclose: (e) => pending?.reject(Error(e.reason || "closed")),
      },
    });
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("turn timed out")), 30000);
        pending = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        started = performance.now();
        toolEnd = null;
        audio = false;
        session.sendRealtimeInput({ activityStart: {} });
        session.sendRealtimeInput({
          text:
            i % 2
              ? "अभी कितना स्टॉक बचा है और कितने दिन रख सकते हैं?"
              : "How much stock is saved and how many storage days?",
        });
        session.sendRealtimeInput({ activityEnd: {} });
      });
      pending = null;
    }
    console.log(JSON.stringify({ model, results }));
  } catch (e) {
    console.log(JSON.stringify({ model, error: e.message, results }));
  } finally {
    pending = null;
    session?.close();
  }
}
