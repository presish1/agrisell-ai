import "./phone-live.css";
import { createRingtone } from "./ringtone.js";
import { iphoneShell } from "./iphone-shell.js";
import { VoiceState, PcmQueue } from "./voice-state.js";
import { AudioPlayoutClock } from "./audio-playout.js";
export function startPhone() {
  const crop = Number(new URLSearchParams(location.search).get("crop") || 1);
  let call,
    ws,
    ctx,
    stream,
    worklet,
    muted = false,
    busy = false;
  let playout = new AudioPlayoutClock();
  const sources = new Set();
  let voiceState = new VoiceState(),
    transportTimer,
    inputQueue,
    lastMicPacket = 0,
    connectionReady = false;
  let captureReported = false,
    backlogReported = false;
  const trace = (event, detail = {}) => {
    if (ws?.readyState === 1)
      ws.send(
        JSON.stringify({
          type: "client_event",
          event,
          clientMs: performance.now(),
          ...detail,
        }),
      );
  };
  const updateVoiceStatus = () => {
    if (busy) {
      status(voiceState.label());
      el("capture-status").textContent = voiceState.detail();
    }
  };
  const api = async (path) => {
    const r = await fetch("/api/demo" + path, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${sessionStorage.getItem("agrisell-token") || ""}`,
      },
    });
    if (!r.ok) throw Error("Field desk unavailable");
    return r.json();
  };
  document.querySelector("#app").innerHTML = iphoneShell();
  const el = (id) => document.getElementById(id),
    status = (t) => (el("voice-status").textContent = t);
  let ending = false,
    lastReceiptId,
    startedAt,
    speakerMuted = false,
    outputGain;
  const phone = document.querySelector(".farmer-phone");
  const openMessages = () => {
    el("messages-screen").hidden = false;
    el("call-screen").hidden = true;
    el("message-notification").hidden = true;
    phone.classList.add("in-messages");
    loadMessageThread();
  };
  el("open-messages").onclick = openMessages;
  el("message-notification").onclick = openMessages;
  el("back-call").onclick = () => {
    el("messages-screen").hidden = true;
    el("call-screen").hidden = false;
    phone.classList.remove("in-messages");
  };
  let messageSending = false,
    messageAttempt;
  const messageRequest = async (options = {}) => {
    const response = await fetch(`/api/messages/${crop}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("agrisell-token") || ""}`,
      },
      signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Message could not be sent.");
    return data;
  };
  function renderMessages(data) {
    const list = el("chat-messages");
    list.replaceChildren();
    for (const message of data.messages || []) {
      const bubble = document.createElement("p");
      bubble.className = `chat-bubble ${message.role === "user" ? "outgoing" : "incoming"}`;
      bubble.textContent = message.text;
      list.append(bubble);
    }
    if (data.messages?.length) el("message-empty").hidden = true;
    el("message-error").textContent = "";
    const scroller = document.querySelector(".message-thread");
    scroller.scrollTop = scroller.scrollHeight;
  }
  async function loadMessageThread() {
    if (messageSending) return;
    try {
      renderMessages(await messageRequest());
    } catch (error) {
      el("message-error").textContent = error.message;
    }
  }
  el("message-form").onsubmit = async (event) => {
    event.preventDefault();
    const input = el("message-input");
    const text = input.value.trim();
    if (!text || messageSending) return;
    if (busy) {
      el("message-error").textContent =
        "Finish your call before sending a message.";
      return;
    }
    messageSending = true;
    el("send-message").disabled = true;
    el("message-error").textContent = "AgriSell is typing…";
    if (!messageAttempt || messageAttempt.text !== text)
      messageAttempt = { text, requestId: crypto.randomUUID() };
    const outgoing = document.createElement("p");
    outgoing.className = "chat-bubble outgoing";
    outgoing.textContent = text;
    el("chat-messages").append(outgoing);
    const scroller = document.querySelector(".message-thread");
    scroller.scrollTop = scroller.scrollHeight;
    input.disabled = true;
    try {
      const data = await messageRequest({
        method: "POST",
        body: JSON.stringify(messageAttempt),
      });
      input.value = "";
      messageAttempt = null;
      renderMessages(data);
      ringtone.notify();
    } catch (error) {
      outgoing.remove();
      el("message-error").textContent = error.message;
    } finally {
      messageSending = false;
      input.disabled = false;
      el("send-message").disabled = false;
    }
  };
  el("show-transcript").onclick = () => {
    el("transcript-panel").open = !el("transcript-panel").open;
  };
  el("speaker-call").onclick = () => {
    speakerMuted = !speakerMuted;
    voiceState.outputMuted = speakerMuted;
    if (outputGain) outputGain.gain.value = speakerMuted ? 0 : 1;
    el("speaker-call").classList.toggle("selected", speakerMuted);
    el("speaker-call").querySelector("small").textContent = speakerMuted
      ? "audio off"
      : "audio";
    trace(speakerMuted ? "speaker_muted" : "speaker_unmuted");
    updateVoiceStatus();
  };
  async function showReceipt(id, notify = false) {
    const receipt = await api(`/calls/${id}/receipt`);
    lastReceiptId = id;
    el("receipt-bubble").textContent = receipt.body;
    el("receipt-bubble").hidden = false;
    el("message-empty").hidden = true;
    el("message-date").textContent = new Date(receipt.createdAt).toLocaleString(
      [],
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    );
    el("notification-text").textContent = receipt.title;
    el("receipt-sources").replaceChildren();
    for (const source of receipt.sources || []) {
      const item = document.createElement(
        source.url?.startsWith("https://") ? "a" : "p",
      );
      item.textContent = source.name;
      if (item.tagName === "A") {
        item.href = source.url;
        item.target = "_blank";
        item.rel = "noopener noreferrer";
      }
      el("receipt-sources").append(item);
    }
    if (notify && el("messages-screen").hidden) {
      el("message-notification").hidden = false;
      setTimeout(() => {
        el("message-notification").hidden = true;
      }, 7000);
    }
    if (notify) ringtone.notify();
  }
  async function finish(message = "Call ended") {
    if (ending) return;
    const id = call?.id;
    ending = true;
    cleanup();
    status(message);
    try {
      if (id) {
        const r = await fetch(`/api/demo/calls/${id}/end`, {
          signal: AbortSignal.timeout(8000),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionStorage.getItem("agrisell-token") || ""}`,
          },
          body: "{}",
        });
        if (!r.ok) throw Error("Could not finish call");
        await showReceipt(id, true);
      }
    } catch {
      el("capture-status").textContent =
        "Summary unavailable. Your confirmed stock remains saved in the field desk.";
    } finally {
      ending = false;
    }
  }
  const ringtone = createRingtone();
  const unlockSound = () => {
    ringtone.unlock().catch(() => {});
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  };
  // Try autoplay first; a normal interaction unlocks audio if the browser requires it.
  unlockSound();
  document.addEventListener("pointerdown", unlockSound);
  document.addEventListener("keydown", unlockSound);
  const stopAudio = () => {
    if (sources.size) trace("playback_interrupted");
    for (const s of sources) {
      try {
        s.stop();
      } catch {}
    }
    sources.clear();
    voiceState.playing = 0;
    playout.reset();
    trace("playback_state", { active: false });
  };
  function cleanup() {
    clearInterval(transportTimer);
    inputQueue?.clear();
    connectionReady = false;
    voiceState.event("closed");
    phone.dataset.state = "ended";
    el("decline-call").hidden = true;
    ringtone.stop();
    stopAudio();
    stream?.getTracks().forEach((t) => t.stop());
    worklet?.disconnect();
    ctx?.close();
    ctx = null;
    ws?.close();
    ws = null;
    busy = false;
    el("mic-level").style.width = "0%";
    el("capture-status").textContent = "";
    el("mute-call").hidden = true;
    el("end-call").hidden = true;
    el("answer-call").hidden = false;
    el("answer-call").disabled = true;
  }
  function play(data) {
    if (!ctx) return;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      pcm = new DataView(bytes.buffer),
      buffer = ctx.createBuffer(1, bytes.length / 2, 24000),
      out = buffer.getChannelData(0);
    for (let i = 0; i < out.length; i++)
      out[i] = pcm.getInt16(i * 2, true) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain || ctx.destination);
    const timing = playout.schedule(ctx.currentTime, buffer.duration);
    if (timing.underrunMs > 0) trace("playback_underrun", timing);
    trace("playback_chunk", {
      durationMs: buffer.duration * 1000,
      queueMs: (playout.next - ctx.currentTime) * 1000,
    });
    if (!sources.size)
      trace("playback_scheduled", {
        queueMs: Math.round((timing.start - ctx.currentTime) * 1000),
      });
    source.start(timing.start);
    sources.add(source);
    voiceState.playing = sources.size;
    voiceState.event("audio");
    source.onended = () => {
      // Cancelled/previous-call sources no longer own the playback state.
      if (!sources.delete(source)) return;
      voiceState.playing = sources.size;
      if (!sources.size) {
        trace("playback_drained");
        if (playout.ended) {
          trace("playback_state", { active: false });
        }
      }
      updateVoiceStatus();
    };
    status("AgriSell is speaking");
  }
  el("answer-call").onclick = async () => {
    if (busy || !call) return;
    busy = true;
    voiceState = new VoiceState();
    playout = new AudioPlayoutClock();
    voiceState.outputMuted = speakerMuted;
    connectionReady = false;
    captureReported = false;
    backlogReported = false;
    muted = false;
    ringtone.stop();
    try {
      await ringtone.unlock();
      status("Connecting voice…");
      ctx = new AudioContext({ latencyHint: "interactive" });
      ctx.onstatechange = () => {
        if (!ctx) return;
        voiceState.suspended = ctx.state !== "running";
        trace(voiceState.suspended ? "audio_suspended" : "audio_running");
        updateVoiceStatus();
      };
      outputGain = ctx.createGain();
      outputGain.connect(ctx.destination);
      outputGain.gain.value = speakerMuted ? 0 : 1;
      await ctx.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await ctx.audioWorklet.addModule("/voice-capture.js");
      const mic = ctx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(ctx, "voice-capture");
      mic.connect(worklet);
      worklet.connect(ctx.destination);
      inputQueue = new PcmQueue();
      lastMicPacket = Date.now();
      function sendAudio({ data: packet, seq }) {
        let s = "";
        for (const b of new Uint8Array(packet)) s += String.fromCharCode(b);
        ws.send(JSON.stringify({ type: "audio", data: btoa(s), seq }));
      }
      transportTimer = setInterval(() => {
        if (!busy) return;
        try {
          inputQueue.drain(
            sendAudio,
            connectionReady && ws?.readyState === 1,
            ws?.bufferedAmount || 0,
          );
        } catch (e) {
          finish(e.message);
        }
        if (connectionReady && Date.now() - lastMicPacket > 2500) {
          voiceState.captureIssue =
            "Microphone stopped delivering audio — check microphone access or tap to resume.";
          updateVoiceStatus();
        }
      }, 32);
      for (const track of stream.getAudioTracks()) {
        track.onended = () =>
          finish("Microphone disconnected. Reconnect it and ring again.");
        track.onmute = () => {
          voiceState.micUnavailable = true;
          updateVoiceStatus();
        };
        track.onunmute = () => {
          voiceState.micUnavailable = false;
          updateVoiceStatus();
        };
      }
      worklet.port.onmessage = (e) => {
        const packet = e.data;
        lastMicPacket = Date.now();
        if (voiceState.captureIssue) {
          voiceState.captureIssue = "";
          updateVoiceStatus();
        }
        const pcm = new Int16Array(packet);
        let energy = 0;
        for (const sample of pcm) energy += (sample / 32768) ** 2;
        const level = Math.sqrt(energy / pcm.length);
        el("mic-level").style.width =
          `${muted ? 0 : Math.min(100, level * 500)}%`;
        if (muted) return;
        // Do not record a long pre-connection burst: the screen says Connecting until ready.
        if (!connectionReady) return;
        if (ws?.readyState !== 1) return;
        if (!captureReported) {
          trace("capture_first_packet");
          captureReported = true;
        }
        try {
          inputQueue.push(packet);
          inputQueue.drain(sendAudio, true, ws.bufferedAmount, 1);
        } catch (e) {
          finish(e.message);
        }
        if (inputQueue.items.length > 8) {
          voiceState.transportIssue =
            "Connection delayed — keeping your audio in order…";
          if (!backlogReported) {
            trace("input_backlog", { queuedPackets: inputQueue.items.length });
            backlogReported = true;
            updateVoiceStatus();
          }
        } else if (backlogReported) {
          backlogReported = false;
          voiceState.transportIssue = "";
          updateVoiceStatus();
        }
      };
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`,
      );
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "start",
            id: call.id,
            token: sessionStorage.getItem("agrisell-token") || "",
          }),
        );
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          voiceState.event(m.type, m);
          if (m.type === "reconnecting") {
            connectionReady = false;
            inputQueue.clear();
            stopAudio();
          }
          if (m.type === "reconnected") {
            connectionReady = true;
          }
          if (m.type === "ready") {
            phone.dataset.state = "active";
            startedAt = Date.now();
            el("decline-call").hidden = true;
            connectionReady = true;
            trace("capture_started");
            const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
            trace("capture_config", {
              sampleRate: settings.sampleRate,
              channelCount: settings.channelCount,
              echoCancellation: settings.echoCancellation,
              noiseSuppression: settings.noiseSuppression,
              autoGainControl: settings.autoGainControl,
            });
            updateVoiceStatus();
            el("answer-call").hidden = true;
            el("mute-call").hidden = false;
            el("end-call").hidden = false;
          }
          if (m.type === "speechStart") {
            stopAudio();
            updateVoiceStatus();
          }
          if (m.type === "audio" && !voiceState.userSpeaking) play(m.data);
          if (
            ["generationComplete", "turnComplete", "waitingForInput"].includes(
              m.type,
            )
          ) {
            playout.complete();
            if (!sources.size) {
              trace("playback_state", { active: false });
            }
          }
          if (m.type === "interrupted") {
            stopAudio();
            updateVoiceStatus();
          }
          if (m.type === "updated") {
            if (m.failed) el("stock-saved").textContent = m.failureMessage || "Stock was not updated. Please clarify or confirm the details.";
            if (m.saved)
              el("stock-saved").textContent =
                `Saved to field desk: ${m.saved.quantityKg} kg · ${m.saved.storageDays} storage days`;
          }
          if (m.type === "transcript") {
            if (m.inputUpdated) {
              voiceState.event("input", m);
            }
            el("live-transcript").textContent = [
              m.input && `You: ${m.input}`,
              m.output && `AgriSell: ${m.output}`,
            ]
              .filter(Boolean)
              .join("\n\n");
          }
          updateVoiceStatus();
          if (m.type === "error" || m.type === "closed") {
            finish(m.message);
          }
        } catch {
          finish(
            "Audio processing failed. Please ring again; confirmed stock is saved.",
          );
        }
      };
      ws.onerror = () => {
        finish("Connection unavailable. Please ring again.");
      };
      ws.onclose = () => {
        if (busy) {
          finish("Call ended");
        }
      };
    } catch (e) {
      status(
        e.name === "NotAllowedError"
          ? "Allow microphone access to answer."
          : e.message,
      );
      cleanup();
    }
  };
  el("mute-call").onclick = () => {
    muted = !muted;
    voiceState.muted = muted;
    if (muted) inputQueue?.clear();
    el("mute-call").querySelector("small").textContent = muted
      ? "Unmute"
      : "Mute";
    updateVoiceStatus();
    if (muted && ws?.readyState === 1)
      ws.send(JSON.stringify({ type: "audioEnd" }));
  };
  el("end-call").onclick = () => finish();
  el("decline-call").onclick = () => finish("Call declined");
  async function poll() {
    if (busy || ending) return;
    try {
      const calls = await api("/calls");
      const incoming = calls.find(
        (s) => s.cropId === crop && s.status === "ringing",
      );
      if (incoming) {
        el("message-notification").hidden = true;
        phone.dataset.state = "ringing";
        el("back-call").click();
        el("decline-call").hidden = false;
        ringtone.start();
        call = incoming;
        status("Incoming call");
        el("answer-call").disabled = false;
        el("voice-caption").textContent =
          `For ${incoming.name} · ${incoming.language}`;
      } else {
        ringtone.stop();
        call = null;
        el("answer-call").disabled = true;
        if (
          el("voice-status").textContent === "Field desk unavailable" ||
          el("voice-status").textContent === "Incoming call"
        )
          status("Waiting for your call");
        const ended = calls.find(
          (s) => s.cropId === crop && s.status === "ended",
        );
        if (ended && !lastReceiptId) await showReceipt(ended.id);
      }
    } catch (e) {
      status(e.message);
    }
  }
  poll();
  const timer = setInterval(poll, 1800);
  const clock = setInterval(() => {
    el("device-time").textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (busy && startedAt) {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      el("voice-caption").textContent = `${Math.floor(sec / 60)
        .toString()
        .padStart(
          2,
          "0",
        )}:${(sec % 60).toString().padStart(2, "0")} · AgriSell audio`;
    }
  }, 1000);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      clearInterval(clock);
      cleanup();
      ringtone.close();
      document.removeEventListener("pointerdown", unlockSound);
      document.removeEventListener("keydown", unlockSound);
    },
    { once: true },
  );
}
