import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test(
  "real local speech detector → WS/router → manual Gemini protocol survives 25 bilingual turns",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "agrisell-local-input-qa-"));
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/local-input-worker.mjs", import.meta.url),
          ),
        ],
        {
          cwd: directory,
          env: { ...process.env, ADMIN_TOKEN: "", GROQ_API_KEY: "" },
          timeout: 30000,
        },
      );
      assert.match(result.stdout, /"passed":true/);
      console.log(result.stdout.trim());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test("Gemini-only WS/router/SQLite: 45 turns, invalid arguments, cancellation and Hindi confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agrisell-voice-qa-"));
  try {
    const r = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/voice-fault-worker.mjs", import.meta.url),
        ),
      ],
      {
        cwd: directory,
        env: { ...process.env, ADMIN_TOKEN: "", GROQ_API_KEY: "" },
        timeout: 15000,
      },
    );
    assert.match(r.stdout, /'?passed"?:true/);
    console.log(r.stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
