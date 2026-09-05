import { parentPort } from "node:worker_threads";
import * as ort from "onnxruntime-node";
import { fileURLToPath } from "node:url";
const model = await ort.InferenceSession.create(
  fileURLToPath(new URL("../assets/silero_vad.onnx", import.meta.url)),
  { intraOpNumThreads: 1, interOpNumThreads: 1, executionProviders: ["cpu"] },
);
const sessions = new Map(),
  sampleRate = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
parentPort.postMessage({ type: "ready" });
let queue = Promise.resolve();
parentPort.on("message", (message) => {
  queue = queue
    .then(async () => {
      const { id, callId, pcm } = message;
      if (message.type === "close") {
        sessions.delete(callId);
        return;
      }
      try {
        let state = sessions.get(callId);
        if (!state) {
          state = {
            recurrent: new Float32Array(256),
            context: new Float32Array(64),
          };
          sessions.set(callId, state);
        }
        const samples = new Int16Array(pcm),
          input = new Float32Array(576);
        input.set(state.context);
        for (let i = 0; i < 512; i++) input[i + 64] = samples[i] / 32768;
        const start = performance.now();
        const result = await model.run({
          input: new ort.Tensor("float32", input, [1, 576]),
          state: new ort.Tensor("float32", state.recurrent, [2, 1, 128]),
          sr: sampleRate,
        });
        state.recurrent = Float32Array.from(result.stateN.data);
        state.context = input.slice(-64);
        parentPort.postMessage(
          {
            id,
            probability: Number(result.output.data[0]),
            inferenceMs: performance.now() - start,
            pcm,
          },
          [pcm],
        );
      } catch {
        parentPort.postMessage({ id, error: "Speech detector failed" });
      }
    })
    .catch(() => {});
});
