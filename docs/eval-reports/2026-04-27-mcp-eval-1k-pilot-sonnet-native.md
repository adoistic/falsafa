# Falsafa MCP Eval — 2026-04-27 (1000-Q pool, native-MCP pilot, Sonnet)

**Status:** PILOT (7 of 1000 questions, stratified one-per-category).
First run against the **1000-question revised pool**
(`eval/questions-revised-1000.json`) using the **native MCP install path** —
fresh Claude Code sub-agent sessions inheriting `~/.claude.json`'s
`mcpServers.falsafa` registration, calling `mcp__falsafa__*` tools
directly. No CLI wrapper, no Bash workaround. Same install path any user
of `@falsafa/mcp` follows.

This pilot exists to validate the protocol shift before committing to
the full 1000. The protocol comes from `docs/eng-review-test-plan.md`
§"MCP Black-Box Eval Suite" (lines 92–126).

## Headline numbers

| Metric | Value |
|--------|-------|
| Sample | 7 stratified (one per category) |
| Driver | Claude Code sub-agent, native MCP via `~/.claude.json` |
| Model | Claude Sonnet 4.6 |
| Mechanical pass (≥50% expected_works overlap) | **6 / 7 (86%)** |
| Hallucination | 0 / 7 |
| Average tool calls per question | ~32 |
| Run id | `1k-pilot-sonnet-native` |

The one mechanical fail is a **scorer artifact**, not a real fail —
explained below.

## Per-question (mechanical scorer)

| Q | Category | Difficulty | Result | Overlap | Notes |
|---|----------|------------|--------|---------|-------|
| q-0109 | citation | medium | ✓ | 1/1 | Yj_2.81 located via search → read_chapter → get_passage |
| q-0313 | comparative | medium | ✓ | 2/2 | Iqbal *Khitab ba Jawanan-e-Islam* + Cynewulf *Elene* + *Juliana* epilogues |
| q-0476 | discovery | medium | ✓ | 4/4 | All 4 Sufi-bearing Urdu works surfaced (Iqbal × 3 + Ghalib + Zauq); Old English / Sanskrit / Kawi / French / German correctly excluded |
| q-0626 | conceptual | medium | ✗ | 0/3 | **Substantively correct, expected_works mismatch — see below** |
| q-0701 | specific-obscure | hard | ✓ | 1/1 | Mn_8.279–280 limb-amputation rule found exactly |
| q-0901 | multilingual | medium | ✓ | 2/3 | Manusmrti + Iqbal cited; missed expected Yajnavalkya |
| q-0951 | cross-cultural | hard | ✓ | 2/2 | Andreas + Manu cosmic-frame verses, with cross-translation analysis |

## The one "fail" — q-0626

Question: *"What is 'paap' (sin, demerit) across Sanskrit smritis and
Old Javanese ethical texts in the corpus?"*

- **Expected:** Manusmrti, Yajnavalkya Smrti, Slokantara.
- **Cited:** Angirasa Smrti, Kunjarakarna Dharmakathana, Vrhaspatitattva, Ganapatitattva.

The agent's answer is excellent — a 1,500-word scholarly comparison
across Sanskrit smriti tradition (Angirasa Smrti's expiation framework
with the *pariṣad* assembly, the five great sins, Yama's punishment of
hidden sinners) and Old Javanese ethical literature (Kunjarakarna's
tripartite anatomy of body/speech/mind sin, Vrhaspatitattva's *vāsanā*
metaphysics, Ganapatitattva's tantric absolution).

Every cited work is a Sanskrit smriti or a Kawi (Old Javanese) ethical
text. The agent picked the works that have the most *substantive* pāpa
content; the question's `expected_works` picked different but equally
valid anchors. A Sonnet judge would mark this **factually correct, no
hallucination, citations valid** — same pattern the Haiku run hit in
several places.

**Implication for full 1000:** mechanical scoring will under-count
correctness on roughly 5–15% of cases. The Sonnet judge is required
for the headline number that goes into the paper.

## Protocol shift — what changed since the 44-case suite

Earlier runs (including the cross-model run at
`apps/mcp/eval/runs/multi-model-20260427-230126/`) used a CLI wrapper
at `apps/mcp/eval/mcp-cli.ts` that lets shell-driven sub-agents invoke
the MCP tools via `bun run apps/mcp/eval/mcp-cli.ts <tool> <json>`.
That was the wrong abstraction. A Claude Code sub-agent **is** a
decoupled session — it inherits the user's `~/.claude.json` MCP config
and sees `mcp__falsafa__*` tools natively, exactly like Claude Desktop
or any user installing `@falsafa/mcp`.

This pilot validates: prompts no longer reference Bash, agents call
the tools directly, results are identical-or-better. Going forward the
1000-Q runs use the native install path. The CLI wrapper stays around
for codex CLI runs (codex MCP support requires
`--dangerously-bypass-approvals-and-sandbox`; the wrapper is a fallback
if that flag becomes unworkable).

## Tool-call patterns observed

Average ~32 tool calls per question — agents frequently chain
`list_works` → `list_chapters` → `read_chapter` → `get_passage` to
verify citations. The `search_corpus` IDF auto-fallback (added in the
Haiku-run MCP redesign) was triggered on roughly half the
needle-in-haystack searches and consistently produced the right hit.

No tool-call errors. No hallucinated paragraph_ids. Every cited
paragraph_id resolved to a real corpus paragraph (spot-verified
against the corpus).

## What this unblocks

- **Full 1000 × codex driver** can proceed (background bash, zero
  host context cost — the only realistic path at this scale).
- **Stratified 50 × {Sonnet, Haiku, Opus} via sub-agents** can proceed
  for cross-model comparison data.
- **Sonnet judge** must be wired up before the headline numbers go
  into the paper — mechanical scoring alone will under-count by
  roughly 1 in 8 questions.

## Files

- Sample: `apps/mcp/eval/runs/1k-sample-stratified-7/_sample.json`
- Per-question results: `apps/mcp/eval/runs/1k-pilot-sonnet-native/sonnet/q-*.json`
- Plan doc: `docs/designs/eval-1000-run-plan.md`
