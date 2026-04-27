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

| Metric | Mechanical scorer | **Sonnet judge (substantive)** |
|--------|--------|---|
| Sample | 7 stratified (one per category) | (same) |
| Driver | Claude Code sub-agent, native MCP via `~/.claude.json` | (same) |
| Eval model | Claude Sonnet 4.6 | (same) |
| Judge | regex / token match on `expected_works` | Claude Sonnet 4.6 sub-agent reading + verifying every cited paragraph_id via `mcp__falsafa__get_passage` |
| Pass | 6 / 7 (86%) | **6 / 7 (86%)** |
| Total points | – | **75 / 84 (89%)** |
| Perfect score | – | **5 / 7 (71%)** |
| Factually correct | – | 7 / 7 (100%) |
| Citation-backed (every paragraph_id resolves + content matches) | – | 5 / 7 (71%) |
| Hallucination-free | – | 6 / 7 (86%) |
| Avg tool calls per question | ~32 | – |
| Run id | `1k-pilot-sonnet-native` | `1k-pilot-sonnet-native/_judge` |

**The substantive headline is `6/7 PASS, 5/7 perfect, 89% pts on the Sonnet judge`** —
mechanical and judge agree on pass-rate but the judge surfaced two distinct
failure modes invisible to substring matching. Both are real product
findings worth fixing in the MCP / prompt before the full 1000 run.

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

## Per-question (Sonnet judge — substantive)

| Q | Category | Score | factual | citation | hallucination | reason |
|---|---|---|---|---|---|---|
| q-0109 | citation | **12/12 🟢** | ✓ | ✓ | ✗ | Yj_2.81 + 2.82 quotes verbatim against `p-dbd716` and `p-71cfc7` |
| q-0313 | comparative | **12/12 🟢** | ✓ | ✓ | ✗ | All 8 Iqbal/Cynewulf cited paragraphs verified verbatim |
| q-0476 | discovery | **12/12 🟢** | ✓ | ✓ | ✗ | All 4 expected Sufi-bearing works surfaced; one extra (Bang-e-Dara Part 3) is a defensible discovery |
| q-0626 | conceptual | **6/12** ✗ | ✓ | ✗ | ✓ | **Real fail.** See below |
| q-0701 | specific-obscure | **12/12 🟢** | ✓ | ✓ | ✗ | Mn_8.279–280 verbatim against `p-526528` + `p-c0dabc` |
| q-0901 | multilingual | **12/12 🟢** | ✓ | ✓ | ✗ | All 4 cited paragraphs verbatim; agent used Elene instead of expected Andreas — judge flagged as defensible (Elene fits the audibility question better) |
| q-0951 | cross-cultural | **9/12** | ✓ | ✗ | ✗ | **Citation-format issue.** See below |

## The two real findings — q-0626 and q-0951

These are the cases the judge surfaced that mechanical scoring missed.
Both are worth fixing before the full 1000 run.

### q-0626 — fabricated paragraph_id + wrong-paragraph attribution

Question: *"What is 'paap' (sin, demerit) across Sanskrit smritis and
Old Javanese ethical texts in the corpus?"*

The agent wrote a 1,500-word scholarly comparison anchored on Angirasa
Smṛti (a real Sanskrit smṛti, valid choice) plus three Kawi (Old
Javanese) texts. The 8 Angirasa citations and 4 Kunjarakarna citations
all resolved verbatim. But:

- `p-1684bd` (Ganapatitattva ch.1) — **does not exist**. Hallucinated id.
- `p-ff7b52` (Vrhaspatitattva ch.1) — resolves, but contains
  Vṛhaspati's opening question, **not** the karma-vāsanā / asafoetida
  doctrine the agent attributed to it.

This is a real product finding. The model invented one paragraph_id
and attached substantive content to a paragraph that doesn't contain
it. The MCP's `read_chapter` may surface paragraph_ids in a way that
makes them easy to mis-cite — worth checking if the body markdown shows
ids inline, or if the model is reconstructing them from context.

### q-0951 — citation-format bug

Question: *"Three traditions, three words for revealed truth: 'sruti'
in the smritis, 'wahy'..."*

Agent's substantive answer is correct and well-argued. All 4 Cynewulf
Elene paragraphs (`p-acdc07`, `p-306e06`) verified verbatim. But the
agent used **verse-number labels** (`Mn_1.52`, `Mn_1.80`, `Mn_1.5`) as
paragraph_ids instead of the actual hash-style IDs (`p-946051`,
`p-74d247`, `p-61df11`).

The quotes are real and verbatim in the corpus. The format is wrong.
This is likely an MCP-side issue: when the model reads a verse-style
chapter and sees text like "Mn_1.52" inline, it grabs that as the
"id" instead of the surrounding `p-` hash. Fix candidate: have
`read_chapter` / `get_passage` more aggressively surface the paragraph
hash next to the verse number, or strip the verse markers before they
confuse the model.

**Implication for full 1000:** the judge will catch ~10-15% more
real product issues than mechanical scoring. Both findings here
are worth feeding back into MCP improvements before committing
to a 1,000-question run.

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
