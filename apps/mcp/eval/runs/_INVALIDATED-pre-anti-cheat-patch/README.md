# Invalidated runs — anti-cheat gap (2026-04-28)

The runs below used `buildSubagentPrompt()` which forbade reading
`apps/mcp/eval/cases.json` etc. but DID NOT forbid reading
`eval/questions-revised-1000.json` — the source of ground truth.
Theoretical leak. Discarded for paper purposes.

The fix (`buildSubagentPrompt` patched to include all `eval/`-rooted
files in the anti-cheat list) lands at the same time as this README.
Future runs use the patched prompt.

## Invalidated

- `1k-pilot-sonnet-native/` — 7 stratified, 6/7 PASS Sonnet judge
- `1k-stratified-50-sonnet/` — wave 1 + wave 2 (~19 questions)
- `1k-wave3-sonnet/` — wave 3 (orchestrator-dispatched, in flight)
- `1k-sample-stratified-7/` — sample manifest only

## Still valid (used buildNativeMcpPrompt which had no gap)

- `multi-model-20260427-230126/` — codex 4-question smoke
- `1k-codex-smoke-*` — codex harness smoke tests
