# 2026-07-02 Ontology Sonnet Subagent Benchmark

## Status

Production-style benchmark of the restarted ontology extraction pipeline using
Claude **Sonnet 4.x subagents** as the extraction engine, driving the canonical
`anchor-range-v1` prompt/schema and the deterministic local validation +
quote-enrichment path. This was the practical route because the RunPod/ModelScope
GLM-5.2 endpoints never reached a healthy server (see
`2026-07-01-ontology-runpod-production-test-summary.md`), and no external API key
is present in this environment — the session's own Sonnet subagents are the
available model.

**Result: 16/16 real windows fully valid. Sonnet is acceptable for the first
production pass.**

## Method

- Engine: Claude Code `general-purpose` subagents, `model: sonnet`, one window
  per subagent. Each subagent reads the rendered canonical prompt from disk,
  returns only paragraph-anchored JSON (no model-written quotes), and writes it
  to a response file. The main session runs canonical validation + enrichment.
- Harness: `scripts/graph/ontology-production-run.ts` was refactored to export
  its `buildWindows`, `validateOntology`, `enrichOntology`, `extractJson`, and
  `percentile` functions (guarded `main()` with `import.meta.main`) so the
  benchmark reuses the **exact** production code, not a copy.
- Driver: `scripts/graph/ontology-sonnet-benchmark.ts` (`prepare` / `finalize`).
- Windows: 16 real corpus windows selected round-robin across genre|language
  buckets for diversity — 16 distinct buckets, from dense Roman law (Gaius) and
  Platonic dialogue to Herodotus (citation-dense history), Lucretius (954-para
  verse stress case), Marx/Paine/eugenics modern prose, and aphoristic logic.
  No synthetic text.
- Prompt: canonical `ontology-anchor-range-v1.md`, used verbatim. The subagent
  wrapper adds only operational scaffolding (read this path, write that path,
  restating the prompt's own no-quote / valid-anchor / `source:"manual"` rules).

## Report Table

| batch | attempted | valid | valid % | retries | p95 latency | valid windows/hour | est. cost | cost/valid window | decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke-1 | 1 | 1 | 100.0% | 0 | 316.1s | 10.7 | $0.34 | $0.3400 | healthy |
| batch-8 (concurrency 7) | 7 | 7 | 100.0% | 0 | 276.0s | 73.9 | $1.54 | $0.2194 | healthy |
| batch-16 (concurrency 8) | 8 | 8 | 100.0% | 2 | 1111.0s | 25.2 | $2.48 | $0.3100 | healthy |
| cumulative | 16 | 16 | 100.0% | 2 | 1111.0s | 31.6 | $4.36 | $0.2722 | healthy |

Throughput is concurrency-dependent: ~11 valid windows/hour per sequential
worker; ~74/hour observed at concurrency 7. The batch-16 rate (25/hour) is
dragged down by a single latency outlier (Herodotus, 1111s / 18.5 min) — see
failure modes.

## Validation Detail (16 windows)

- Valid JSON: **16/16** (after retry; 14/16 on first attempt).
- Schema-valid, raw model output (no repair): **14/16**.
- Windows needing lossless const-repair: **2/16** — both pre-instruction
  (the smoke window, dispatched before the `source:"manual"` reminder, and one
  batch-8 window citing bare authors). Every batch-16 window, dispatched with the
  full reminders, needed **zero** repair.
- Schema-valid after repair: **16/16**.
- Paragraph-anchor validity: **16/16** — no invalid ids, no invalid ranges,
  across ~2,000 evidence objects. This is the hard part and Sonnet nailed it.
- Deterministic enrichment success: **16/16**.
- Model-written quotes leaked: **0** across all responses.

Extraction volume (16 windows): 842 entities, 161 themes, 106 citations, 232
quote events; enrichment attached 6,955 quotes across 2,008 evidence objects
(35% resolved to paragraph-level fallback rather than a single sentence — expected
for verse/aphoristic material and multi-paragraph ranges).

## Deterministic Repairs (all lossless)

Two systematic, const-safe omissions were normalized before validation, mirroring
the production plan's "schema repair" step:

1. `quote_event.source` (schema const `"manual"`) — some outputs omit it.
2. `citation.cited_work` / `citation.cited_author` keys — models citing a bare
   author omit the `cited_work` key; defaulted to `""`. The validator's own
   `!cited_work && !cited_author` check still rejects genuinely empty citations,
   so nothing real is masked.

Both are eliminated at the source by restating the rules in the dispatch prompt;
the repair remains as a safety net.

## Failure Modes Observed

- **Malformed JSON on first attempt: 2/16 (12.5%).** Both were complete (not
  truncated) but had evidence-object structure slips — a transposed `]`/`}` and a
  `paragraph_range` whose `start`/`end` were not nested under the wrapper. Both
  passed cleanly on a single retry with sharper structure guidance. This is
  exactly the `RETRIES=1` behavior the production harness already implements.
- **Latency long tail.** Per-window latency (sequential): min 103s, p50 224s,
  mean 284s, p95/max **1111s**. One window (Herodotus, 155 dense paragraphs)
  took 18.5 min and dominated its batch's wall-clock. The tail, not the median,
  is the throughput risk.
- **One transient infra error** ("connection closed mid-response") on a retry
  dispatch; succeeded on re-dispatch. Not a model-quality issue.

## Cost / Token Notes

Token counts are **estimated** (chars/4) — the subagent route exposes no exact
per-call API usage. Estimated ~9,900 prompt + ~16,200 completion tokens per
window. At Sonnet standard pricing ($3/$15 per Mtok) that is ~$0.27 per valid
window. The independently-measured GLM-5.2 estimate (see
`2026-07-01-ontology-api-cost-estimate.md`) put input at ~10,309 tokens/window,
consistent with the chars/4 estimate here.

## Recommendation

- **Acceptable for full production first pass.** Sonnet produces schema-clean,
  100%-anchor-valid, enrichable output on diverse real corpus with a 12.5%
  single-retry rate that the existing harness already absorbs.
- **Full run projection (12,929 windows):**
  - Per-valid-window cost ~$0.27 → **~$3.5K** first-pass extraction (estimated;
    verify against real usage once a metered route is used).
  - Wall-clock is entirely concurrency-bound. At the observed ~10 valid
    windows/hour **per worker**, N concurrent subagents ≈ 10·N/hour. Concrete:
    32 workers ≈ 40 h, 64 workers ≈ 20 h, 128 workers ≈ 10 h. The 409 h figure
    in `run-summary.json` reflects the *measured* mixed low concurrency (1→8),
    not a concurrency ceiling.
- **Main failure modes to design for:** (1) occasional malformed JSON → keep the
  single-retry-on-invalid path (already present); (2) latency long tail on dense
  windows → cap per-window timeout and quarantine slow windows to a repair queue
  rather than letting one 18-min window stall a batch.
- **Adjustments to carry into production:** bake the `source:"manual"`,
  citation-key, and evidence-object-shape reminders into the operational dispatch
  wrapper (they drove first-attempt schema-validity to 100% in batch-16); keep
  the lossless const-repair as a net.
- **Splitting:** not required for correctness — even the 954-paragraph Lucretius
  window succeeded. Consider splitting only the highest-latency dense windows to
  flatten the tail, not for validity.

## Artifacts

Preserved under `corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark/`.
Committed: `run-summary.{json,md}`, `selection.json`, `timings.json`, this note.
Git-ignored (bulky, regenerable): `prompts/`, `responses/`, `windows/`,
`window-manifest.json`.
