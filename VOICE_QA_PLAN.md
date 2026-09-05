# Voice QA and implementation plan

## Recording follow-up: 4 September, 18:41

### Audit / reproduce / cause

Reviewed the supplied 32.32-second recording's frames and used Gemini audio analysis on its extracted audio (original unchanged). The analysis reports the greeting cut off around 16 seconds, roughly six seconds of silence, and fragmented/warbling speech afterward; it found no intelligible human speech. A screen recording is **not** the exact post-AEC microphone stream, so this does not establish which microphone signal caused the false activation.

Call `17187ae3-0f48-46c6-a824-1f4f03f0e6e5` matches the recording time and words. The local detector interrupted playback 1.9 seconds into the greeting at **0.6255** speech confidence; Gemini transcribed the input as **`<noise>`**. The preceding call did the same at **0.6379**, with only six positive detector frames in the entire call. The input transport had **zero missing packets**; in the recorded call maximum detector queue time was **27.5 ms**. The implementation used the same two-frame / 64 ms onset rule during speaker output as during idle listening. This prematurely committed ambiguous noise to Gemini as a user turn and stopped the greeting. Noise or residual echo is the likely trigger; raw microphone samples were not retained, so exact acoustic attribution remains unproven.

The first post-noise response began **6,236 ms after the activity-end marker**. This interval was before any reply audio, not a stock/database wait. During that response the browser drained and restarted **22 playback bursts**, with some inter-burst holes near **390 ms**. The old scheduler reinserted a fixed 60 ms delay on every underflow, with no adaptation. The original trace did not retain each provider chunk, so it cannot distinguish provider starvation from delayed browser delivery. Added bounded server and browser per-chunk timing metadata to make that distinction on subsequent calls; no raw speech is stored.

### Targeted plan / changes

1. **HIGH — false interruption:** keep the existing native Silero/Gemini path. Use actual client playback queue timing to apply stronger evidence only while output is audible. Require five consecutive frames >=.8, or three >=.95 for short, clear interruptions. The normal two-frame idle path and 320 ms pre-roll remain. The first five-frame-only attempt failed the real ONNX Hindi `हाँ` fixture; its measured three-frame high-confidence peak motivated the short-answer branch. Client playback expiry is bounded and clears on final drain/interruption; provider generation alone does not keep the microphone in stricter mode. This is an echo/noise mitigation, **not a full acoustic echo canceller**.
2. **HIGH — output underflow:** `src/audio-playout.js` learns buffer growth from measured underflow instead of repeating a fixed restart delay. The cushion is capped at 400 ms, informed by this recording's ~390 ms burst holes. Contiguous audio remains sample-contiguous, speed/pitch are unchanged, and a large initial packet still starts after the original 60 ms. No whole-response buffering or waiting promise is introduced. Interruptions/reset discard the old schedule immediately.
3. **Instrumentation:** `server/services/voice-diagnostics.js` records bounded provider output duration/interarrival and browser playout queue timing separately. `playback_underrun` reports missing audio and selected buffer, and VAD records maximum confidence plus interruption evidence duration. `server/live.js`, `server/services/voice-ingress.js`, `server/services/speech-gate.js`, and `src/phone.js` connect these signals.

### QA / measured outcomes / limits

- A reconstructed burst-boundary replay (not original individual PCM chunks) reproduces **21 underflows** in the old clock versus **8** with the adaptive clock, with **120 ms** additional final drain time. This improves fragmentation but **does not establish uninterrupted output** on a producer slower than real time. The reconstruction includes browser callback timing error. Tests explicitly preserve this limitation rather than labeling it a perfect call.
- Automated playout tests cover 25 normal turns, the recorded burst pattern, lost/slow chunks, invalid duration, interruption, reconnection reset and a bounded delay under sustained underfeed. Existing actual-phone event-handler tests still pass.
- `scripts/vad-qa.mjs` now exercises all ten speech/noise fixtures both idle and during output: **20 fixture conditions passed**, including Hindi `हाँ` and English `yes` with noise. Native inference p50/p95 approximately **0.127 / 0.190 ms**. A concurrent noise-only call stayed quiet while 25 speech turns completed. These synthetic noise fixtures do not prove rejection of arbitrary room/TV speech or acoustic echo.
- The instrumented pre-fix real Gemini noisy Hindi separated-field call passed: stock quantity → storage question → explicit confirmation → **500 kg / one day saved** → sourced weather advice. Ready-to-first-audio **1,802 ms**; speech-end-marker-to-audio **2,202 / 4,561 / 3,211 / 5,507 ms**. New provider chunk timings showed a common 960 ms initial packet followed by 40 ms pieces delivered faster than playout; hence adding a blanket multi-second initial buffer would penalize normal calls without addressing the observed false turn.
- Browser skill verified that the updated phone UI loads. This is not microphone/speaker acoustic QA. Backend restarted with the patched implementation; refresh an already-open phone tab before a new call.
- Final automated suite: **67 passed**; production build and `git diff --check` passed. Final live call `fc1cd940-f155-4cce-993c-e4d1ba78a594` completed the quantity/storage/confirmation sequence and saved **500 kg / one day**, without packet loss; maximum input queue was **2.26 ms** and local tools took **1 ms**. Opening audio took **3,437 ms** after ready and speech-end-marker → audio remained **2,251 / 2,899 / 3,895 / 4,976 ms**. The final weather question did **not** trigger `selling_advice`, so the live script's source-grounding assertion **failed**. This run is not an overall passing end-to-end result; the skipped weather lookup remains a separate model/tool-use issue. It is not evidence that the new playout scheduler was acoustically tested, since this smoke script consumes audio over WebSocket without speakers.

**Remaining release gate:** repeat a real human Hindi/English call on the user's microphone/speakers and inspect the newly paired input/output metrics. Strong echo, background human speech, very quiet interruptions and slow provider generation can still fail. No claim of consistently sub-second response or fully eliminated silence is justified by these tests.

Audio format verified against [Google's Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): the existing 16-bit little-endian PCM / 24 kHz output decoding is correct; changing playback sample rate is not an appropriate fix.

## Latest follow-up: silent opening and repeated quantity question

Audited actual call `8cf113f5-0346-4657-9585-2a49a7098ebd`. The connection was ready in **486 ms**, but the first generation/turn completed **624 ms later with zero audio**. The old handler treated this as a successful completed opening and stopped its reply watchdog. The farmer had to say hello before hearing anything. Later, the transcript correctly contained `मेरे 500 केजी बाकी है।`, but the assistant repeated its introduction/quantity question. This was not a lost microphone packet: all 3,523 packets arrived without sequence gaps and the maximum detector queue delay was 16.6 ms.

### Implemented

- `server/services/opening-turn.js`: audible-opening state independent of generic turn completion. An empty completed opening gets **one immediate retry**, not a timed synthetic recovery conversation. A second empty result closes explicitly. Any farmer speech, audible reply, hangup or disconnected delivery prevents a stale greeting retry. A failed scheduled send cannot become an uncaught microtask exception.
- `server/live.js` and `server/services/live-connection.js`: send the initial greeting as one explicit Gemini 2.5 `sendClientContent` turn with `turnComplete: true`, instead of text between microphone activity markers. Add `opening_request`, `opening_empty`, `opening_first_audio` and delivery-failure telemetry. The native microphone remains on the existing manual VAD protocol. Explicit text turns alone did not eliminate provider empty responses, so the audible-opening guard remains necessary.
- `server/services/call-context.js`: a short, immediate spoken-opening request; one-time introduction rule in the system instructions; listen-before-reply applies **after** the greeting. Current quantities such as `500 केजी` must lead to the missing storage question, not another introduction. Removed repeated historical stock from the opening request.
- Save responses no longer return the entire duplicate database context. Advice returns concise source-grounded facts rather than both those facts and the full duplicate context. Complete source details remain persisted for dashboard/receipt use. Advice instructions request a practical answer in at most two short sentences instead of reading a report aloud. `tool_end.responseBytes` records the serialized response size without logging content.
- `server/services/source-cache.js`: five-minute, bounded, deduplicated public-source cache; weather/market prefetch runs in the background **after** dispatching the opening. Keys include location/coordinates/crop and India calendar date. Actual source retrieval timestamps are preserved. Failed/unavailable sources are not cached. **Farmer stock, pending proposals and confirmations are never cached**; tool context still reads the current database. Existing three-second source-read bounds remain.

### Reproduction / verification

- New unit cases cover silent first completion, speech overtaking a retry, repeated empty output, hangup, disconnected delivery and 50 later turns with no greeting replay. The real WS/SQLite fault harness now deliberately returns an empty first opening and asserts automatic recovery before farmer input.
- Source-cache tests cover concurrent deduplication, expiry, failed/unavailable results, capacity and retained source timestamp. Existing native 25-turn bilingual ingress, 45-turn protocol fault simulation and confirmation/receipt checks remain.
- **Actual noisy Hindi reproduction passed:** opening → `500 केजी` → storage question only → `एक दिन` → exact read-back → `हाँ सही है` → **500 kg / one day saved** → grounded selling advice. This run itself returned an empty first opening; the guard recovered automatically and first audio arrived 2,399 ms after ready. The farmer did not have to provide a hello or repeat the quantity.
- The advice response interval from first audio to provider turn completion was **9.0 seconds**, versus **23.1 seconds** in the reported call. These are different individual replies, not an acoustic playback benchmark or a guaranteed percentage improvement. Speech-end-marker-to-first-audio still ranged **2.8–5.1 seconds** in that noisy five-turn provider test.
- Six initial provider opening checks all produced audio, including four automatically recovered empty openings. After shortening the request and clarifying that listening follows the opening, another six all produced audio **without a retry**, in **3,328 / 1,270 / 1,516 / 1,309 / 4,300 / 1,585 ms** after ready. Small samples do not prove a zero-failure rate. The fallback remains bounded and tested.
- The English separated-field call also retained the quantity, asked only for days and saved correctly. Its generic “what should I do?” answer used the already-known stock/recorded-price facts without a weather tool; the weather QA scenario now explicitly asks for today's weather, so a tool/source assertion tests a genuinely required lookup rather than an unnecessary API call.
- A later sampled Hindi answer included a brief extra `नमस्ते` but correctly asked **only for storage days**, not the quantity or identity again. The regression assertion checks the actual lost-field/full-introduction failure; it does not pretend that model-generated courtesy words can be eliminated deterministically by a prompt.

### Final rerun and additional safeguards

Repeated live tests also caught a full greeting replay and, in another run, an invented `storageDays: 0` after quantity-only input. These failures were not counted as passes. The final startup context is a factual **call-connected message**, not an imperative “say this greeting” user turn; the one-time opening instruction lives in the system policy. `validateStockEvidence` now rejects days supplied by the model when the farmer has provided no days evidence, and returns a targeted missing-days question. It accepts a bare day number only after a storage-days question. This is a narrow presence/context check, not a claim of perfect semantic extraction; schema validation and explicit confirmation remain mandatory. A sold-out quantity still implies zero storage days.

Final live run `2fef87cc-db18-44e6-86cb-18ab145449f2` passed the noisy Hindi separated-field sequence, confirmed **500 kg / one day**, saved the receipt and answered an explicit current-weather question. The opening spoke on its first attempt (**2,475 ms**), quantity was not requested twice, and the advice tool took **2 ms** with preloaded sources, versus **743–777 ms** in earlier uncached calls. The save response was **76 bytes** and advice response **598 bytes**, while full source details remained in the stored advice/receipt. The latest advice audio-response interval was **7.7 seconds**. Source prefetch completed in **220 ms**, independently of greeting generation.

Important: provider latency did not improve consistently in every sample. That final run's speech-end-marker → first-audio values were **3,397 / 5,715 / 3,704 / 5,950 ms** despite local tools taking 2–3 ms. The locally avoidable source wait is removed when warm; a general sub-second conversation or zero repeated model phrasing is **not** established. Real human repeated-call QA remains open.

Final automated suite: **62 passing tests**, production build and diff whitespace checks pass. Empty generation without a final turn event keeps the existing failure watchdog active, rather than disabling all recovery while waiting silently.

Reproduce with `node scripts/opening-smoke.mjs` and `node scripts/live-smoke.mjs --hindi --noise --separate-fields --advice`. The latter explicitly requests current weather. These use fictional QA farmers, not real outgoing telephone calls. Source cache/preload is excluded from injected-provider fault tests to avoid real external IO.

Remaining limits from the previous report still apply: provider generation latency, isolated noisy one-word Hindi transcription, human acoustic/echo testing, and conservative reconnect behavior. The opening fix does not make an unavailable provider instantaneous. See [Gemini's explicit client-content turn documentation](https://ai.google.dev/gemini-api/docs/live-api/capabilities) for the retained Gemini 2.5 protocol.

## Current follow-up: missed speech, background noise and response delay

This section supersedes earlier implementation descriptions below. Gemini Live, the local WebSocket server, SQLite and browser PCM playback remain in place. The Live model remains the September Gemini 2.5 version after the newer candidate failed the reliability gate.

### Audit → reproduce → root cause

- Audited real call `c2a5cfac-5580-48a6-b2fe-1f7eb3614648`: 9,484 microphone packets, zero observed sequence gaps, repeated interruptions, transcript-to-first-audio samples of 2,193 / 4,356 / 1,291 / 3,623 / 1,257 / 1,640 ms. `prepare_stock` and `confirm_stock` each took 2 ms, followed by 3,697 / 2,931 ms to provider audio. The database was not the multi-second blocker. No raw recording exists to establish exactly what the person said during silent intervals.
- The microphone previously forwarded all ambient PCM to Gemini's high-sensitivity detector. False interruption from noise is a plausible contributor, not proven from transcription alone. A local speech/noise test is now reproducible instead of guessing from a volume meter.
- **Proven capture defect:** the previous 2–3-sample box-average downsampler aliased high-frequency noise into the speech band. A 12 kHz, amplitude-0.5 test tone at 48 kHz produced output RMS 0.117844 at 16 kHz. The new low-pass FIR reduces that to 0.00002158. This is a controlled signal test, not a claim about every room's acoustic quality.
- **Proven remaining provider failure:** synthesized noisy isolated `हाँ` is detected and forwarded locally, but Gemini's auxiliary transcript becomes `Ja. <noise>` or Thai text. Both September and December versions reproduced it. Language hints did not resolve that fixture. The September model requested clarification; December also produced a false spoken save claim without calling the tool. SQLite correctly remained unchanged. This failure is retained in `--short-confirmation`, not hidden by relaxing confirmation checks.

### Targeted implementation

1. **High:** replace the box average with a 63-tap low-pass FIR in `public/voice-capture.js`; preserve 16 kHz / 32 ms PCM packets and native playback sample rate. At 48 kHz the filter's group delay is approximately 0.65 ms.
2. **High:** add the pinned MIT Silero v5.1.2 model and native ONNX runtime. `vad-worker.js` performs inference outside the main server thread, with independent recurrent state per call. `voice-ingress.js` bounds input backlog and in-flight jobs; `speech-gate.js` retains 320 ms pre-roll, detects two consecutive positive frames and ends speech after 576 ms of non-speech. This preserves the existing roughly 550 ms pause tolerance rather than arbitrarily cutting it for a benchmark.
3. **Critical:** use Gemini's supported manual `activityStart` / `activityEnd` protocol. Automatic detector options cannot coexist with `disabled: true`; the opening text also needs explicit activity boundaries. Real provider tests caught and corrected both setup mistakes before handoff. No `audioStreamEnd` is used in manual mode.
4. **Critical:** detector startup is bounded at 10 s; inference requests at 2 s; queues are bounded at 32 frames per call and 128 worker requests globally. Failure ends the affected call explicitly, releasing state. A failed worker is recreated for the next call. Reset/close discard stale in-flight results. No infinite buffering or silent fallback to a degraded detector.
5. **Medium:** confirmed local speech immediately stops browser playback instead of waiting for Gemini's interruption event. Late output is ignored while the farmer is speaking; the microphone stays active. This is not speaker identification: nearby human speech/TV and acoustic echo can still trigger speech detection.
6. **High:** shorten the opening and ordinary replies; retain typed local stock validation with no Groq/second Gemini request. Add Hindi/English transcription hints and stronger tool-confirmation instructions. A short/ambiguous transcript still cannot authorize a database write.
7. **Observability:** record detector inference/queue timings, frame counts, speech boundaries and browser-reported echo/noise-suppression settings. No raw microphone audio or device identifiers are persisted. Existing `providerActivityEndToFirstAudioMs` now also records explicit local activity-end markers; it is not the exact acoustic end of a word and excludes the 576 ms endpoint window.

### Validation and measurements

- `npm test`: 52 tests, including actual phone handlers and capture, timeout/reset/overflow cases, a 50-turn speech-gate stress test, and the existing reconnect/confirmation tests. The native bilingual integration uses macOS synthesized fixtures and skips on other platforms.
- Real local ONNX → WebSocket/router → mocked Gemini boundary: **25 English/Hindi turns**, noise-only rejection, explicit manual opening boundaries, zero packet gaps, no processing errors. Separately, the existing injected-provider WS/SQLite suite runs **25 sequential + 20 rapid turns**, five interruptions, cancellation, invalid/stale proposals and confirmed writes. These are protocol/input tests, not 45 actual Gemini conversations.
- Repeated both integration suites three additional times: **75 native-input turns + 135 protocol turns**, 15 interruptions, no failed runs. Each run uses a disposable database; no user farmer records are touched.
- `node scripts/vad-qa.mjs`: all ten clean/noisy/silence fixtures passed; includes isolated `yes`, `हाँ`, quantities and fan/click noise. 1,034 inference frames: approximately **0.13 ms p50 / 0.19 ms p95**. Actual asynchronous ingress also survived 25 mixed utterances while a second concurrent noise-only call produced zero speech starts; 2,318 frames per call, no errors.
- Real Gemini + noisy synthesized English: quantity/storage capture → spoken confirmation → **650 kg / 2 days persisted** → confirmed receipt passed. Local speech-end-marker → first audio: **3,554 / 2,935 ms**; detector p95 **1.26 ms**, peak input queue delay **35 ms**.
- Real Gemini + noisy synthesized Hindi with `हाँ, सही है`: same database/receipt workflow passed. Speech-end-marker → audio: **3,645 / 3,317 ms**; detector p95 **1.21 ms**, peak queue delay **5.3 ms**. The isolated one-word version remains a failing provider regression.
- Matched read-only three-turn provider probe (English/Hindi text → `read_stock` → audio), post-tool audio timings: September **1,398 / 2,004 / 3,334 ms**; December **1,026 / 1,494 / 1,696 ms**; `latest` **1,128 / 1,807 / 1,086 ms**. These small non-randomized samples suggested a candidate, but **December was not promoted** because of the noisy Hindi reliability failure. Gemini 3.1 failed account/provider preconditions. No paid plan or account setting was changed.
- Production build passes. Production dependency audit reports zero known vulnerabilities. Browser skill verified the updated phone screen loads without console errors; this does not substitute for microphone/speaker QA.

### Run / remaining gates

Run `npm test`, `node scripts/vad-qa.mjs`, `node scripts/live-smoke.mjs --noise`, and `node scripts/live-smoke.mjs --hindi --noise`. Add `--short-confirmation` to reproduce the known one-word provider failure. `scripts/voice-model-bench.mjs MODEL...` compares read-only provider turns. Live smoke creates an explicitly fictional QA farmer, marks its stock inactive afterward and retains the call diagnostics; it never calls a real telephone number.

`VOICE_INPUT_MODE=local` is the default; `provider` restores the old activity detector for diagnosis. No new API key is needed for local inference. See `server/assets/README.md` for the model source, SHA-256 and license.

**Not claimed fixed:** every short/noisy Hindi utterance, background human/TV speech, arbitrary acoustic echo, provider-side multi-second generation, or all human 20-turn conversations. No before/after acoustic latency percentile exists. Current tests establish bounded local processing, noise rejection on the fixtures, correct database writes in the passing scenarios, and continued provider limitations. A real Hindi/English laptop-speaker/headset session remains a release gate. The earlier conservative reconnect and browser-permission limitations still apply.

Sources: [Silero VAD source and license](https://github.com/snakers4/silero-vad/tree/v5.1.2), [Gemini Live capabilities and custom VAD](https://ai.google.dev/gemini-api/docs/live-api/capabilities).

## Follow-up: persistent “Information checked…” message

The reported call's trace showed a 2 ms stock tool, first response audio 1,512 ms after the tool returned, `generation_complete`, `turn_complete`, and browser `playback_drained`. The assistant had asked for confirmation. In that trace the tool/provider was not blocked; the secondary `capture-status` text remained stuck after successful playback. Audio-scheduled/drained telemetry establishes browser processing, not whether the person actually heard their speakers.

Reproduced before fixing with `test/phone-flow.test.js`, which runs the actual `src/phone.js` handlers with mocked DOM, audio-device and socket boundaries: after stock check → reply audio → playback completion, the old preparing message persisted. A second regression reproduced eight false playback-drained events from eight cancelled chunks. A third integration assertion reproduced `updated` arriving after an immediate simulated tool reply, allowing waiting UI/watchdog state to be re-armed after completion.

Fixes: both status lines now derive from the same voice state; the tool notice clears on audio, completion, interruption and reconnect; playback drain explicitly invites the next spoken reply; cancelled-source callbacks are ignored; speaker mute, suspended audio and microphone health have explicit state-driven messages. Tool progress/watchdog state is set before response dispatch, failed tools are not labeled successful checks, and delivery during disconnected/reconnecting states throws instead of silently dropping the result.

Verification: 43 tests and production build pass. New handler-level tests repeat 25 tool/read-back/playback turns, retain saved stock details, confirm next mic PCM reaches the socket without a talk button, and test speaker mute, mic unmute and cancelled chunks. The 45-turn real-WS/SQLite fault simulation now asserts status-before-reply ordering. A fresh browser phone screen loads without console errors; microphone acoustics remain a manual gate.

After restarting with these changes, the real Gemini audio smoke test also passed through read-back, spoken confirmation, 650 kg / 2-day SQLite update and receipt creation. This provider test uses synthesized speech, not the user's microphone.

## Subsequent change: Gemini-only stock capture

The live `prepare_stock` tool now accepts typed `quantityKg` and `storageDays` directly from Gemini's existing audio session. Backend validation and spoken confirmation are unchanged in purpose. There is no second model request; the previous Groq extraction function has been removed. Groq remains only for separate legacy HTTP features and optional synthetic speech generation in the smoke-test harness. Dashboard live-provider labels no longer require Groq.

The updated suite passes 39 tests, including 45 sequential/rapid turns with the Groq key disabled and an explicit zero-Groq-request assertion, malformed fields, queued cancellation, stale proposals, and confirmed SQLite writes. Earlier timings and cancelled-extraction tests below describe the prior implementation and are historical, not claims about the updated path. Gemini tool arguments are still model output: local validation and read-back confirmation remain mandatory.

Real-provider verification also passed with `GROQ_API_KEY` empty in both the API process and smoke harness (local Mac speech supplied the test input). Gemini captured 650 kg / 2 days, read back the values, accepted spoken confirmation and saved the matching SQLite record and receipt. Local `prepare_stock` took 4 ms; last-transcript-to-first-audio times were 1,811 ms and 1,964 ms. The earlier Groq extraction sample was 273 ms, but these small, separate runs do not establish an end-to-end percentile or guaranteed speedup.

## Scope and evidence

The user reports missed speech, repeated answers, long pauses and random silence. Previous tests used generated English speech directly against the server, not the browser microphone, room acoustics or browser playback. Those passes do not establish that a real call feels smooth.

Confirmed code defects in the audited implementation (fixed below):

1. Playback completion of _one chunk_ sets “Listening” without waiting for provider turn completion.
2. WebSocket congestion drops mic packets; startup flush sends up to five seconds of PCM in a burst.
3. The watchdog sends a synthetic user instruction after ten seconds, changing conversation state during an unfinished reply.
4. “haan” and other ordinary affirmative variants fail the exact confirmation allowlist.
5. Cancelled tool jobs remain in the sequential queue until their underlying network request completes.
6. A new input during extraction can make the returned stock proposal stale. No input-revision check exists.
7. The setup timeout is cleared before the provider is actually ready. The output context is unnecessarily forced to 16 kHz although provider speech is 24 kHz.
8. Instrumentation cannot distinguish microphone silence, transport loss, slow tools, provider delay and playback underruns.
9. `generationComplete` and `waitingForInput` are ignored. Gemini can finish generating audio well before `turnComplete`; treating that playback interval as blocked generation produces false recovery. The real-provider trace measured one such interval at 8,811 ms. That interval itself is normal, not evidence of a provider freeze.
10. Output transcript messages contain the previously accumulated user transcript. The client marks that old transcript as fresh input on every output update, unnecessarily reopening the responding state.
11. The installed SDK's `onopenPromise` and `setupCompletePromise` have no rejection on socket close. A connection that never completes setup can leave the awaiting application task unresolved.

These explain reproducible application failure paths, not every historical acoustic incident. No recording or stage trace from the user's original freeze was available.

Hypotheses requiring acoustic QA: echo cancellation suppressing short answers, room noise causing false interruptions, 550 ms high-sensitivity end detection cutting off a thinking pause. Do not label these proven from source inspection.

## Implementation sequence

### P0: deterministic state and transport

- Drive UI from separate provider-turn, playback, tool, mute and connection states. Never show ready-to-answer solely because a chunk drained.
- Keep a bounded, paced PCM queue. Preserve short congestion; fail explicitly on sustained overflow rather than silently corrupt speech. Avoid replaying a long startup burst. Use native output sample rate, still resample microphone PCM to 16 kHz.
- Keep first-response/setup deadlines active. Replace synthetic recovery prompts with timed status feedback and a bounded explicit failure. Detect suspended audio and dead mic input.
- Add bounded, non-secret per-call diagnostics (no raw audio) for receive/response timing, tools, interruptions and transport stats.

### P0: turn and stock correctness

- Abort cancelled extraction, reject stale results on new farmer input, and bound tool requests.
- Extract only structured fields; do not ask Groq to compose a second conversational reply.
- Accept natural unambiguous affirmative forms in Hindi/English while rejecting corrections, negation and numbers.
- Re-read confirmed SQLite values and retain exactly-once confirmation semantics. Never announce an uncommitted write.

### P1: measured voice tuning

- Keep the existing 550 ms end-of-speech / high-sensitivity settings unchanged until acoustic measurements justify a change. Keep interruption support.
- Make assistant turns short (one question, no repeated greeting or repeated known fields).
- Keep source-grounded weather/market reads bounded; no extra text-model round trip on calls.

## QA matrix and release gates

- Unit: output chunk gap vs true turn end; interruption clears playback; mute/unmute; startup/short congestion/overflow; stale extraction and cancellation; confirmations vs corrections.
- Provider integration: new farmer, short quantity reply, storage reply, correction, “yes”/“haan”, read-back, stock save, persisted receipt, source lookup. Record turn latency, not just a final PASS.
- Browser: waiting/ringing/connecting/active/processing/ended UI, visible mic/connection health, no enable-sound control, message after hang-up.
- Acoustic/manual: English, Hindi and mixed language, quiet and normal room noise, laptop speakers and headset, interrupt while assistant speaks, pause mid-number, five-minute conversation. Must be checked with actual microphone/speakers; generated audio cannot substitute.
- Targets (not yet guaranteed): ordinary first audio p50 < 2 s and p95 < 4 s after speech end; source checks p95 < 6 s; no unexplained silence beyond 6 s; interruption stops local playback < 250 ms after provider interruption event; zero silent packet drops; zero stale/unconfirmed writes; 20 consecutive human turns without forced repetition.

## Deferred, only if measurements justify it

- Compare available Live model versions using the same bilingual corpus, not model-name assumptions.
- Broader reconnect coverage beyond a safe provider checkpoint. Conservative idle-checkpoint resumption is implemented; no automatic replay of unacknowledged speech or database writes.
- If provider VAD still misses quiet speech, evaluate a real speech VAD (not a simple volume threshold) against recorded consented samples.

## References

- Gemini Live capabilities, turn detection, interruptions and PCM formats: https://ai.google.dev/gemini-api/docs/live-api/capabilities
- [Gemini Live wire protocol](https://ai.google.dev/api/live): `generationComplete` versus `turnComplete`, independent input transcription ordering, interruption cancellation, `waitingForInput`, resumption state.
- Installed `@google/genai` 2.21.0, `dist/node/index.mjs`: audited the actual `Live.connect` setup promises and callback forwarding. No SDK files were modified.

## Results

### Implementation completed

The existing browser AudioWorklet → local WebSocket → Gemini Live → PCM playback architecture and model are unchanged.

| Priority      | Change                                                                                                                                            | Components                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Critical      | Honor generation completion and waiting-for-input; remove synthetic recovery prompts; distinguish fresh input from reused display transcript      | `server/live.js`, `src/phone.js`, `src/voice-state.js`                   |
| Critical      | Bound setup waits, ignore stale connection events, surface callback failures, resume only safe checkpoints with two retries maximum               | `server/services/live-connection.js`                                     |
| Critical      | Cancel underlying extraction, unblock tool queue, reject proposals overtaken by new input; retain confirmation transaction                        | `server/live.js`, `server/services/groq.js`                              |
| High          | Preserve brief PCM congestion with ordered bounded queue; explicitly end on overflow; avoid five-second startup replay                            | `src/voice-state.js`, `src/phone.js`                                     |
| High          | Groq returns stock fields only, not an unused second conversational reply; voice advice remains direct grounded facts with bounded external reads | `server/services/groq.js`, `server/live.js`                              |
| High          | Native playback context, explicit suspended/missing-microphone states, processing exception handling, bounded receipt fetches                     | `src/phone.js`                                                           |
| Medium        | Natural Hindi/English confirmations without accepting corrections; provider interruption clears queued playback                                   | `server/services/demo-state.js`, `src/phone.js`                          |
| Observability | Bounded timestamped event history, turn ordinals, tool IDs, packet sequence gaps, capture/playback/client-state telemetry, transport heartbeat    | `server/services/voice-diagnostics.js`, `server/live.js`, `src/phone.js` |

Timeouts are failure bounds, not latency tuning: SDK setup 12 s inside the existing 15 s client-start deadline; extraction 8 s; weather/market foreground reads 3 s; stalled reply status after 6 s and explicit end after 30 s without progress; missing socket-close after transport error 2.5 s; local WebSocket heartbeat every 10 s with 20 s stale detection. Generation completion disables the reply watchdog while audio plays. Irrecoverable cases close explicitly rather than pretending a reply was delivered.

### Reproduction and tests

- `npm test`: **37 tests passed**. Covers 16/44.1/48 kHz capture, short and 20-second synthetic voiced PCM separated by silence, completed generation during long playback, source-drain versus provider state, interruptions, 50 state cycles, congestion and overflow, missing SDK setup completion, socket error without close, failed resume, retry exhaustion, and stock confirmation safety.
- Real local WebSocket/router/SQLite integration with injected provider boundary: **25 sequential turns + 20 rapid turns**, five interruptions, one failed extraction, one stale-result rejection, one cancelled blocked extraction, then a successful `haan` confirmation. Zero sequence gaps; stock and receipt verified. This is protocol/fault simulation, not acoustic model testing.
- Repeated that isolated integration **10 times**: 450 ordinary/rapid input turns, 500 total provider replies, 50 interruptions, no failed runs. Each run uses a disposable SQLite database. Temporary test directories are removed afterward.
- Real Gemini/Groq provider smoke: generated English speech, new fictional farmer, opening from current database, quantity/storage capture, spoken yes, correct 650 kg / 2-day write, persisted confirmed receipt. Passed. The fictional QA crop is set inactive afterward; real farmer stock is not changed.
- Browser skill check: dashboard and separate farmer-phone screen rendered, with no console errors. This verifies rendering/loading only; no human microphone/speaker session was performed.
- `npm run build`: passed.

### Measured real-provider trace

| Stage                                       | Observed                            |
| ------------------------------------------- | ----------------------------------- |
| Provider setup                              | 487 ms                              |
| Ready → opening first audio                 | 2,216 ms                            |
| Last input transcript → first reply audio   | 2,935 ms; 1,628 ms (two turns only) |
| Structured stock extraction tool            | 273 ms                              |
| Confirm-stock tool                          | 2 ms                                |
| Opening generation-complete → turn-complete | 8,811 ms                            |

These are server event timestamps, not acoustic speech-end-to-speaker measurements, and not before/after improvement percentages. The small sample does not establish p50/p95 or model speed. No valid pre-fix latency benchmark exists. The measured bottleneck after stock extraction is principally the remaining provider response interval (2,168 ms from tool result to first audio on that turn), not the 273 ms extraction. We removed known avoidable work but did not claim a quantified speedup.

### Inspecting future failures

The existing operator-authenticated endpoint `GET /api/intelligence/calls/:id/diagnostics` returns active or persisted diagnostics. Events are bounded to the latest 250 and latency arrays to 30. No raw audio, credentials or farmer transcript text is included. Follow `connecting → ready → capture/input transport → input/activity end → tool_start/end → first_audio → playback_scheduled/drained → generation_complete/turn_complete`. Turn ordinals are local bookkeeping, not provider-issued IDs. Provider activity-end metrics are populated only if the model actually emits those signals; they are not inferred from transcript timing. Browser timing uses a separate monotonic clock and must not be subtracted directly from server wall-clock timestamps.

### Remaining release gates / limitations

- Human Hindi, English and mixed-language QA with headset and laptop speakers remains open, especially quiet single-word replies, echo/noise, pauses inside quantities and speaking over the assistant. Provider-independent tests cannot prove acoustic responsiveness.
- Only safe provider-checkpoint transient disconnects automatically resume. A disconnect during unacknowledged speech/tools, lost browser→server connection, repeated failures or quota denial ends explicitly; confirmed records survive. No unsafe speech/write replay. Planned provider shutdown/context-limit continuity is not yet stress-tested.
- Microphone audio before `ready` or during reconnection is not sent; the phone displays a connecting state. Sustained congestion fails visibly instead of dropping speech secretly.
- Input transcription ordering is independent in the provider protocol. Corrections during extraction are guarded; severely late/missing transcription can still cause a safe clarification rather than a save. Do not bypass confirmation to hide this.
- A suspended browser AudioContext may require a real user gesture to resume. A missing microphone shows a health warning; hardware/browser failure cannot be repaired by the model.
- The SDK does not expose its half-open socket until `connect()` resolves. The wrapper bounds the application wait and closes a late-resolving session, but cannot force-close an inaccessible SDK transport that never resolves.
- No validated 20-turn **human** conversation or acoustic latency percentile is claimed. Repeat the manual gate with the new diagnostics before calling the voice experience production-ready.
