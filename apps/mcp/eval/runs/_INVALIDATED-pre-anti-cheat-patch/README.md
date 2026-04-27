# Invalidated runs — anti-cheat gap (2026-04-28)

The runs below used `buildSubagentPrompt()` whose anti-cheat block
forbade reading `apps/mcp/eval/cases.json` etc. but DID NOT forbid
reading `eval/questions-revised-1000.json` — the source of ground
truth. Theoretical leak. Discarded for paper purposes.

The fix (`buildSubagentPrompt` patched to include all `eval/`-rooted
files in the anti-cheat list) lands at the same time as this README.
Future runs use the patched prompt.

## Invalidated

- `1k-pilot-sonnet-native/` — 7 stratified, 6/7 PASS Sonnet judge
- `1k-stratified-50-sonnet/` — wave 1 + wave 2 (~19 questions)
- `1k-wave3-sonnet/` — wave 3 (orchestrator-dispatched via `claude -p`
  headless, 34 questions, 33/34 mechanical pass). Used OLD anti-cheat
  prompts because /tmp/wave3-q-*.txt files were written with
  buildSubagentPrompt before its patch landed. Notable that this run
  ALSO produced 0 verse-marker-as-id citations — the MCP patch (which
  did land before these sub-agents executed) held even on pre-patched
  prompts. Useful as auxiliary evidence for the MCP fix even though
  the run itself doesn't count as paper-grade blind.
- `1k-sample-stratified-7/` — sample manifest only

## Still valid (used buildNativeMcpPrompt which had no gap)

- `multi-model-20260427-230126/` — codex 4-question smoke
- `1k-codex-smoke-*` — codex harness smoke tests

## Paper-grade post-patch runs

- `1k-rerun-q0001-patched/` — single-question validation
- `1k-final-patched-sonnet/` — 12-question stratified true-blind
  (one fresh sub-agent session per question, both patches active)
