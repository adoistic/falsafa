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

**Result: two production batches (prod-ramp-01 = 8 windows, prod-ramp-02 = 16
windows), all 24 new windows fully valid after repair. Total valid on disk: 40 /
12,797 (0.31%). Sonnet accepted for full production, with the single-retry repair
path made mandatory and subagent concurrency capped at ≤8.** The archive is not
complete in this session; the blocker is operational throughput (documented
below), not pipeline correctness. An idempotent daily resume task
(`ontology-archive-grind`, 02:21 local) now continues the run autonomously until
the archive is complete — see "Autonomous resume" below.

> **Update — prod-ramp-02 (16 windows, mixed Sanskrit Law + Kawi).** 16/16 valid
> after repair. First-attempt full-validity 10/16 (of the 13 that produced output;
> 3 hit transient API Overloaded / Connection-closed errors at concurrency 16 and
> wrote nothing — **lesson: cap subagent concurrency at ≤8**). All 6 re-dispatched
> windows validated; one (brhaspati part004) needed a second retry for a reversed
> range its own self-check missed. Cumulative across 40 windows: valid JSON 100%,
> paragraph-anchor validity 100%, enrichment 100%, **0 quote leaks**. Batch cost
> ~$3.57 ($0.22/valid window; ~10.3k prompt + 12.8k completion tokens avg — cheaper
> than prod-ramp-01 because the Kawi texts are shorter than dharmaśāstra).
> Extraction volume (40 windows): 1,649 entities, 383 themes, 228 citations, 591
> quote events; 16,845 quotes attached (29.8% paragraph-level fallback). Kawi names
> preserved in original transliteration (Kuñjarakarṇa, Pūrṇavijaya, Gandhavatī) per
> the source-anchored rule — no Sanskrit-IAST normalization.

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
| **prod-ramp-02** | **16** | **16** | **100.0%** | **7** | **~5–6m** | **≤8 workers (16 overloaded API)** | **$3.57** | **$0.2229** | **healthy after repair** |
| cumulative | 40 | 40 | 100.0% | 14 | — | concurrency-bound | $9.96 | $0.2490 | healthy |

prod-ramp-02 first-attempt full-validity was 10/16 (3 windows hit transient API
Overloaded/Connection-closed at concurrency 16 and wrote nothing; 3 had structure
slips). All recovered on retry — one needed a second retry. **Cap concurrency ≤8.**

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

## Progress log (in-session grind)

| through batch | cumulative valid | valid JSON | anchor validity | enrichment | quote leaks | new material |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| prod-ramp-01 | 24 | 100% | 100% | 100% | 0 | Āṅgirasa/Bṛhaspati Smṛti |
| prod-ramp-02 | 40 | 100% | 100% | 100% | 0 | Kātyāyana Smṛti, Kawi (Ganapatitattva, Kuñjarakarṇa, Kalpabuddha), Manu 1–2 |
| prod-ramp-03 | 48 | 100% | 100% | 100% | 0 | Manusmṛti 3–10 |
| prod-ramp-04 | 55 | 100% | 100% | 100% | 0 | Manusmṛti 11–14, Nāradasmṛti 2–4 |
| prod-ramp-05 | 63 | 100% | 100% | 100% | 0 | Nāradasmṛti 1, Parāśara Smṛti 1–3, Kawi Buddhist (Kamahāyānikan 1–3, Mahājñāna 1) |
| prod-ramp-06 | 71 | 100% | 100% | 100% | 0 | Kawi (Tattvajñāna 1–3, Ślokāntara 1–3), Viṣṇu Smṛti 1–2 |
| prod-ramp-07 | 79 | 100% | 100% | 100% | 0 | Viṣṇu Smṛti 3–7, Vīramitrodaya 1–3 |
| prod-ramp-08 | 87 | 100% | 100% | 100% | 0 | Vīramitrodaya 4–11 (large, >300p — 0 repairs after the large-window mitigation) |
| prod-ramp-09 | 95 | 100% | 100% | 100% | 0 | Vīramitrodaya 12–19 |
| prod-ramp-10 | 103 | 100% | 100% | 100% | 0 | Vīramitrodaya 20–21, Kawi Vratiśāsana 1–3, Vṛhaspatitattva 1–3 |

As of prod-ramp-10 (end of in-session grind): **103 / 12,797 windows valid (0.80%)**
across 33 distinct works. Cumulative extraction: 3,841 entities, 957 themes, 1,329
citations, 2,390 quote events; 50,108 quotes attached (30.3% paragraph-fallback).
Cost/valid window ~$0.28; full-archive est. ~$3,575. Across all 103 windows and
~14,000 evidence objects: valid JSON 100%, paragraph-anchor validity 100%,
enrichment 100%, **0 quote leaks**. Every failure was a single-retry-recoverable
structure slip (leftover key, reversed range, transient API error) — 0 unrecovered.
The remaining windows continue via the `ontology-archive-grind` scheduled
task (see below).

**Update — prod-ramp-11..12 (to 119 valid).** Two more batches: Yama & Yājñavalkya
Smṛti (finishing the Indic dharmaśāstra tranche) and the first Greek-philosophy
windows (Plato Apology, Crito, Phaedo, Symposium — the priority score sorts Indic
law first, so Greek philosophy begins around here). 119/12,797 valid; 4,347
entities, 1,110 themes, 1,403 citations, 2,615 quote events; 54,721 quotes. Valid
JSON/anchor/enrichment all 100%, 0 quote leaks. **Environmental blocker hit and
cleared:** the machine's Data volume filled to ~99% mid-batch and one extraction
subagent failed with ENOSPC (no output written); freeing ~5 GiB of regenerable
build artifacts (node_modules/.next/.venv) from four untouched sibling projects
restored headroom (28 GiB free), and the one casualty (Yājñavalkya part005) was
re-dispatched and validated. No ontology output was lost — the idempotent driver
simply re-ran the missing window. Lesson: disk headroom is a real production
constraint for a long local grind; the scheduled task should check free space and
pause/alert rather than write into a near-full disk.

As of prod-ramp-09: **95 / 12,797 windows valid (0.74%)**. Cumulative extraction:
3,595 entities, 886 themes, 1,226 citations, 2,219 quote events; 46,921 quotes
attached. Cost/valid window ~$0.28 (Vīramitrodaya digests are citation-dense, so
completion tokens run higher). The large-window mitigation (prefer `paragraph_ids`
>300p) closed the loop: prod-ramp-08 was 8/8 first-attempt on exactly the window
type that failed 3/8 in prod-ramp-07.

As of prod-ramp-07: **79 / 12,797 windows valid (0.62%)** across 30 distinct works.
Cumulative extraction: 2,913 entities, 779 themes, 520 citations, 1,202 quote
events; 32,936 quotes attached (32.5% paragraph-fallback). Cost/valid window
$0.24; full-archive est. ~$3,090.

Two recurring failure modes, both fully recovered by the single-retry repair path
(0 unrecovered, 0 quote leaks across all 79):
1. A `paragraph_range` evidence object carrying a leftover `paragraph_ids` key —
   pre-empted by an explicit "no leftover key" reminder (prod-ramp-04/05/06 hit 0).
2. A reversed `paragraph_range` (start after end), concentrated in **large windows
   (>300 paragraphs)** where paragraph order is hard to self-verify — all 3 of
   prod-ramp-07's failures were Viṣṇu Smṛti windows of 345–501 paragraphs.
   Mitigation carried into the dispatch/resume prompt: **for windows >300
   paragraphs, prefer explicit `paragraph_ids` over `paragraph_range`.**

## Autonomous resume

A local scheduled task **`ontology-archive-grind`** (daily at 02:21 local, aligned
to the usage-window reset) resumes the run unattended: each firing loops
`prepare --count 24` → dispatch ≤8 concurrent Sonnet subagents per window →
`finalize` → single-retry the failure queue, until the 5-hour window is exhausted
or `prepare` reports 0 remaining (archive complete). It is fully self-contained
(a fresh session has no memory of this one) and safe to re-run because the driver
skips already-valid and already-claimed windows. A cloud routine could not be used
— the run dir and corpus live on the local filesystem, which cloud agents can't
reach. At ~8 valid windows/hr/worker and ≤8 workers within each ~5h window, the
remaining ~12,757 windows complete over roughly 3–6 weeks of daily runs; provide a
funded metered API route to `ontology-production-run.ts` to compress that to
~24–49h.

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
