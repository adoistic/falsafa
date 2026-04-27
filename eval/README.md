# Falsafa eval suite

The 1,500-case adversarial eval used by the `/eval` explorer on falsafa.app and by CI for regression detection.

## Layout

- `cases.json` — all eval cases, single static asset (~800KB gzipped). Schema below.
- `results-falsafa/` — per-run output of running Falsafa's MCP server against `cases.json`. One JSON per run, timestamped.
- `results-baseline/` — per-run output of running `@falsafa/baseline` (hybrid RAG) against the same cases. Side-by-side with Falsafa's outputs in the explorer.
- `judge/` — Sonnet judge prompts + per-run aggregated judgments (used by `/eval` deep links).

## Why at the repo root

Multiple consumers (the `/eval` explorer in apps/site, the eval runner script, the CI hook, the baseline benchmark) all read this directory. It's data, not an app. Living at the repo root avoids tying it to any single app's release cycle.

## Status

Scaffolded by `/plan-eng-review` run 2 (2026-04-27). Eval-gen pipeline + 1,500 cases produced by run-1 backend work (FTS5 + LSH/MinHash + eval-gen). Explorer consumes from here in Phase 3 worktree A.

## Case schema (planned)

```json
{
  "id": "ghalib-168-couplet-citation",
  "category": "citation" | "comparative" | "edge" | "discovery" | "verification",
  "difficulty": "easy" | "medium" | "hard" | "adversarial",
  "prompt": "What does Ghalib's couplet 168 say about ...?",
  "expected_paragraph_ids": ["ghalib-bag-e-do-jahan/chapters/168-..."],
  "expected_outcome": "cite-paragraph" | "no-result" | "compare-works"
}
```
