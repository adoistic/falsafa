# 2026-07-02 Ontology Production Pass 01 (Sonnet Subagents)

## Status

First **production** pass of the restarted ontology extraction pipeline (the
`2026-07-02-ontology-sonnet-benchmark-summary.md` benchmark proved the pipeline;
this pass begins the archive run). Extraction engine is Claude Code **Sonnet 4.x
subagents**, one window per subagent, driving the canonical `anchor-range-v1`
prompt/schema and the deterministic local validation + quote-enrichment path.
This remains the practical route because RunPod/ModelScope GLM-5.2 never reached a
healthy endpoint and no external API key is present in-env — the session's own
Sonnet subagents are the available model.

**Result: 8 new real windows, 8/8 fully valid after a single repair pass. Total
valid on disk: 24 / 12,797 (0.19%). Sonnet accepted for full production, with the
single-retry repair path made mandatory.** The archive is not complete; the
blocker is operational throughput (documented below), not pipeline correctness.

## Method

- Driver: `scripts/graph/ontology-sonnet-production.ts` (`prepare` / `finalize`),
  a production sibling of the benchmark driver. `prepare --count N` walks the FULL
  archive in deterministic priority order, **skips windows that already have a
  valid enriched output** (idempotent resume), renders the next N canonical
  prompts to disk, and records the batch to `production-batches.json`. `finalize`
  runs the SAME canonical validation + deterministic enrichment as production
  (imported from `ontology-production-run.ts`, not copied), adds a hard
  quote-leak scan and a failure queue, and writes an aggregate summary.
- Windows: the archive's **highest-priority-score windows** — dense Sanskrit
  dharmaśāstra (Āṅgirasa Smṛti parts 1–6, Bṛhaspati Smṛti parts 1–2), 195–342
  paragraphs each. The hardest material in the corpus, and what sorts first.
- Prompt: canonical `ontology-anchor-range-v1.md`, verbatim. Dispatch wrapper adds
  only operational scaffolding (read this path, write that path) plus the prompt's
  own no-quote / valid-anchor / single-anchor-type / `source:"manual"` rules.

## Report table

| batch | attempted | valid | valid % | retries | p95 latency | valid windows/hour | est. cost | cost/valid window | decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke-1 (benchmark) | 1 | 1 | 100.0% | 0 | 316.1s | 10.7 | $0.34 | $0.3400 | healthy |
| batch-8 (benchmark) | 7 | 7 | 100.0% | 0 | 276.0s | 73.9 | $1.54 | $0.2194 | healthy |
| batch-16 (benchmark) | 8 | 8 | 100.0% | 2 | 1111.0s | 25.2 | $2.48 | $0.3100 | healthy |
| **prod-ramp-01** | **8** | **8** | **100.0%** | **5** | **276.0s / 419.0s repair** | **~131 @16w (8.2/worker)** | **$2.04** | **$0.2550** | **healthy after repair** |
| cumulative | 24 | 24 | 100.0% | 7 | — | concurrency-bound | $6.40 | $0.2665 | healthy |

`prod-ramp-01` first-attempt full-validity was **3/8 (37.5%)**; one targeted repair
pass took it to **8/8 (100%)**.

## Validation detail (prod-ramp-01, 8 windows)

- Valid JSON: **8/8** (all parsed first attempt, no truncation).
- Schema-valid, first attempt (no repair): **3/8** (37.5%).
- Paragraph-anchor validity, first attempt: **7/8** (one reversed range).
- Schema + anchor valid after single repair: **8/8**.
- Deterministic enrichment success: **8/8**.
- Model-written quotes leaked: **0/8**.

Cumulative across all 24 windows on disk: valid JSON 100%, anchor validity 100%,
enrichment 100%, 0 quote leaks. Integrity spot-check: an enriched `terms_sentence`
quote was confirmed a **verbatim substring** of the real corpus paragraph, and the
model anchor JSON contains no `quote` field.

Extraction volume (24 windows): 1,127 entities, 239 themes, 155 citations, 377
quote events; 10,837 quotes attached across 2,794 evidence objects (32.7%
paragraph-level fallback, expected for dense material and multi-paragraph ranges).

## Failure queue (pre-repair) — all resolved on one retry

| window | reason | anchor-invalid? |
| --- | --- | :--: |
| angirasa part002 | missing `evidence_hint` | no |
| angirasa part003 | missing `evidence_hint` | no |
| angirasa part004 | mixed anchor type (`paragraph_range` + `paragraph_ids`) | no |
| brhaspati part001 | reversed `paragraph_range` (start after end) | **yes** |
| brhaspati part002 | missing `evidence_hint` | no |

Post-repair failure queue: **empty**. Every failure was a first-attempt structure
slip — none were truncation, hallucinated anchors, or quote leaks.

## Cost / throughput / full-archive projection

Token counts are **estimated** (chars/4); the subagent route exposes no exact
usage. ~12.9k prompt + ~14.4k completion tokens per dense-legal window.

- Cost/valid window: **~$0.27** (Sonnet $3/$15 per Mtok).
- **Full-archive first-pass cost: ~$3,410** (12,797 × $0.27, estimated) — consistent
  with the independent GLM cost estimate's token model.
- Per-worker rate on this hardest material (incl. repair): ~8.2 valid windows/hr.
  Scaling: ~131/hr @16 workers · ~263/hr @32 · ~525/hr @64.
- Full-archive wall-clock: ~49h @32 concurrent workers, ~24h @64.

## Blocker (why the archive is not complete)

The pipeline is proven correct; the blocker is purely operational throughput:

1. The only extraction engine is in-session Claude Code Sonnet subagents (no
   metered endpoint; no API key).
2. One heavyweight subagent per window (75–125k subagent tokens, 125–420s), plus a
   second dispatch for the ~60% of dense-legal windows needing a repair, cannot
   cover 12,797 windows within one session's token budget, wall-clock, or the
   5-hour usage window.
3. Completing the archive requires either **(a)** a funded metered API route
   (GLM-5.2 / MiMo / Sonnet) driving the existing `ontology-production-run.ts`
   harness unattended (it already implements `RETRIES=1`, idempotent skip, and a
   repair queue), or **(b)** a cron/multi-session subagent-dispatch loop that
   resumes idempotently across many days.

`ontology-sonnet-production.ts` is idempotent by design (skips already-valid
windows, quarantines failures), so the run resumes incrementally without redoing
work — each future session just runs `prepare --count N` → dispatch → `finalize`.

## Recommendation

**Sonnet is acceptable for the full production first pass**, with one requirement
this pass makes non-negotiable: **always run the single-retry repair path.** Easy
material is ~90% first-attempt schema-valid; the hardest dense-legal material is
~37%, but one targeted retry recovers 100%, and every failure was a recoverable
structure slip (never a quote leak, hallucinated anchor, or truncation).

Carry into production: (1) always retry-on-invalid; (2) bake evidence-object-shape
reminders into the dispatch wrapper (both `evidence_hint`+`role`, single anchor
type, forward-only ranges, `source:"manual"`, both citation keys) — they drove the
repair pass to 100%; (3) keep the lossless const-repair as a net; (4) cap
per-window timeout and quarantine slow/hard windows rather than stalling a batch.

## Artifacts

Preserved on disk under `corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark/`
(that tree is git-ignored by repo policy — `corpus/graph/*`):
`production-run-summary.{json,md}`, `production-batches.json`, `prod-timings.json`,
and the per-window `windows/*.{anchor,enriched,meta}.json`.
Committed: `scripts/graph/ontology-sonnet-production.ts` and this note.
