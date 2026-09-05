# Local speech detector

`silero_vad.onnx`: Silero VAD v5.1.2, MIT license (see SILERO_LICENSE).
Source: https://github.com/snakers4/silero-vad/blob/v5.1.2/src/silero_vad/data/silero_vad.onnx
SHA-256: `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`

CPU inference runs in a dedicated Node worker. Per-call recurrent state is isolated;
no raw audio is stored and idle non-speech is not forwarded to Gemini.
