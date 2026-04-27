# Overnight Eval Run — 2026-04-27 → 2026-04-28

User briefing: "Be rigorous about whatever you are going to do here. You can
work overnight and do all the evals... at least the baseline evals we will be
able to do."

This file is the operator's running checklist + state-of-the-night log.
Updated as work lands so the morning briefing writes itself.

## Scope (locked tonight)

- **In scope**: full 1,000-question pool × 1 driver (Falsafa MCP only). The
  baseline-Falsafa run that becomes the launch artifact's headline number.
- **In scope**: Sonnet judge against everything that runs.
- **In scope**: Eval Explorer FE scaffold at `apps/site/src/pages/eval/`
  (the locked spec in eng-review run-2 §1.3 + §2.4).
- **Out of scope tonight**: hybrid RAG comparison (needs `apps/baseline/`
  which doesn't exist yet — that's Phase 1 of launch plan, not Phase 0).
- **Out of scope tonight**: cross-model runs (Haiku × stratified, Opus ×
  stratified). Those need careful host-context budgeting; deferred.

## Phases

### Phase A — Harness builders (auto, in flight)
- [x] `judge-1000.ts` — Sonnet judge harness with codex/sub-agent drivers (LANDED, 658 lines)
- [ ] `run-1000-codex.ts` — codex CLI driver harness (in flight, background agent)

### Phase B — Smoke + commit harnesses
- [ ] Smoke-test both harnesses on 3 questions each
- [ ] Commit harnesses + runbooks

### Phase C — Full 1,000 codex eval (autonomous, overnight)
- [ ] Kick off `run-1000-codex.ts --concurrency 5 --resume`
- [ ] Background bash, no host context cost
- [ ] Estimated wall: 5–10 hours at 5-way parallelism (~30s/question)
- [ ] Output: `apps/mcp/eval/runs/1k-codex-<stamp>/` with 1,000 per-question JSONs

### Phase D — Sonnet judge on full 1,000 (autonomous, after C)
- [ ] Kick off `judge-1000.ts --driver codex` against the codex run
- [ ] Background bash
- [ ] Estimated wall: 3–6 hours at default parallelism
- [ ] Output: `_judge/q-*.json` + `_score-judge.json`

### Phase E — Eval Explorer FE scaffold (parallel with C/D)
- [ ] `apps/site/src/pages/eval/index.astro` — page shell
- [ ] `apps/site/src/islands/eval-explorer/` — Preact island, virtualized via `@tanstack/react-virtual`
- [ ] `eval/build-eval-json.ts` — bundles all run dirs into single static `eval.json` (~800KB gzipped target per eng review §2.4)
- [ ] `apps/site/public/eval.json` symlink or copy of the built artifact

### Phase F — Aggregate report + morning briefing
- [ ] `docs/eval-reports/2026-04-28-mcp-eval-1k-full-codex.md`
  - Headline numbers (mechanical + Sonnet judge)
  - Per-category breakdown
  - Per-difficulty breakdown
  - Failure-mode taxonomy (named issues)
- [ ] Update `_OVERNIGHT-PLAN.md` (this file) with final state
- [ ] Commit + push

## Known findings to investigate inline

From the 7-question pilot Sonnet judge:

1. **Fabricated paragraph_id pattern** (q-0626 + Haiku run's `iqbal-bang-1-1`,
   `manu-1-1`): the model invents `p-xxx` IDs when read_chapter doesn't make
   them prominent enough. Two fix candidates:
   - System-prompt level: "NEVER invent paragraph_ids. If you don't have one
     from a tool result, set paragraph_id: null."
   - MCP-side: surface paragraph_id markers more aggressively in chapter
     bodies returned by `read_chapter`.

2. **Verse-label-as-id pattern** (q-0951): the model used `Mn_1.52` (a verse
   marker visible in the markdown body) as the citation id instead of the
   actual `p-946051` hash. Quotes were verbatim, ids didn't resolve.

These should be fixed BEFORE the full 1,000 run if cheap, OR documented as
known issues if expensive.

## Context-budget guardrails

The host's main session has a finite context window. Rules for this run:

- **DO NOT** read the per-question stdout files of the 1,000 codex run (each
  is ~10-30KB; 1,000 × that = 30MB of context that would obliterate the
  session).
- **DO** poll progress via `ls | wc -l` and `_summary.json` aggregates only.
- **DO NOT** dispatch sub-agents in foreground for batches > 5. Codex is the
  primary driver tonight; sub-agents are reserved for the FE scaffold and
  per-finding investigations.
- **DO** commit after every phase so progress survives if context fills.

## Timeline (best estimate)

| Time | Phase | Notes |
|------|-------|-------|
| T+0   | A done — judge harness landed | actual |
| T+0:15 | A done — codex harness landed | (waiting) |
| T+0:30 | B done — both smoke-tested | |
| T+0:45 | C started — 1k codex run kicked | overnight |
| T+0:45 → T+8 | E in parallel — FE scaffold | |
| T+5–8 | C done — 1k codex run lands | |
| T+8 | D started — judge run | |
| T+11–14 | D done — judge results | |
| T+14 | F — aggregate + briefing | morning |

## Live state (updated as work lands)

- 2026-04-27 23:50 — pilot landed, judge run, report committed (`7a2e98c`)
- 2026-04-27 23:55 — overnight plan committed
- 2026-04-28 00:30 — codex CLI rate limit hit (until Apr 29 8:06 PM)
- 2026-04-28 00:35 — judge harness stdin bug found + fixed (`d7681c9`)
- 2026-04-28 00:50 — wave 1 dispatched (10 sub-agents, native MCP)
- 2026-04-28 01:30 — q-0626/q-0951 product findings investigated + queued in TODOS (`94ebb3f`)
- 2026-04-28 02:00 — wave 1 9/10 results in, all 9 mechanical pass
- 2026-04-28 02:10 — final commit + briefing (`f012fbe`)
- 2026-04-28 02:15 — FE scaffold agent still running in background (only `types.ts` written so far)

## Final tonight state

- ✅ Phase A (harnesses): both built + smoke-tested
- ❌ Phase B (smoke + commit): committed but codex rate-limited
- ❌ Phase C (full 1000 codex): BLOCKED until Apr 29 8:06 PM
- ❌ Phase D (judge full 1000): blocked behind C
- ⏳ Phase E (FE scaffold): in progress, partial (types.ts only)
- ✅ Phase F (briefing): committed at `_MORNING-BRIEFING.md`

**Combined pass rate across both runs (mechanical):** 15/16 = **94%**.
**Pilot Sonnet judge:** 6/7 = **89% pts**, 5/7 perfect.

**One MCP fix needed before kicking off full 1000:** paragraph_id
surfacing in `read_chapter` body output. Spec in TODOS.md.
