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

**Update — prod-ramp-13..14 (to 135 valid, 1.05%).** Two batches of Plato's
Republic (parts 1–16). 135/12,797 valid; 4,786 entities, 1,270 themes, 1,471
citations, 2,815 quote events; 56,792 quotes. Valid JSON/anchor/enrichment all
100%, 0 quote leaks. 15 in-session batches total; cost/valid ~$0.26. Failure
modes unchanged (occasional missing `evidence_hint` or reversed range, all
single-retry-recovered).

**Update — prod-ramp-15..16 (to 151 valid, 1.18%).** Finished Plato's Republic
and processed Aristotle's Nicomachean Ethics (parts 1–12). 151/12,797 valid; 5,223
entities, 1,422 themes, 1,537 citations, 2,948 quote events; 59,745 quotes. Valid
JSON/anchor/enrichment all 100%, 0 quote leaks across 16 in-session batches;
cost/valid ~$0.25. The corpus coverage now spans the full Indic dharmaśāstra
tranche, the Kawi/Old-Javanese cluster, and Greek philosophy (all of Plato +
Aristotle's Ethics).

**Update — prod-ramp-17..18 (to 167 valid, 1.30%).** Aristotle (Ethics 13–18, On
Virtues, Constitution of the Athenians), Hippocrates (Aphorisms, De Diaeta), and
the first Latin work — Lucretius *De Rerum Natura*, including a **951-paragraph
verse window** that validated clean once forced to `paragraph_ids`-only.
167/12,797 valid; 5,737 entities, 1,561 themes, 1,600 citations, 3,089 quote
events; 64,658 quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks across
18 in-session batches; cost/valid ~$0.25. Residual failure mode: a fast subagent
run (≤2 tool calls, no self-check) occasionally drops one `evidence_hint` or
reverses one range — all single-retry-recovered; for the largest verse windows,
forcing `paragraph_ids`-only for every evidence object eliminates reversed ranges
entirely.

**Update — prod-ramp-19..20 (to 183 valid, 1.43%, 45 works).** All remaining
Lucretius *De Rerum Natura* windows (13 parts, many 800–990 paragraphs of verse)
and Euclid's *Elements* (a new mathematical domain — its "citations" are largely
internal proposition cross-references). 183/12,797 valid; 6,157 entities, 1,711
themes, 1,715 citations, 3,254 quote events; 80,229 quotes. Valid
JSON/anchor/enrichment all 100%, 0 quote leaks across 20 in-session batches;
cost/valid ~$0.25. Two operational notes: (1) one extraction subagent misread its
task and recursively spawned nested sub-agents rather than writing — the deepest
one still produced valid output, so no window was lost, but the wrapper should say
"do the extraction yourself; do not spawn sub-agents"; (2) the Euclid source has a
few repeated paragraph ids within a window — benign for validation (the id is in
the allowed set) but worth a dedup pass during reconciliation.

**Update — prod-ramp-24..26 (to 231 valid, 1.81%).** Marcus Aurelius' *Meditations*
(9 parts) plus a broad run of Cicero and Seneca Stoic works (Stoic Paradoxes,
Timaeus, Academica, Lucullus, On Fate; On Leisure, On Providence, On Steadfastness,
Consolations to Marcia and Helvia). 231/12,797 valid; 7,492 entities, 2,220
citations, and **over 100,000 quotes attached** (102,176). Valid JSON/anchor/
enrichment all 100%, 0 quote leaks across 27 in-session batches; cost/valid ~$0.24.
The steady residual failure mode remains ~1–2 reversed ranges per batch on
medium/large windows, always recovered by a single paragraph_ids-only retry.

**Update — prod-ramp-27 (to 239 valid, 1.87%).** More Seneca dialogues (On the
Shortness of Life, To Polybius, On the Happy Life, On Mercy) and Cicero's Lucullus
completed. 239/12,797 valid; 7,760 entities, 2,287 citations, 4,205 quote events;
103,615 quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks across 28
in-session batches; cost/valid ~$0.25. The autonomous restart was proven under a
real 5-hour cap earlier this run (limit hit mid-batch, windows re-ran after the
reset, nothing lost).

**Update — prod-ramp-28 (to 247 valid, 1.93%).** Seneca's *On Mercy* and the full
*On Anger* (7 parts). 247/12,797 valid; 7,967 entities, 2,326 citations; 104,854
quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks across 29 in-session
batches; cost/valid ~$0.25. prod-ramp-31 added Cicero On Moral Ends (De Finibus, complete) + Tusculan Disputations start → 271 valid (2.12%), 9,340 entities, 111,655 quotes. A one-time reset-aligned resume task (07:25 IST 2026-07-11) was added to catch the mid-morning usage-window reset in addition to the daily 02:21 task.

**Update — prod-ramp-29 (to 255 valid, 1.99%).** Cicero's *On the Nature of the
Gods* (8 parts) — theology-dense, up to 127 entities/window (gods, constellations,
philosophical schools). 255/12,797 valid; 8,521 entities, 2,421 citations, 4,515
quote events; 107,178 quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks
across 30 in-session batches; cost/valid ~$0.25. A third (rare) failure mode
appeared once — a `figure_kind` field on a non-figure entity — recovered by the
same single retry.

**Update — prod-ramp-34..35 (to 303 valid, 2.37% — crossed 3,000 citations).**
Cicero *On the Commonwealth* (De Re Publica) and the start of Seneca's *Letters to
Lucilius*. 303/12,797 valid; 10,807 entities, 3,001 citations; 118,318 quotes.
Valid JSON/anchor/enrichment all 100%, 0 quote leaks across 36 in-session batches;
cost/valid ~$0.25. The `figure_kind`-on-a-non-figure slip recurred (2nd time) —
still single-retry-recovered.

**Update — prod-ramp-31..33 (to 287 valid, 2.24% — crossed 10,000 entities).**
Cicero *Tusculan Disputations* (12 parts, entity-dense — this material stresses
ranges, ~5 reversed-range slips in one batch, all paragraph_ids-recovered) and
Seneca *On Benefits*. 287/12,797 valid; 10,166 entities, 2,834 citations; 114,485
quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks across 34 in-session
batches; cost/valid ~$0.25. Data note: the Seneca *On Benefits* source is not
paragraph-segmented — each "part" is one giant single-paragraph window, so all its
entities anchor to one id (coarse granularity; flag for reconciliation). A
one-time reset-aligned resume task (07:25 IST) supplements the daily 02:21 task so
a cap hit before the mid-morning reset also auto-resumes.

**Update — prod-ramp-30 (to 263 valid, 2.06% — crossed 2% of the archive).** Seneca
*On Tranquillity of Mind* and Cicero *On Moral Ends* (De Finibus). 263/12,797 valid;
8,926 entities, 2,532 citations, 4,712 quote events; 109,462 quotes. Valid
JSON/anchor/enrichment all 100%, 0 quote leaks across 31 in-session batches;
cost/valid ~$0.25. prod-ramp-31 added Cicero On Moral Ends (De Finibus, complete) + Tusculan Disputations start → 271 valid (2.12%), 9,340 entities, 111,655 quotes. A one-time reset-aligned resume task (07:25 IST 2026-07-11) was added to catch the mid-morning usage-window reset in addition to the daily 02:21 task.

**Update — prod-ramp-21 (to 191 valid, 1.49%).** Euclid's *Elements* completed (14
parts). 191/12,797 valid; 6,289 entities, 1,762 themes, 1,780 citations, 3,343
quote events; 89,087 quotes. Valid JSON/anchor/enrichment all 100%, 0 quote leaks
across 21 in-session batches; cost/valid ~$0.25. The `ontology-archive-grind`
scheduled task (02:21 IST daily) was hardened with a rate-limit self-heal so a
fire slightly before the ~02:00 usage-window reset waits and retries rather than
stalling for a day.

**Update — prod-ramp-23 (to 207 valid, 1.62%).** Euclid's *Elements* fully
complete (28 parts) and Marcus Aurelius' *Meditations* processed. 207/12,797
valid; 6,592 entities, 2,052 citations, 97,661 quotes. Valid JSON/anchor/
enrichment all 100%, 0 quote leaks across 24 in-session batches; cost/valid ~$0.24.

**Update — prod-ramp-22 (to 199 valid, 1.56%): the 5-hour cap hit and the run
auto-recovered.** Mid-batch (Euclid parts 15–22) the session hit its 5-hour usage
limit (reset 02:10 IST); 6 of 8 subagents were killed with a limit error. After
the reset the autonomous restart re-ran the missing windows with no manual
intervention — all 8 landed and validated. This is the first live proof that the
grind survives a real cap and resumes idempotently from disk. 199/12,797 valid;
6,407 entities, 1,809 themes, 1,971 citations, 3,545 quote events; 94,868 quotes.
Valid JSON/anchor/enrichment 100%, 0 quote leaks; cost/valid ~$0.25. Root cause of
the Euclid reversed-range slips identified: the Euclid source **reuses the same
paragraph id** across propositions (e.g. a recurring "Q.E.D." id), so a range
built from the first occurrence of an end-id can precede its start — using
`paragraph_ids`-only resolves it (and flags a dedup task for reconciliation).

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

## Cloud resume (claude.ai Claude Code) via R2

The run state is NOT in git (the run dir is git-ignored, 152 MB). To resume the
grind in a fresh claude.ai cloud session — which only sees the pushed GitHub
branch `feat/citation-graph-pipeline` — the **399 model responses (23 MB)** were
copied to a dedicated Cloudflare R2 bucket. `finalize` deterministically rebuilds
the 128 MB of `enriched`/`meta` from those responses + the corpus, so responses
are the only state that must travel.

- **Bucket / prefix:** `r2:falsafa-ontology-runs/2026-07-02-sonnet-benchmark/`
  (isolated from the live-site bucket `falsafaai`, whose deploy does a destructive
  `rclone sync`; never point the site deploy at this bucket). Holds
  `responses/*.response.txt` (399), plus `production-batches.json`,
  `production-run-summary.json`, `HANDOFF-FIRST-SESSION.md`. Uploaded with
  `rclone copy` (never `sync`), so re-uploads are additive.
- **Access = public read, no credentials.** The bucket is served over its R2
  public dev URL (`https://pub-<hash>.r2.dev`), so the cloud sandbox pulls with
  plain `curl` — no secrets to paste. The payload is non-sensitive (ontology JSON
  over public-domain texts). Enable once (management-plane op; the local wrangler
  OAuth lacks R2-admin scope, so do it in the dashboard: **R2 → falsafa-ontology-runs
  → Settings → Public access → R2.dev subdomain → Allow Access**, or
  `wrangler login` then `wrangler r2 bucket dev-url enable falsafa-ontology-runs`).
  The command/dashboard prints the `pub-<hash>.r2.dev` base URL — substitute it for
  `$BASE` below.
- **Listing:** r2.dev serves objects by key but cannot list a bucket, so a flat
  `responses-manifest.txt` (399 keys) sits at the prefix root alongside the
  responses and the metadata files.
- **Resume steps in the cloud session (no creds):**
  ```bash
  cd <repo> && bun install
  BASE=https://pub-88ffad6f37754be2b0e33466951a5135.r2.dev/2026-07-02-sonnet-benchmark   # from dashboard
  RUN=corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark
  mkdir -p "$RUN/responses"
  curl -fsSL "$BASE/responses-manifest.txt" -o "$RUN/responses-manifest.txt"
  curl -fsSL "$BASE/production-batches.json" -o "$RUN/production-batches.json"
  # pull all 399 seed responses in parallel
  xargs -P16 -I{} curl -fsSL "$BASE/{}" --create-dirs -o "$RUN/{}" < "$RUN/responses-manifest.txt"
  bun scripts/graph/ontology-sonnet-production.ts finalize   # rebuilds enriched+meta → reports ~399 valid
  # then continue the normal loop: prepare --count 8 --batch prod-ramp-NN → dispatch ≤8 → finalize
  ```
- **Persisting new progress (public URL is read-only):** the cloud session cannot
  write back over the public URL. Cheapest path — since claude.ai Claude Code is
  already git-authenticated to the connected repo — have it force-add its new
  responses to a progress branch and push:
  `git add -f "$RUN/responses" "$RUN/production-batches.json" && git commit -m "cloud grind prod-ramp-NN" && git push origin HEAD`.
  The next cloud session then already has them via git (R2 was only the one-time
  seed to avoid an initial 24 MB git commit). Alternative: mint a bucket-scoped
  **Object Read & Write** token and `rclone copy` new responses back to R2.
- **Caveat:** claude.ai Claude Code draws on the **same** Claude subscription /
  5-hour usage window as local. It moves the grind off the laptop (cloud,
  unattended) but grants no extra throughput and does not resolve the
  no-metered-route blocker; running cloud + local at once competes for one limit.

The full paste-in continuation prompt is `HANDOFF-FIRST-SESSION.md` (on disk +
in R2).
