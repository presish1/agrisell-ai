// Retains the same Gemini Live connection API. Only acknowledged idle checkpoints resume.
export async function connectRecoverable(connect, options, onState = () => {}) {
  let session,
    closed = false,
    generation = 0,
    handle,
    resumable = false,
    dirty = false,
    attempts = 0,
    reconnecting = false,
    transportErrorTimer;
  async function open(resume = false) {
    const version = ++generation;
    const callbacks = options.callbacks;
    const params = {
      ...options,
      config: {
        ...options.config,
        sessionResumption: resume ? { handle } : {},
      },
      callbacks: {
        ...callbacks,
        onmessage: (event) => {
          if (version !== generation || closed) return;
          const checkpoint = event.sessionResumptionUpdate;
          if (checkpoint) {
            resumable = checkpoint.resumable === true;
            handle = checkpoint.newHandle;
            if (resumable) dirty = false;
          }
          if (event.toolCall) dirty = true;
          try {
            callbacks.onmessage(event);
          } catch {
            onState("handler_error");
            callbacks.onclose({
              code: 1011,
              reason:
                "Voice event processing failed. Confirmed records remain saved.",
            });
          }
        },
        // The close event determines if a transient socket error is safely resumable.
        onerror: () => {
          if (version === generation && !closed) {
            onState("transport_error");
            clearTimeout(transportErrorTimer);
            transportErrorTimer = setTimeout(
              () =>
                params.callbacks.onclose({
                  code: 1006,
                  reason: "Voice transport failed without a close event.",
                }),
              2500,
            );
          }
        },
        onclose: (event) => {
          if (version !== generation || closed) return;
          clearTimeout(transportErrorTimer);
          if (
            handle &&
            resumable &&
            !dirty &&
            attempts < 2 &&
            [1006, 1011, 1012, 1013].includes(event.code)
          ) {
            attempts++;
            reconnecting = true;
            onState("reconnecting");
            open(true)
              .then(() => {
                if (!closed) {
                  reconnecting = false;
                  onState("reconnected");
                }
              })
              .catch(() => {
                if (!closed)
                  callbacks.onclose({
                    code: 1011,
                    reason:
                      "Voice reconnection failed. Confirmed records are saved.",
                  });
              });
          } else callbacks.onclose(event);
        },
      },
    };
    let timer,
      expired = false;
    const pending = connect(params);
    pending.then(
      (s) => {
        if (expired || closed || version !== generation) s.close();
      },
      () => {},
    );
    try {
      const opened = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(Error("Gemini setup did not complete within 12 seconds"));
          }, 12000);
        }),
      ]);
      if (closed || version !== generation)
        throw Error("Voice connection superseded");
      session = opened;
    } catch (error) {
      if (version === generation) generation++;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  await open();
  return {
    sendClientContent(content) {
      if (closed || reconnecting)
        throw new Error("Cannot start a text turn while voice is disconnected");
      dirty = true;
      session.sendClientContent(content);
    },
    sendRealtimeInput(input) {
      if (closed || reconnecting) return;
      if (input.text || input.activityStart || input.activityEnd) dirty = true;
      if (input.audio?.data) {
        const b = Buffer.from(input.audio.data, "base64");
        for (let i = 0; i + 1 < b.length; i += 2)
          if (Math.abs(b.readInt16LE(i)) > 100) {
            dirty = true;
            break;
          }
      }
      session.sendRealtimeInput(input);
    },
    sendToolResponse(response) {
      if (closed || reconnecting)
        throw new Error(
          "Cannot deliver tool response while voice is disconnected",
        );
      dirty = true;
      session.sendToolResponse(response);
    },
    close() {
      closed = true;
      generation++;
      clearTimeout(transportErrorTimer);
      session?.close();
    },
  };
}
