import twilio from "twilio";
import { randomUUID } from "node:crypto";

const audioCache = new Map();
const xml = (text) =>
  text.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c],
  );
export const voiceReady = () =>
  process.env.CALLS_ENABLED === "true" &&
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER &&
    process.env.ADMIN_TOKEN,
  );
export const getAudio = (token) => {
  const item = audioCache.get(token);
  return item && item.expires > Date.now() ? item.audio : null;
};

export function createMessage(farmer, rec) {
  const waiting = rec.action === "WAIT";
  if (farmer.language === "Marathi") {
    const crop =
      { Tomato: "टोमॅटो", Onion: "कांदा", Grapes: "द्राक्षे", Potato: "बटाटा" }[
        farmer.crop
      ] || farmer.crop;
    return `नमस्कार ${farmer.name}. अ‍ॅग्रीसेल कडून आपल्या पिकाची माहिती. आज ${crop} चा दर सुमारे ${farmer.current_price} रुपये प्रति किलो आहे. हा प्राथमिक अंदाज आहे, हमी नाही. ${rec.action === "OTHER MANDI" ? "जवळच्या दुसऱ्या बाजारातील भाव आणि वाहतूक खर्च तपासा." : waiting ? "आपल्याकडे सुरक्षित साठवण असल्यास एक दिवस थांबण्याचा विचार करा." : "आज विक्री करण्याचा विचार करा."} निर्णय घेण्यापूर्वी स्थानिक बाजारभाव आणि पिकाची स्थिती तपासा.`;
  }
  if (farmer.language === "Hindi") {
    const crop =
      { Tomato: "टमाटर", Onion: "प्याज", Grapes: "अंगूर", Potato: "आलू" }[
        farmer.crop
      ] || farmer.crop;
    return `नमस्ते ${farmer.name}. एग्रीसेल की ओर से आपके फसल की जानकारी. आज ${crop} का भाव लगभग ${farmer.current_price} रुपये प्रति किलो है. यह शुरुआती अनुमान है, गारंटी नहीं. ${rec.action === "OTHER MANDI" ? "पास की दूसरी मंडी का भाव और परिवहन खर्च जांचें." : waiting ? "अगर सुरक्षित भंडारण उपलब्ध है, तो एक दिन रुकने पर विचार करें." : "आज बिक्री करने पर विचार करें."} निर्णय से पहले स्थानीय बाजार भाव और फसल की स्थिति जांच लें.`;
  }
  const instruction =
    rec.action === "OTHER MANDI"
      ? "Check the nearby alternative mandi price and transport cost before travelling."
      : waiting
        ? "If safe storage is available, consider waiting one day."
        : "Consider selling today.";
  return `Hello ${farmer.name}. This is AgriSell. Today's ${farmer.crop} price is approximately ${farmer.current_price} rupees per kilogram. This is a preliminary estimate, not a guarantee. ${instruction} Confirm the local price and crop condition before deciding.`;
}

export async function placeCall(to, message, language = "English") {
  if (!voiceReady())
    return {
      provider: "simulator",
      id: `SIM-${Date.now()}`,
      status: "simulated",
    };
  const {
    TWILIO_ACCOUNT_SID: sid,
    TWILIO_AUTH_TOKEN: token,
    TWILIO_FROM_NUMBER: from,
  } = process.env;
  let twiml;
  if (language !== "English") {
    if (
      !process.env.SARVAM_API_KEY ||
      !process.env.APP_URL?.startsWith("https://")
    )
      throw new Error(
        "Regional-language live calls require SARVAM_API_KEY and a public HTTPS APP_URL.",
      );
    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": process.env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        text: message,
        language_code: language === "Marathi" ? "mr-IN" : "hi-IN",
        model: "bulbul:v3",
        speaker: "shubh",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    if (!response.ok || !body.audios?.[0])
      throw new Error(
        "Regional speech generation failed. Check the Sarvam account configuration.",
      );
    const audioToken = randomUUID();
    audioCache.set(audioToken, {
      audio: Buffer.from(body.audios[0], "base64"),
      expires: Date.now() + 15 * 60 * 1000,
    });
    for (const [key, value] of audioCache)
      if (value.expires < Date.now()) audioCache.delete(key);
    twiml = `<Response><Play>${xml(process.env.APP_URL.replace(/\/$/, "") + "/api/audio/" + audioToken)}</Play></Response>`;
  } else
    twiml = `<Response><Say language="en-IN">${xml(message)}</Say></Response>`;
  const call = await twilio(sid, token).calls.create({
    to,
    from,
    twiml,
    timeLimit: 90,
  });
  return { provider: "twilio", id: call.sid, status: call.status || "queued" };
}

export async function fetchCallStatus(id) {
  if (!voiceReady()) return null;
  const call = await twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  )
    .calls(id)
    .fetch();
  return call.status;
}
