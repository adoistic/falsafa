# RUN-1000-CODEX — operator runbook

Codex CLI driver for the 1,000-question Falsafa MCP eval. Companion to the design at `docs/designs/eval-1000-run-plan.md`.

This file is the *runbook* — what to type, in what order, when something goes wrong. The design doc is the *why*.

---

## Prereqs

1. **codex CLI** installed and on `PATH`. Verify: `codex --version` (anything ≥ `0.120.0` is fine).
2. **Falsafa MCP** registered in `~/.codex/config.toml`:

   ```toml
   [mcp_servers.falsafa]
   command = "/bin/sh"
   args = ["-c", "exec /Users/siraj/.bun/bin/bun run /Users/siraj/falsafa/apps/mcp/src/index.ts 2>/dev/null"]
   ```

   Adjust the bun path and the repo path to wherever your machine has them. The wrapper drops the MCP server's stderr because codex treats any chatter on stderr as protocol noise.
3. **bun** ≥ 1.0 (for running the harness itself).
4. The question pool: `eval/questions-revised-1000.json` (already in repo).

---

## Smoke test (do this first — every time you change the harness or codex)

3 questions, stratified across categories, ~3 minutes wall:

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-smoke-$(date +%Y%m%d-%H%M%S) \
  --smoke \
  --concurrency 3
```

Expected output trail:

- `[liveness] probing codex + falsafa MCP...`
- `[liveness] ok — codex <version>`
- 3× `[wN start] q-XXXX ...`
- 3× `[ok] q-XXXX <ms>`
- `[done] 3 ok, 0 failed, 0 skipped`

If `[liveness FAILED]` fires, the harness will print the exact `~/.codex/config.toml` block to add. Add it, re-run.

If a question fails JSON validation, look at `<run>/_failures/<q-id>.txt` — that's the post-mortem. Common causes: codex wrote prose with no JSON block, codex wrote an empty `tool_calls`, codex wrapped JSON in a `*.json` filename block instead of `json`.

---

## Full 1,000-question run (background, overnight)

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-$(date +%Y%m%d-%H%M%S) \
  --concurrency 5 \
  > /tmp/codex-1k.log 2>&1 &

# Save the PID for later. Tail to follow:
tail -f /tmp/codex-1k.log
```

`--concurrency 5` is the safe default. Each codex child uses ~200–400MB and pushes the MCP server child for the duration of the question. 5× that is ~1.5GB peak, well within a 16GB laptop. If you have more headroom and want to crash through faster, try 8–10. Watch `top` for the first few minutes.

ETA: at ~30s/question with concurrency 5, full pool = roughly **100 minutes** wall. The harness logs `[progress] N/1000 done, Xm elapsed, est Ym remaining` at every 10% milestone, so you can re-estimate with real data after the first 100.

---

## Resuming an interrupted run

The harness writes one `<q-id>.json` per question on success. `--resume` skips any question whose result already exists.

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-20260427-184500 \  # the SAME out dir
  --resume \
  --concurrency 5
```

You can also re-run with `--resume` to retry only the failures: just delete the failed `<q-id>.stdout`/`<q-id>.stderr`/`<q-id>.txt` (and ensure no `<q-id>.json`), then re-run with `--resume`.

---

## Targeted slices

Stratified 50, one column for each category × difficulty:

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-strat50-$(date +%Y%m%d-%H%M%S) \
  --stratified 50 \
  --concurrency 5
```

Just hard-difficulty citation questions:

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-citations-hard-$(date +%Y%m%d-%H%M%S) \
  --filter category=citation \
  --filter difficulty=hard \
  --concurrency 5
```

Random sample of 100 (seeded — reproducible):

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-sample100-$(date +%Y%m%d-%H%M%S) \
  --sample 100 \
  --concurrency 5
```

---

## What gets written

```
<out-dir>/
├── _manifest.json     # timestamp, git sha, codex version, model, sample, concurrency, q-ids
├── _sample.json       # the questions that ran (with ground-truth — used by post-hoc scorers)
├── _prompts/<q-id>.txt      # exact prompt the agent saw (auditable)
├── <q-id>.stdout            # raw codex stdout (trace + final assistant text)
├── <q-id>.stderr            # codex stderr (model meta, MCP attach noise)
├── <q-id>.json              # canonical {answer, tool_calls, citations} (this is the artifact)
├── _failures/<q-id>.txt     # only if extraction failed — reason + tail of stdout
└── _summary.json            # counts, by-category, by-difficulty, list of failures
```

The `<q-id>.json` shape matches `apps/mcp/eval/runs/1k-pilot-sonnet-native/sonnet/q-0109.json` so the existing scorers (`score-1000.ts`, `judge-1000.ts` — TBD) can ingest a codex run the same way they ingest a Sonnet run.

---

## Common failures and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `[liveness FAILED]` mentions "Cynewulf" | falsafa MCP not attached | add `[mcp_servers.falsafa]` to `~/.codex/config.toml` |
| `codex --version failed` | codex not on PATH | `npm i -g @openai/codex-cli` (or however you install it) |
| Many `[err]` with `no fenced ```json block` | codex truncating before final answer | look at `<q-id>.stdout` — usually the model timed out or refused. Try a more permissive `--model`. |
| Many `[err]` with `codex exit 137` | OOM kill — concurrency too high | drop `--concurrency` |
| Same `[err]` reproducibly on the same `q-id` | bad question prompt or known-broken MCP path | inspect `<q-id>.stdout`, file an issue, exclude with `--filter` |

---

## Decisions baked into this harness

- **Capture path, not sandbox-write path.** The runbook offers two ways to get codex output onto disk: pass `-c sandbox_workspace_write.allowed_paths=...` or capture stdout. We capture. The 4-question pilot proved stdout capture works, the stdout itself is a paper artifact (full transcript), and we don't have to fight codex's sandbox semantics across versions.
- **One codex child per question.** No multiplexing, no session reuse. Each question gets a clean context — that's the whole premise of black-box eval.
- **`--concurrency 5` default.** Sized for the laptop test path. Bump on larger boxes after a smoke test.
- **Seeded sampling.** `--sample` and `--stratified` use a fixed PRNG seed (42). Two runs with the same seed and pool produce the same slice — important for cross-driver A/B (codex on the same 50 the sub-agent ran on).
- **Manifest written BEFORE the run.** A crashed run still has a paper trail. The summary is written at the end and includes the failure list.

---

## After the run

The canonical results in `<out>/<q-id>.json` are the input for:

- `apps/mcp/eval/score-1000.ts` — mechanical scoring on `expected_works`
- `apps/mcp/eval/judge-1000.ts` — Sonnet judge with citation resolution

Both are TBD per the design doc; they read from the run dir, not from this harness.
