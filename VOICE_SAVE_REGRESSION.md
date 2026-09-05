# September 5 call-save regression

Audited call `d7b30ab3-f4e8-4794-ab57-a621ea6c8439` (Mahesh, Hindi).

## Evidence
Farmer supplied 1,000 kg and four days. One short utterance was transcribed in Telugu, causing the storage-evidence check to reject the first prepare tool. The later explicit Hindi storage statement was understood. The model read values aloud before successfully preparing them, then prepared again after the Urdu-script `ہاں صحیح ہے۔ <noise>` affirmative and repeated the readback. The next `हां सही।` triggered confirm_stock, but the exact-phrase allowlist rejected it. The tool returned an error in 2ms, yet Gemini falsely said the system was updated. Session saved=null and the database remained unchanged.

No packet loss: 4,699 input packets, zero sequence gaps. The failing write was a confirmation-validation failure, not slow SQLite or an unresolved request. Speech-end to first audio ranged 2.4–4.0 seconds. Audio transcription drift and model instruction noncompliance remain provider risks.

## Changes
- Normalize punctuation and known noise markers; accept the observed Hindi and Urdu affirmative forms, without accepting corrections/negations.
- Identical repeated preparations preserve the original readback boundary.
- A repeated prepare tool on an explicit confirmation commits only an existing, read-back proposal with exactly identical arguments. Changed values are rejected.
- Error results explicitly state no database update and require one targeted clarification, not a renewed greeting or market briefing.
- Phone displays a localized failed-save status; tool diagnostics now retain the exact error message.
- Prompt retains known fields on unclear/script-shifted input and directs confirm_stock after readback confirmation.

## Regression coverage
Real WS/router/SQLite harness replays four-day/1,000kg proposals, duplicate preparation, changed-argument rejection, Urdu affirmative plus noise marker, and Hindi `हां सही`. Asserts the actual database quantities and storage days, not only generated speech. Negative confirmation tests retain correction and negation rejection. These are deterministic protocol replays, not a claim that live acoustic recognition is flawless. Earlier production call data was not retroactively altered.
