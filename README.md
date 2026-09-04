# AgriSell AI — field intelligence pilot

A database-backed FPO workspace for farmer stock, weather-aware selling scenarios and consented outbound voice calls. This is a **pilot foundation**, not a validated autonomous agricultural adviser.

## Interactive browser phone demo

The demo only needs `GROQ_API_KEY` in your local `.env`. No Twilio, Sarvam, mandi key, actual phone number, or public server is needed.

1. Run `npm run dev` and open `http://localhost:5173`.
2. In **Interactive voice demo**, select a farmer and English (the fully tested speech path).
3. Click **Open farmer phone**, then enable sound in that separate screen.
4. On the dashboard, click **Ring demo call**. Answer on the phone screen.
5. Click **Talk**, allow the microphone, speak, and click **Stop & send**. Alternatively type your reply.
6. Say “I have 650 kilograms left,” then “I can store them for two days.”
7. Say “yes” or click **Confirm & update dashboard**. The active stock refreshes on the dashboard automatically. Unconfirmed values are never saved.

**Actual providers:** Groq GPT-OSS 20B for structured conversation and Whisper Large v3 Turbo for transcription. The account's available model list did not include a general-purpose 8B model, so the model defaults to `openai/gpt-oss-20b` (override with `GROQ_CHAT_MODEL`). Requests count toward your Groq account quota; this app does not upgrade plans or enable paid telephony.

**Speech:** English first attempts Groq Orpheus. Groq currently requires separate model terms acceptance in this account. Until you accept those yourself, the server generates WAV speech with macOS's built-in Samantha voice. If neither is available, the browser attempts its own speech synthesis. The phone shows the provider that actually played. Hindi/Marathi conversations and transcription are supported; spoken playback uses browser voices and depends on installed language support. English is recommended for the complete demo. Microphone input requires localhost or HTTPS and browser permission; typing always remains available.

**Privacy and state:** Only deliberately recorded microphone clips are sent to Groq for transcription. Conversation text (not the farmer's phone number) is sent to Groq for replies. Raw audio is not stored by this app; generated local WAV files are deleted after reading. Transcripts, call state and confirmed stock changes are kept in SQLite. This is an AI browser simulation, not a PSTN phone call. Existing real-call routes remain separate and disabled by default.

**Safety:** Explicit confirmation is required. Stock edits on the dashboard invalidate a pending call's snapshot, preventing an older conversation from overwriting newer data. Negative/oversized quantities and unsupported storage periods are rejected. Saying “no” cancels the proposal. Ending an unconfirmed call does not change stock.

Run the live API integration check with `node scripts/demo-smoke.mjs` while the app is running. It uses synthesized sample audio (not your microphone), verifies speech, real transcription, model extraction, confirmation, and database updates, then archives its fictional test stock. Unit tests remain offline: `npm test`.

The backend is deliberately not watch-restarted during calls. Restart `npm run dev` after backend or `.env` changes; frontend changes still reload through Vite.

## Run locally

Requires Node.js 24+ (uses built-in SQLite).

```sh
npm install
npm run dev
```

Open http://localhost:5173. The API runs on 127.0.0.1:8787. SQLite is created at `data/agrisell.db`; it is ignored by Git. Seed farmers are fictional and cannot be called without consent.

## What works

- Farmer onboarding and active crop records persisted in SQLite.
- Edit remaining stock, storage days and price; zero stock archives the crop.
- Live Open-Meteo weather by location, with explicitly labelled fallback data.
- AGMARKNET adapter through data.gov.in, restricted to Nashik pilot markets; accepts a configured API key and rejects records older than three days.
- Transparent SELL / WAIT / OTHER MANDI scenario calculations, including spoilage, rainfall and assumed transport cost.
- English, Hindi and Marathi call scripts; actual Twilio outbound calls, optional Sarvam regional speech, provider status retrieval, consent and cooldown checks.
- Operator-token access when `ADMIN_TOKEN` is configured.
- No real calls in the default mode. Simulated calls are labelled and logged, never marked delivered.

## Activate integrations

Copy `.env.example` to `.env` and fill it locally. Never commit credentials.

### Weather

[Open-Meteo](https://open-meteo.com/en/docs) is used without a key for local evaluation. Review its commercial-use terms or use a licensed/self-hosted service before commercial launch. The API is open-source; an open API is not the same as an unrestricted free production service.

### Mandi prices

Create a data.gov.in API key and set `DATA_GOV_API_KEY`. The adapter uses the [AGMARKNET daily price resource](https://www.data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi). Values are normalized from rupees/quintal to rupees/kg. If the API fails, returns no recent records or has no key, the app shows demo data and blocks live recommendation calls. Validate market names, commodity grades, dates and units against your pilot before enabling operations.

### Actual phone calls

Set `ADMIN_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `CALLS_ENABLED=true`. Twilio requires an enabled/funded account, a valid caller ID and permission to call the destination. Calls are billed. Account/geographic restrictions may apply.

For Hindi or Marathi calls, also set `SARVAM_API_KEY` and a public HTTPS `APP_URL`. Sarvam creates the spoken audio; Twilio fetches it from a short-lived unguessable URL. English calls use inline TwiML and do not need public audio hosting. Regional audio is held in memory for 15 minutes, so this implementation is single-instance.

1. Add a real test farmer with their explicit consent and international-format phone number.
2. Connect and validate the mandi feed.
3. Run intelligence, review the recommendation and click **Call farmer**.
4. Open **Call centre** to retrieve the provider status.

Calls are blocked for demo market recommendations, unconsented farmers, stale stock records and repeat contact within 12 hours. Do not use this for unsolicited calling; verify applicable telecom/provider requirements before a pilot.

## Tests

```sh
npm test
npm run build
# With the local API running, simulator mode only:
node scripts/smoke.mjs
```

The smoke test creates a fictional record, runs analysis, verifies a simulated call and call history, then archives its stock.

## Deployment

```sh
npm run build
ADMIN_TOKEN=your-long-random-token HOST=0.0.0.0 npm start
```

Serve behind HTTPS, mount persistent storage for `data/`, back up the SQLite database, and set provider secrets through the host's secret manager. `Dockerfile` and `compose.yaml` are supplied. The token gate is a single-operator pilot mechanism, not multi-tenant authentication.

## Before a commercial launch

- Replace the scenario heuristic with a time-series model trained and backtested on crop/grade/market histories. The displayed range is a scenario band, **not a calibrated prediction interval**.
- Validate spoilage and transport assumptions with the FPO. Today’s baseline is entered by the officer; cross-market observations are not a future-price forecast.
- Add historical arrivals, grade matching, stale-stock verification and market-level logistics. Current data integration is focused on Nashik and four crops.
- Add multi-user roles, audit trails, consent history, retention/deletion policy, encrypted backups, rate limits, monitoring and recovery tests.
- Validate voice pronunciation, delivery costs and provider/telecom permissions for the target farmer group.
- Run a controlled pilot measuring net realization against a sell-today baseline. Human review is required; there is no automatic scheduled calling in this version.

## API references

- [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api)
- [Twilio Calls API](https://www.twilio.com/docs/voice/api/call-resource)
- [Sarvam speech API](https://docs.sarvam.ai/api-reference/text-to-speech/convert)
