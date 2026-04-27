---
status: ACTIVE
---

# 1,000-Question MCP Eval — Runbook

The protocol is **already locked** by:
- `docs/eng-review-test-plan.md` §"MCP Black-Box Eval Suite" (lines 92–126)
- The Haiku run at `docs/eval-reports/2026-04-27-mcp-eval-haiku-blind-subagents.md`
- gstack saved review `siraj-feat-chapter-splitting-eng-review-run2-20260427-160000.md` §2.1, §2.4

This file is the **execution checklist** for running the protocol against
the 1,000-question pool at `eval/questions-revised-1000.json`. Output goes
to the Eval Explorer at `falsafa.ai/eval` and the arXiv preprint.

## What "the protocol" actually is

A fresh LLM session with **only the Falsafa MCP attached** — same install
path any user follows (`@falsafa/mcp` in Claude Desktop / Cursor / Claude
Code / codex CLI). No codebase access, no priors. Pose a question. Capture
the tool trace + final answer. Score with a Sonnet judge that resolves
every cited paragraph_id against the actual corpus.

The CLI-wrapper hack at `apps/mcp/eval/mcp-cli.ts` was a wrong abstraction.
A sub-agent IS a decoupled session — it inherits the user's MCP config
from `~/.claude.json` and calls `mcp__falsafa__*` tools natively. We use
that, not the wrapper.

## Drivers (no API spend)

All four use the same MCP server, attached natively to a fresh session.

| Driver | Model family | MCP install path |
|---|---|---|
| Claude Code sub-agent (sonnet) | Claude Sonnet 4.6 | `~/.claude.json` mcpServers.falsafa (already installed) |
| Claude Code sub-agent (haiku) | Claude Haiku 4.5 | (same — config is global) |
| Claude Code sub-agent (opus) | Claude Opus 4.5 | (same) |
| codex CLI | GPT-5-class | `~/.codex/config.toml` `[mcp_servers.falsafa]` (TODO: install) |

## Storage layout

```
apps/mcp/eval/runs/1k-{stamp}-{driver}-{model}/
├── _manifest.json   # driver, model, sample, git SHA, start/end
├── _sample.json     # the questions that ran (with ground truth — for re-scoring)
├── {q-id}.json      # {answer, tool_calls, citations, duration_ms}
├── _score-mechanical.json   # expected_works overlap (deterministic)
├── _score-judge.json        # Sonnet judge with citation resolution
├── _summary.md             # paper-ready table per category
└── _failures/{q-id}.md
```

## Phasing

| Phase | Scope | Drivers | Wall time | Purpose |
|---|---|---|---|---|
| 0 — Pilot | 7 Q stratified (1 per category) | Sonnet sub-agent | ~10 min | Validate native-MCP prompt + scoring |
| 1 — Cross-model | 50 Q stratified | Sonnet + Haiku + Opus + codex | ~2 hrs (batched) | Cross-model comparison table for paper |
| 2 — Full × codex | 1000 Q | codex (background bash) | overnight | Launch baseline, no host context cost |
| 3 — Full × Sonnet | 1000 Q | Sonnet sub-agent | ~3 days incremental | Second flagship column for the explorer |

## Why these drivers, this order

**Codex CLI gets the full 1000 first** because it runs as background bash
— results land directly on disk, zero host context cost. Sub-agent runs
return ~10–30K tokens to my session per dispatch; 1000 of those would
overflow my context window twice over.

**Sonnet sub-agent gets the full 1000 second** because the existing Haiku
report establishes the per-question artifact format and Sonnet vs Haiku
is a useful within-Claude comparison.

**Haiku and Opus get stratified 50 each** — enough to compare, not enough
to overwhelm the host context.

## Anti-cheat

The agent prompt MUST NOT contain `expected_works`, `rationale`, `quality`,
or any path to the question file or prior results. The existing
`buildSubagentPrompt()` strips these but is built for the CLI-wrapper era
— **needs a sibling `buildNativeMcpPrompt()` that drops the Bash/CLI
guidance and just says "use the falsafa MCP tools."**

Verification: spot-check 5 random `_sample.json` entries vs the prompt
they generated. Record this in `_manifest.json`.

## What's missing — build before Phase 1

1. **`buildNativeMcpPrompt(case, runId)`** in `run-subagent-evals.ts` — writes a
   prompt that assumes `mcp__falsafa__*` tools are attached, drops the
   `bun run apps/mcp/eval/mcp-cli.ts` Bash guidance.
2. **`apps/mcp/eval/run-1000.ts`** — driver harness:
   - CLI: `--input`, `--out`, `--driver={subagent|codex}`, `--model`,
     `--sample N`, `--stratified N`, `--filter category=...`, `--resume`,
     `--concurrency N`
3. **`apps/mcp/eval/score-1000.ts`** — mechanical scorer for the
   `expected_works`-only schema.
4. **`apps/mcp/eval/judge-1000.ts`** — judge that resolves citations
   against the corpus (mirrors the existing Haiku-run judge pattern).
5. **codex MCP config** in `~/.codex/config.toml`.

## Codex sandbox writes

The 4-question codex run was sandboxed away from writing
`apps/mcp/eval/runs/`. Two options:
- Pass `-c sandbox_workspace_write.allowed_paths='["apps/mcp/eval/runs"]'`
- Capture stdout, post-extract JSON (proven, see
  `apps/mcp/eval/runs/multi-model-20260427-230126/codex/`)

Use the capture path. It's already proven and the stdout is also a paper
artifact (full transcript per question).

## Paper integration

Same format as `docs/eval-reports/2026-04-27-mcp-eval-haiku-blind-subagents.md`:

- Headline numbers (substring + Sonnet judge)
- Per-category table
- "What changed" prose if a redesign happened
- Failure analysis with named issues

Each phase writes its own dated report under `docs/eval-reports/`.

## Approvals to start

- [x] Phase 0 — pilot, today (executing now)
- [ ] Phase 1 — after pilot validates the native-MCP prompt
- [ ] Phase 2 — after operator confirms codex sandbox capture path
- [ ] Phase 3 — incremental, runs alongside other launch work
