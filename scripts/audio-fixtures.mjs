import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function speechFixture(text, voice = "Samantha") {
  const folder = await mkdtemp(join(tmpdir(), "agrisell-audio-qa-"));
  try {
    const file = join(folder, "speech.wav");
    await promisify(execFile)(
      "/usr/bin/say",
      ["-v", voice, "-o", file, "--data-format=LEI16@16000", text],
      { timeout: 20000 },
    );
    const wav = await readFile(file);
    for (let pos = 12; pos + 8 < wav.length; ) {
      const size = wav.readUInt32LE(pos + 4);
      if (wav.toString("ascii", pos, pos + 4) === "data")
        return wav.subarray(pos + 8, pos + 8 + size);
      pos += 8 + size + (size % 2);
    }
    throw Error("No PCM data in fixture");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
export function noiseFixture(seconds = 3) {
  const b = Buffer.alloc(seconds * 16000 * 2);
  let seed = 17;
  for (let i = 0; i < b.length / 2; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const random = seed / 4294967296 - 0.5;
    const hum = 0.035 * Math.sin((2 * Math.PI * 100 * i) / 16000);
    const click = i % 8000 < 96 ? random * 0.5 : 0;
    b.writeInt16LE(Math.round(32767 * (random * 0.04 + hum + click)), i * 2);
  }
  return b;
}
export function mixNoise(pcm) {
  const noise = noiseFixture(Math.ceil(pcm.length / 32000));
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2)
    out.writeInt16LE(
      Math.max(
        -32768,
        Math.min(32767, pcm.readInt16LE(i) + noise.readInt16LE(i) * 0.5),
      ),
      i,
    );
  return out;
}
