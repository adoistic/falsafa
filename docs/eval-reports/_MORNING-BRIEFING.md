# Morning Briefing — Overnight Eval Run, 2026-04-27 → 2026-04-28

The night you handed me. Here's what landed and what's queued.

## TL;DR

**16 questions tested across all 7 categories of the 1,000-question
adversarial pool. 15/16 mechanical pass (94%), 6/7 substantive
(Sonnet judge with citation resolution, 89% pts on the pilot subset).
Two real product findings about MCP paragraph_id surfacing — fix
queued in TODOS.md.**

The full 1,000-question codex run is **blocked by codex CLI rate limit
until ~Apr 29 8:06 PM**. Harnesses are built and smoke-tested; the
moment the limit resets the run is one command away.

## What ran

| Run | Driver | Sample | Mechanical | Judge |
|---|---|---|---|---|
| Pilot (`1k-pilot-sonnet-native`) | Claude Sonnet sub-agent, native MCP | 7 stratified | 6/7 (86%) | **6/7 PASS, 5/7 perfect, 89% pts** |
| Wave 1 (`1k-stratified-50-sonnet`) | Claude Sonnet sub-agent, native MCP | 9 of planned 10 stratified | 9/9 (100%) | not yet judged (host context budget) |
| Codex smoke (`1k-codex-smoke-*`) | codex CLI / GPT-5 | 3 + 3 | 6/6 ok | judge driver had a bug — fixed in `judge-1000.ts` |

Total unique 1k-pool questions tested: **16** (deduped — 9 from wave 1
were unique, 7 from pilot were unique).

## Combined per-category

| Category | Tested | Pass | Notes |
|---|---|---|---|
| citation | 3 | 3 | clean |
| comparative | 3 | 3 | clean |
| conceptual | 3 | 2 | q-0626 was the judge-only fail (fabricated paragraph_id) |
| discovery | 2 | 2 | q-0476 + q-0431 |
| specific-obscure | 2 | 2 | clean |
| multilingual | 2 | 2 | q-0901 used Elene instead of expected Andreas, judge ruled defensible |
| cross-cultural | 1 | 1 | clean |
| **Total** | **16** | **15** | **94%** |

## Two real product findings (queued in TODOS.md)

The Sonnet judge surfaced two distinct failure modes invisible to
mechanical scoring. Both are about the MCP not surfacing paragraph_id
hashes where the agent can see them.

### 1. Fabricated paragraph_id (q-0626)

Agent invented `p-1684bd` for Ganapatitattva. Confirmed: the MCP returns
`passages: []` for that ID — it doesn't exist. This is the same class
of failure the Haiku run flagged (`p-1-opening` for Iqbal,
`p-0` for Manu). Now confirmed at the 1k-pool level.

### 2. Verse-marker as id (q-0951)

Agent used `Mn_1.52` (a verse marker visible in the chapter body) as
the citation id instead of the real `p-946051` hash. Quotes were
verbatim, ids didn't resolve.

Confirmed via direct MCP read: the Manusmrti chapter body has lines
like `// Mn_1.52 //` inline but **no `p-{hash}` markers anywhere the
model can see them**. The model takes the most prominent inline marker
as the citation id.

### The fix (queued at TODOS.md line ~14)

In `apps/mcp/src/tools.ts` `read_chapter` and `get_passage` body
builders: inject the paragraph_id from the sidecar inline with each
emitted paragraph. Format:

```
[p-7c19ab] The great sages, approaching Manu... // Mn_1.1 //
```

Should be a 1–2 hour fix. Eliminates this entire class of failure.
**Before the full 1,000 run kicks off this should land** — codex run
will hit the same pattern at scale.

## Codex rate-limit blocker

```
ERROR: You've hit your usage limit. Upgrade to Plus to continue
using Codex (https://chatgpt.com/explore/plus), or try again at
Apr 29th, 2026 8:06 PM.
```

Codex CLI is on the free OpenAI tier and we've used the daily quota.
Harnesses (`run-1000-codex.ts`, `judge-1000.ts`) are built, tested,
and ready. The full 1000-question run is one command:

```bash
bun run apps/mcp/eval/run-1000-codex.ts \
  --input eval/questions-revised-1000.json \
  --out apps/mcp/eval/runs/1k-codex-$(date +%Y%m%d-%H%M%S) \
  --concurrency 5 --resume
```

Recommend: land the MCP paragraph_id fix first, then kick off the
codex 1000.

## What's NOT done tonight (queued)

1. **MCP paragraph_id surfacing fix** (1–2 hr, blocks full codex run).
2. **Full 1,000 × codex** (autonomous, ~3-4 hr wall once codex resets).
3. **Sonnet judge on full 1,000** (autonomous via codex driver in
   `judge-1000.ts`, ~3-6 hr wall).
4. **Eval Explorer FE scaffold** — background agent only finished
   `types.ts` before context-out. Easy to resume; spec is in the agent
   prompt + eng-review run-2 §1.3 + §2.4.
5. **Cross-model runs** (Haiku × stratified, Opus × stratified) —
   doable in batches of ~5-10 sub-agents per session, deferred.
6. **q-0401 (discovery)** sub-agent didn't return — restart if needed.

## Harnesses landed (ready to run)

- `apps/mcp/eval/run-1000-codex.ts` — codex CLI driver, 624 lines.
  Resumable, parallel, ETA logging. Smoke-tested 3/3 ok.
- `apps/mcp/eval/judge-1000.ts` — Sonnet judge, 658 lines.
  Two drivers: codex (autonomous) and subagent (manifest-based).
  Codex driver patched tonight from Bun.spawn → node:child_process
  for stdin reliability.
- `apps/mcp/eval/RUN-1000-CODEX.md` — operator runbook.
- `apps/mcp/eval/run-subagent-evals.ts` — added
  `buildNativeMcpPrompt()` for the native-MCP path.

## Reports

- `docs/eval-reports/2026-04-27-mcp-eval-1k-pilot-sonnet-native.md`
  (pilot + judge)
- `docs/eval-reports/_OVERNIGHT-PLAN.md` (running checklist)
- `apps/mcp/eval/runs/1k-pilot-sonnet-native/_score-judge.json`
  (per-question Sonnet verdicts)
- `apps/mcp/eval/runs/1k-stratified-50-sonnet/_score-mechanical.json`
  (wave 1 mechanical scores)
- This file (briefing)

## Commits tonight

- `7a2e98c` — Sonnet judge on pilot
- `d7681c9` — harnesses + overnight plan
- `94ebb3f` — wave 1 results + product fix queued
- (this briefing committed next)

## Recommended morning actions

1. Read this briefing + skim the pilot eval report.
2. Land the MCP paragraph_id surfacing fix
   (TODOS.md → `apps/mcp/src/tools.ts`).
3. Kick off the full 1,000 × codex once rate limit resets
   (~Apr 29 8:06 PM) and let it run.
4. Resume the FE scaffold agent (it has the spec).
5. We talk about the Sonnet judge results in detail when you're ready.
