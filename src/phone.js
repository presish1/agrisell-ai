import "./demo.css";
const safe = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cropId = Number(new URLSearchParams(location.search).get("crop"));
const headers = () => ({
  Authorization: `Bearer ${sessionStorage.getItem("agrisell-token") || ""}`,
});
async function api(path, body) {
  const r = await fetch("/api/demo" + path, {
    method: body ? "POST" : "GET",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
let call = null,
  busy = false,
  recording = false,
  recorder = null,
  stream = null,
  recordTimer = null,
  audio = null,
  audioUrl = null,
  speechId = 0,
  audioContext = null,
  soundEnabled = false,
  ringTimer = null,
  lastRingId = null;
let lastRendered = "",
  ttsFallback = false;
function notice(text) {
  document.querySelector("#phone-notice").textContent = text;
}
function stopSound() {
  speechId++;
  audio?.pause();
  audio = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  window.speechSynthesis?.cancel();
  document.querySelector(".phone-device")?.classList.remove("speaking");
}
function stopRing() {
  clearInterval(ringTimer);
  ringTimer = null;
}
function chirp() {
  if (!soundEnabled || !audioContext) return;
  for (const frequency of [440, 550]) {
    const tone = audioContext.createOscillator(),
      gain = audioContext.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.045, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.7,
    );
    tone.connect(gain).connect(audioContext.destination);
    tone.start();
    tone.stop(audioContext.currentTime + 0.75);
  }
}
function update(s) {
  call = s;
  const key = JSON.stringify(s);
  if (key === lastRendered) return;
  lastRendered = key;
  const connected = s?.status === "connected",
    ringing = s?.status === "ringing";
  document.querySelector("#phone-state").textContent = ringing
    ? "Incoming demo call"
    : connected
      ? "Connected · AI assistant"
      : s
        ? "Call ended"
        : "Ready to receive";
  document.querySelector("#phone-person").textContent =
    s?.name || "Farmer phone";
  document.querySelector("#phone-detail").textContent = s
    ? `${s.crop} · ${s.language} · browser call`
    : "Open this screen from the field desk";
  document.querySelector(".phone-device").classList.toggle("ringing", ringing);
  document.querySelector("#answer").hidden = !ringing;
  document.querySelector("#end").hidden = !s || s.status === "ended";
  document.querySelector("#conversation-controls").hidden = !connected;
  document.querySelector("#phone-transcript").innerHTML =
    (s?.messages || [])
      .map(
        (m) =>
          `<div class="bubble ${m.role}"><small>${m.role === "assistant" ? "AGR ISELL".replace(" ", "") : "YOU"}</small><p>${safe(m.text)}</p></div>`,
      )
      .join("") ||
    '<div class="phone-empty">Your call will appear here.<br>Keep this window open, then ring it from the dashboard.</div>';
  const pending = s?.pending,
    complete =
      pending &&
      Number.isFinite(pending.quantityKg) &&
      Number.isInteger(pending.storageDays);
  document.querySelector("#stock-confirm").hidden = !complete || !connected;
  document.querySelector("#stock-proposal").textContent = complete
    ? `${pending.quantityKg} kg remaining · ${pending.storageDays} storage days`
    : "";
  document.querySelector("#phone-saved").hidden = !s?.saved;
  document.querySelector("#phone-saved").textContent = s?.saved
    ? `✓ Dashboard updated: ${s.saved.quantityKg} kg · ${s.saved.storageDays} days`
    : "";
  document.querySelector("#phone-engine").textContent =
    s?.engine || "Groq voice demo";
  if (s?.warning) notice(s.warning + " Scripted fallback is active.");
  if (ringing && lastRingId !== s.id) {
    stopRing();
    lastRingId = s.id;
    chirp();
    ringTimer = setInterval(chirp, 2200);
  }
  if (!ringing) stopRing();
  const transcript = document.querySelector("#phone-transcript");
  transcript.scrollTop = transcript.scrollHeight;
}
async function speakLast() {
  const message = call?.messages.at(-1);
  if (!message || message.role !== "assistant" || call.status !== "connected")
    return;
  stopSound();
  const ticket = speechId,
    session = call.id;
  document.querySelector(".phone-device").classList.add("speaking");
  const fallback = () => {
    if (ticket !== speechId) return;
    ttsFallback = true;
    if (!window.speechSynthesis) {
      notice(
        "Speech playback is unavailable. Read the transcript and type a reply.",
      );
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message.text);
    utterance.lang = { English: "en-IN", Hindi: "hi-IN", Marathi: "mr-IN" }[
      call.language
    ];
    utterance.onend = () =>
      document.querySelector(".phone-device")?.classList.remove("speaking");
    utterance.onerror = () =>
      notice(
        "Browser speech unavailable. The full conversation remains in the transcript.",
      );
    window.speechSynthesis.speak(utterance);
    document.querySelector("#speech-source").textContent =
      "Browser speech fallback";
  };
  if (call.language !== "English") {
    fallback();
    return;
  }
  try {
    const r = await fetch(`/api/demo/calls/${session}/speech`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id }),
    });
    if (!r.ok) throw new Error("Speech API unavailable");
    const blob = await r.blob();
    if (ticket !== speechId || call?.status !== "connected") return;
    audioUrl = URL.createObjectURL(blob);
    audio = new Audio(audioUrl);
    audio.onended = () =>
      document.querySelector(".phone-device")?.classList.remove("speaking");
    await audio.play();
    document.querySelector("#speech-source").textContent =
      r.headers.get("X-Speech-Provider") || "Synthesized speech";
    ttsFallback = false;
  } catch {
    if (ticket === speechId) {
      notice(
        "Groq audio could not play. Using browser speech; you can also read every reply.",
      );
      fallback();
    }
  }
}
function disable(value) {
  busy = value;
  document
    .querySelectorAll("#send,#record,#confirm")
    .forEach((e) => (e.disabled = value));
}
async function send(text) {
  if (!call || busy || !text.trim()) return;
  stopSound();
  disable(true);
  notice("AgriSell is thinking…");
  try {
    const s = await api(`/calls/${call.id}/turn`, { text });
    update(s);
    document.querySelector("#reply").value = "";
    notice(s.warning || "Tap Talk to reply, or type below.");
    speakLast();
  } catch (e) {
    notice(e.message);
  } finally {
    disable(false);
  }
}
async function toggleRecording() {
  if (recording) {
    recorder.stop();
    return;
  }
  if (busy || call?.status !== "connected") return;
  stopSound();
  const session = call.id;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (call?.id !== session || call.status !== "connected") {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const type = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    recording = true;
    document.querySelector("#record").textContent = "■ Stop & send";
    document.querySelector("#record").classList.add("recording");
    notice("Listening… tap Stop & send when finished (25-second limit).");
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      clearTimeout(recordTimer);
      recording = false;
      stream?.getTracks().forEach((t) => t.stop());
      document.querySelector("#record").textContent = "● Talk";
      document.querySelector("#record").classList.remove("recording");
      if (call?.id !== session || call.status !== "connected") return;
      disable(true);
      notice("Transcribing with Groq Whisper…");
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const r = await fetch(`/api/demo/calls/${session}/transcribe`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": blob.type },
          body: blob,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (call?.status !== "connected") return;
        if (!data.text)
          throw new Error("No speech detected. Please try again.");
        document.querySelector("#reply").value = data.text;
        disable(false);
        await send(data.text);
      } catch (e) {
        notice(`${e.message} You can type your reply instead.`);
      } finally {
        disable(false);
      }
    };
    recorder.start();
    recordTimer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 25000);
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    notice(
      "Microphone unavailable or permission denied. Type your reply below; the conversation still works.",
    );
  }
}
export async function startPhone() {
  document.title = "AgriSell — Farmer phone";
  document.body.classList.add("phone-page");
  document.querySelector("#app").innerHTML =
    `<div class="phone-layout"><section class="phone-guide"><a href="/">← Field desk</a><p class="phone-kicker">AGRISELL / FARMER EXPERIENCE</p><h1>A conversation.<br><em>A clearer harvest.</em></h1><p>Answer your incoming call, tell AgriSell what’s in stock, and confirm the update. The field desk stays in sync.</p><ol><li>Enable sound for the ringtone.</li><li>Click “Ring demo call” on the dashboard.</li><li>Answer, then tap Talk or type a reply.</li></ol><div class="privacy"><b>You’re in a browser demo.</b><p>No real phone number is dialled. Recorded replies and conversation text are sent to Groq. Audio is not stored by this app; transcripts and confirmed changes are saved in the local database.</p><span id="phone-engine">Groq voice demo</span><span id="speech-source">Speech ready</span></div></section><section class="phone-device" aria-label="Farmer phone"><div class="phone-top"><span>AgriSell</span><button id="sound">Enable sound</button></div><div class="caller"><div class="caller-icon">अ</div><p id="phone-state">Ready to receive</p><h2 id="phone-person">Farmer phone</h2><span id="phone-detail"></span><div class="voice-wave"><i></i><i></i><i></i><i></i><i></i></div></div><div id="phone-transcript" class="transcript" aria-live="polite"></div><div id="phone-saved" class="saved-notice" hidden></div><div id="stock-confirm" class="stock-confirm" hidden><b>Confirm your stock</b><p id="stock-proposal"></p><button id="confirm">Confirm & update dashboard</button></div><p id="phone-notice" role="status">Waiting for the dashboard to ring…</p><div class="call-actions"><button id="answer" hidden>☎ Answer call</button><button id="end" hidden>End call</button></div><div id="conversation-controls" hidden><div class="talk-controls"><button id="record">● Talk</button><button id="replay">↻ Replay</button><button id="mute">Stop voice</button></div><form id="reply-form"><label class="sr-only" for="reply">Your reply</label><input id="reply" maxlength="1500" placeholder="Or type: I have 650 kg left" autocomplete="off"><button id="send" aria-label="Send reply">↑</button></form></div></section></div>`;
  document
    .querySelector("#conversation-controls")
    .insertAdjacentHTML(
      "afterbegin",
      '<p class="recording-disclosure">Recorded replies and conversation text go to Groq. No real phone number is dialled.</p>',
    );
  document.querySelector("#sound").onclick = async () => {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    soundEnabled = true;
    document.querySelector("#sound").textContent = "Sound enabled ✓";
    if (call?.status === "ringing") chirp();
  };
  document.querySelector("#answer").onclick = async () => {
    try {
      stopRing();
      update(await api(`/calls/${call.id}/answer`, {}));
      notice(
        "Tap Talk to speak. Your microphone is only used while recording.",
      );
      speakLast();
    } catch (e) {
      notice(e.message);
    }
  };
  document.querySelector("#end").onclick = async () => {
    try {
      const id = call.id;
      update({ ...call, status: "ended" });
      stopSound();
      stopRing();
      if (recording) recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      update(await api(`/calls/${id}/end`, {}));
      notice("Call ended. Confirmed updates remain saved.");
    } catch (e) {
      notice(e.message);
    }
  };
  document.querySelector("#confirm").onclick = async () => {
    disable(true);
    stopSound();
    try {
      update(await api(`/calls/${call.id}/confirm`, {}));
      speakLast();
      notice("Confirmed stock is now saved to the dashboard.");
    } catch (e) {
      notice(e.message);
    } finally {
      disable(false);
    }
  };
  document.querySelector("#record").onclick = toggleRecording;
  document.querySelector("#replay").onclick = speakLast;
  document.querySelector("#mute").onclick = stopSound;
  document.querySelector("#reply-form").onsubmit = (e) => {
    e.preventDefault();
    if (!recording) send(document.querySelector("#reply").value);
  };
  async function poll() {
    if (busy) return;
    try {
      const sessions = await api("/calls");
      const s = sessions.find((s) => s.cropId === cropId);
      if (s) update(s);
    } catch (e) {
      notice(e.message);
    }
  }
  await poll();
  setInterval(poll, 1200);
  addEventListener("pagehide", () => {
    call = null;
    clearTimeout(recordTimer);
    stopSound();
    stopRing();
    stream?.getTracks().forEach((t) => t.stop());
  });
}
