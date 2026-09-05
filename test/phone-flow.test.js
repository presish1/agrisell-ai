import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { VoiceState, PcmQueue } from "../src/voice-state.js";
import { iphoneShell } from "../src/iphone-shell.js";
import { AudioPlayoutClock } from "../src/audio-playout.js";

// Execute the actual phone event handlers, mocking only DOM/device/network boundaries.
async function phoneScenario() {
  const nodes = new Map(),
    sounds = [],
    sent = [],
    intervals = [];
  let socket, capture;
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        textContent: "",
        hidden: false,
        disabled: false,
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        querySelector() {
          return node(id + "/small");
        },
        replaceChildren() {},
        append() {},
        click() {
          this.onclick?.();
        },
      });
    return nodes.get(id);
  };
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    async resume() {
      this.state = "running";
    }
    close() {
      this.state = "closed";
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createBuffer(_channels, n, rate) {
      return { duration: n / rate, getChannelData: () => new Float32Array(n) };
    }
    createBufferSource() {
      const s = {
        connect() {},
        start() {},
        stop() {
          s.stopped = true;
        },
      };
      sounds.push(s);
      return s;
    }
  }
  const track = { stop() {} };
  class WebSocket {
    constructor() {
      socket = this;
      this.readyState = 1;
      this.bufferedAmount = 0;
    }
    send(x) {
      sent.push(JSON.parse(x));
    }
    close() {
      this.readyState = 3;
    }
  }
  const ctx = vm.createContext({
    VoiceState,
    PcmQueue,
    AudioPlayoutClock,
    iphoneShell,
    createRingtone: () => ({
      unlock: async () => {},
      start() {},
      stop() {},
      notify() {},
      close() {},
    }),
    URLSearchParams,
    location: {
      search: "?phone=1&crop=3",
      protocol: "http:",
      host: "localhost:5173",
    },
    sessionStorage: { getItem: () => "" },
    performance: { now: () => 1000 },
    Date,
    AbortSignal,
    document: {
      querySelector: node,
      getElementById: node,
      addEventListener() {},
      removeEventListener() {},
      createElement: () => node("new"),
    },
    window: { addEventListener() {} },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      },
    },
    AudioContext,
    AudioWorkletNode: class {
      constructor() {
        this.port = {};
        capture = this;
      }
      connect() {}
      disconnect() {}
    },
    WebSocket,
    atob: (x) => Buffer.from(x, "base64").toString("binary"),
    btoa: (x) => Buffer.from(x, "binary").toString("base64"),
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    clearInterval() {},
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        String(url).endsWith("/calls")
          ? [
              {
                id: "qa-call",
                cropId: 3,
                status: "ringing",
                name: "QA Farmer",
                language: "Hindi",
              },
            ]
          : String(url).endsWith("/receipt")
            ? {
                body: "No changes",
                title: "Call ended",
                createdAt: new Date().toISOString(),
              }
            : {},
    }),
  });
  const source = readFileSync(
    new URL("../src/phone.js", import.meta.url),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "")
    .replace("export function startPhone", "function startPhone");
  vm.runInContext(source + "\nstartPhone();", ctx);
  await new Promise((r) => setImmediate(r));
  await node("answer-call").onclick();
  socket.onopen();
  const emit = (m) => socket.onmessage({ data: JSON.stringify(m) });
  emit({ type: "ready" });
  return { node, sounds, sent, emit, track, intervals, capture };
}
const pcm = Buffer.alloc(2400).toString("base64");
test("actual phone: local speech interrupts playback immediately and ignores late old audio", async () => {
  const p = await phoneScenario();
  p.emit({ type: "audio", data: pcm });
  const old = p.sounds.at(-1);
  p.emit({ type: "speechStart" });
  assert.equal(old.stopped, true);
  assert.match(p.node("voice-status").textContent, /Listening to you/);
  const count = p.sounds.length;
  p.emit({ type: "audio", data: pcm });
  assert.equal(p.sounds.length, count);
  p.emit({ type: "speechEnd" });
  p.emit({ type: "audio", data: pcm });
  assert.equal(p.sounds.length, count + 1);
  p.emit({ type: "turnComplete" });
  p.sounds.at(-1).onended();
  assert.match(p.node("capture-status").textContent, /Your turn/);
});
test("actual phone: stock tool → Hindi read-back → playback drain clears preparing message", async () => {
  const p = await phoneScenario();
  for (let i = 0; i < 25; i++) {
    p.emit({ type: "transcript", input: "500 किलो", inputUpdated: true });
    p.emit({ type: "working", message: "Checking your field-desk record…" });
    p.emit({ type: "updated" });
    assert.match(p.node("capture-status").textContent, /reply/);
    p.emit({ type: "audio", data: pcm });
    assert.doesNotMatch(
      p.node("capture-status").textContent,
      /preparing|waiting.*reply/i,
    );
    p.emit({ type: "generationComplete" });
    p.emit({ type: "turnComplete" });
    p.sounds.at(-1).onended();
    assert.equal(p.node("voice-status").textContent, "Listening — just speak");
    assert.match(p.node("capture-status").textContent, /your turn|just speak/i);
  }
  p.emit({ type: "updated", saved: { quantityKg: 500, storageDays: 2 } });
  p.emit({ type: "audio", data: pcm });
  p.emit({ type: "turnComplete" });
  p.sounds.at(-1).onended();
  assert.match(p.node("stock-saved").textContent, /500 kg/);
  assert.doesNotMatch(p.node("capture-status").textContent, /preparing/i);
});
test("actual phone: late stopped-source callbacks cannot report playback drained for a new turn", async () => {
  const p = await phoneScenario();
  for (let i = 0; i < 8; i++) p.emit({ type: "audio", data: pcm });
  const old = [...p.sounds];
  p.emit({ type: "interrupted" });
  for (const s of old) s.onended();
  assert.equal(p.sent.filter((e) => e.event === "playback_drained").length, 0);
  p.emit({ type: "audio", data: pcm });
  p.emit({ type: "turnComplete" });
  p.sounds.at(-1).onended();
  assert.equal(p.sent.filter((e) => e.event === "playback_drained").length, 1);
});
test("actual phone: input stays usable after read-back; mute and microphone warnings are explicit", async () => {
  const p = await phoneScenario();
  p.emit({ type: "updated" });
  p.emit({ type: "audio", data: pcm });
  p.emit({ type: "turnComplete" });
  p.sounds.at(-1).onended();
  p.node("speaker-call").onclick();
  assert.match(p.node("capture-status").textContent, /Speaker muted/);
  p.node("speaker-call").onclick();
  assert.match(p.node("capture-status").textContent, /Your turn/);
  p.track.onmute();
  assert.match(p.node("capture-status").textContent, /Microphone temporarily/);
  p.track.onunmute();
  assert.match(p.node("capture-status").textContent, /Your turn/);
  p.capture.port.onmessage({ data: new Int16Array(512).fill(1000).buffer });
  assert.equal(
    p.sent.filter((e) => e.type === "audio").length,
    1,
    "next farmer reply must still reach the socket without a talk button",
  );
  p.emit({ type: "transcript", input: "हाँ", inputUpdated: true });
  assert.match(p.node("capture-status").textContent, /हाँ/);
  p.emit({ type: "working", message: "Checking" });
  p.emit({ type: "updated", failed: true });
  assert.match(p.node("capture-status").textContent, /could not complete/);
  p.emit({ type: "waitingForInput" });
  assert.match(p.node("capture-status").textContent, /Your turn/);
});
