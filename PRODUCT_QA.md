# Farmer calls and price evidence — September 5, 2026

## Fixed
- Recommendation-card calls were using the older recommendation/telephony endpoint rather than the Gemini browser-call flow. They now use the same browser-call route.
- New profiles did not select their new crop in the call panel. Creation now returns cropId, selects it and its preferred language, and returns to Overview.
- Each stock row has a direct Call action, including farmers with no recommendation yet. Farmer phone windows are keyed by crop ID, not one shared window name.
- Profile creation no longer waits for external geocoding/weather; coordinates enrich asynchronously.
- Successful stock writes provide explicit English/Hindi/Marathi system-update confirmation. No confirmation is emitted before the database transaction succeeds.
- Price refresh bypasses both cache layers. Invalid modal/minimum/maximum ranges, future dates and mismatched market IDs are excluded. Current-day lookup uses India time.
- Partial current-day reports no longer erase older valid vegetables: four report dates load concurrently, then each commodity uses its latest valid date. A live check returned 19 vegetables/21 observations, including September 5 Onion and September 4 Tomato; each retains its real report date.

## Historical price evidence
AGMARKNET's official date-wise commodity endpoint supplies three calendar months of history. Commodity/state/district IDs and market names are resolved against official metadata. Unit headers must identify rupees/quintal; values are converted to rupees/kg and validated. Same market/variety/grade series are kept separate; conflicting same-date observations are excluded.

The first connected model is an **experimental no-change baseline**, not a claimed predictive advantage. It requires 30 valid observations and 15 adjacent-day evaluation pairs. Up to the latest 30 walk-forward errors are measured without future-data leakage. Error bands use historical mean absolute error, NOT calibrated probabilities. Sparse, stale or failed history is explicitly unavailable. Farmer variety/grade are not yet collected, so this is market context, not a personalized guaranteed selling price.

Real source checks: Tomato, APMC Pimpalgaon Baswant, Other/unspecified grade: 56 observations, 30 evaluated pairs, MAE ₹2.20/kg, MAPE 13.05%. Potato, APMC Nasik, Other/unspecified grade: 52 observations, 30 pairs, MAE ₹0.48/kg, MAPE 5.67%. Latest observation September 4; estimate target September 5. Onion timed out during the first check. Results can change as the source publishes data.

History fetches are deduplicated and cached, start during call preparation and never add a blocking wait to voice turns. Explicit dashboard analysis waits for the bounded historical lookup. The Data & decisions result shows the model, evaluation and dated underlying observations separately from live prices.

## Verification
- 81 automated tests passed, including 25 bilingual acoustic turns and 45 protocol/fault turns, confirmation, cancellation, invalid fields and no Groq calls in the live pipeline.
- Six real Gemini opening calls on a newly created QA profile passed; readiness-to-first-audio: 2216, 1919, 1350, 1497, 3439, 1383 ms. These measure opening audio, not full conversational round-trip latency.
- Real Gemini messaging + HTTP + SQLite smoke passed: missing-field collection, confirmation-only writes, idempotency, persistence, dated source advice and concurrent-edit protection.
- Browser QA: created Farmer Flow QA, verified auto-selected Hindi/crop, direct Call opened crop-specific phone and showed the correct recipient ringing; declined without capturing a user's microphone.
- Production build and whitespace checks pass. QA stock is retired after testing; audit records remain.

## Limits
Published wholesale reports are not tick-by-tick trading prices or guaranteed buyer offers. Upstream publication delay, incorrect source entries, missing variety/grade and API outages cannot be eliminated locally. No claim of 100% market accuracy or fully validated forecasting is made. Old decision reports are historical snapshots; run a new analysis to use newly connected history.
