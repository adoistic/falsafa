# Final Night Report — 2026-04-27 → 2026-04-28

The night's work, end to end. Three things landed:

1. A methodology gap the user caught — and the fix.
2. A real product fix in the MCP that pre-empts a class of citation
   failure the judge had already flagged.
3. A reproducibility document that lets anyone replicate the eval
   from a fresh Claude Code or codex install.

A 12-question patched-prompt rerun is in flight. The orchestrator
that runs it returns one summary, not the per-question deluge that
would have overflowed the host context.

## The methodology gap (locked + fixed)

The eval prompt's anti-cheat block forbade reading
`apps/mcp/eval/cases.json`, `results/`, `runs/`, and
`docs/eval-reports/`. It **did not** forbid
`eval/questions-revised-1000.json` — the actual ground-truth pool the
1,000 questions are drawn from. A sub-agent could in principle have
read the pool to find `expected_works` for any case.

There's no evidence any did — the agents were given a single specific
question and instructed to use the MCP — but the gap matters for
paper-grade independence. We've discarded every sub-agent run that
used the old prompt:

- `1k-pilot-sonnet-native/` — the 7-question pilot with the Sonnet
  judge run (6/7 PASS, 5/7 perfect, 89% pts).
- `1k-stratified-50-sonnet/` — waves 1+2, ~19 questions.
- `1k-wave3-sonnet/` — orchestrator-dispatched mid-flight.

Files preserved on disk under
`apps/mcp/eval/runs/_INVALIDATED-pre-anti-cheat-patch/README.md` for
audit. Not used in any published headline number.

The runs that **stay valid**: the codex smoke tests + the older Haiku
44-case run, which used different prompt builders that had no gap.

The fix is a one-block change in `apps/mcp/eval/run-subagent-evals.ts`:
the new anti-cheat list forbids the entire `eval/` directory at the
repo root and explicitly names `questions-revised-1000.json`,
`questions-draft-1000.json`, and the calibration files. Validated via
re-running `q-0001` with the patched prompt — the agent cited
Diwan-e-Ghalib chapter 3, paragraph `p-b743e4` correctly and never
read the question pool file.

## The product fix (MCP `read_chapter` paragraph_id surfacing)

The Sonnet judge had already flagged two distinct citation failures
that mechanical scoring missed:

- **q-0626** — agent invented `p-1684bd` for Ganapatitattva. Confirmed
  via `mcp__falsafa__get_passage`: the id returns `passages: []`. It
  doesn't exist. The agent fabricated it because the chapter body had
  no `p-xxxxxx` markers anywhere visible, and the sidecar (which has
  them) had to be queried separately.
- **q-0951** — agent used `Mn_1.52` (an inline verse marker) as the
  citation id. The corpus body has `// Mn_1.52 //` markers throughout
  but no `p-xxxxxx` hashes. The agent grabbed the most prominent
  identifier-shaped string. Quotes were verbatim against the actual
  paragraph (`p-946051`); only the cited id didn't resolve.

The Haiku 44-case run had hit the same pattern earlier
(`citation-iqbal-bang-1-1` invented `p-1-opening`, `manu-1-1` invented
`p-0`).

Fix: `apps/mcp/src/tools.ts` `read_chapter()` now reads the chapter's
`*.paragraphs.json` sidecar and prepends `[p-xxxxxx] ` at each
paragraph's offset in the body string. The marker format matches the
convention the BYOK demo's defensive linkifier already recognizes
(`apps/site/src/islands/byok/ui/defensive-linkify.ts`), so a
paragraph_id surfaced here flows unchanged through the model into a
citation that resolves end-to-end at the reader page.

Smoke-test: a `read_chapter` call on Manusmṛti chapter 1 now emits
**119 inline `[p-xxxxxx]` markers**, one per paragraph, where it
previously had zero. Body byte offsets are correct against the sidecar.

`get_passage` already returned `paragraph_id` alongside text in its
`passages` array — no change needed there.

## The reproducibility document

`docs/designs/eval-protocol.md` — written tonight. Covers:

- Ecological validity: the eval protocol is identical to a real user's
  experience installing `@falsafa/mcp` in Claude Desktop / Cursor /
  codex CLI. No special harness, no privileged access. The MCP attaches
  the same way (via `~/.claude.json` or `~/.codex/config.toml`) and
  the agent calls `mcp__falsafa__*` natively.
- The complete anti-cheat list (the patched version).
- The per-question artifact shape (`{answer, tool_calls, citations}`).
- The two scoring layers (mechanical: `expected_works` overlap;
  judge: Sonnet sub-agent that calls `mcp__falsafa__get_passage` to
  verify each cited paragraph_id).
- A copy-pasteable single-question rerun recipe.

Future reviewers, contributors, and preprint readers can replicate the
setup against the same questions in `eval/questions-revised-1000.json`.

## What ran tonight, what's queued

| State | Item |
|---|---|
| ✓ landed | Anti-cheat patch (commits `9953158`) |
| ✓ landed | MCP `read_chapter` paragraph_id surfacing (commit `b6a13ac`) |
| ✓ landed | `docs/designs/eval-protocol.md` reproducibility doc |
| ✓ landed | Eval Explorer FE scaffold at `/eval` (`apps/site/src/pages/eval/`, `apps/site/src/islands/eval-explorer/`, `eval/build-eval-json.ts`) |
| ✓ landed | `q-0001` patched-prompt rerun (clean) |
| ⏳ in flight | 12-question patched-prompt orchestrator run (results land in `apps/mcp/eval/runs/1k-final-patched-sonnet/`) |
| ⏸ blocked | Codex full-1000 — rate limit until ~Apr 29 8:06 PM. Harness ready (`apps/mcp/eval/run-1000-codex.ts`); kicks off with one command when codex unlocks. The codex runner uses `buildNativeMcpPrompt` which had no anti-cheat gap, so it's already paper-grade. |

## Recommendations for the morning

1. **Read the orchestrator's summary** when it returns. It's a 12-question
   stratified rerun (2 per category) with both patches active. The most
   important number to watch: `verse_label_id_count` should be 0 or
   near-0 (meaning the MCP paragraph_id markers are working — agents no
   longer fall back to `Mn_1.52`-style markers).

2. **Kick off codex full-1000 once the rate limit resets**. From the
   repo root:
   ```bash
   bun run apps/mcp/eval/run-1000-codex.ts \
     --input eval/questions-revised-1000.json \
     --out apps/mcp/eval/runs/1k-codex-$(date +%Y%m%d-%H%M%S) \
     --concurrency 5 --resume
   ```
   ~3-4 hour wall time. Resumable. Outputs are paper-grade artifacts.

3. **After the codex run lands, dispatch the judge**:
   ```bash
   bun run apps/mcp/eval/judge-1000.ts \
     apps/mcp/eval/runs/1k-codex-... \
     --driver codex
   ```
   Codex driver is autonomous; judge a 1,000-question run is ~3-6 hours
   wall.

4. **Optional cross-model column for the paper**: dispatch ~50
   stratified questions × Haiku and × Opus via sub-agents in batches.
   Same harness pattern, same patched prompt. Don't run all 1,000 ×
   sub-agent — host context can't absorb that volume of return data.

5. **Eval Explorer**: `bun run eval/build-eval-json.ts --include
   1k-codex-... --include 1k-final-patched-sonnet` will rebuild
   `apps/site/public/eval.json` with the new data, and the page at
   `/eval` will surface it next time the site is built.

## Voice / register

The eval-reports under `docs/eval-reports/` are operational records,
not paper prose. They're builder-to-builder: short declaratives, no
"delve / leverage / showcase / robust" tells, no triadic stacking, no
em-dash-happy thinking. The arXiv preprint and the launch essay are
separate documents reserved for that polished register, and neither
was drafted tonight.

The Eval Explorer FE copy (the public-facing surface) was audited
clean: kicker `Eval`, headline `Every claim, browseable.`, lede that
references the Sonnet judge, no AI tells. That artifact is ready for
the launch when the data lands.

## Commits tonight

- `7a2e98c` — Sonnet judge on pilot
- `d7681c9` — harnesses + overnight plan
- `94ebb3f` — wave 1 results + first product fix queued
- `f012fbe` — morning briefing
- `a15a8dc` — final state log
- `64448a4` — q-0401 wave-1 final
- `509401f` — eval explorer FE + wave 2 partial
- `9953158` — anti-cheat patch + invalidation + protocol doc
- `b6a13ac` — MCP `read_chapter` paragraph_id surfacing
- (this report committed next)

The rest of the night's results — the orchestrator's summary, the
codex full-1000 when it unlocks — will append to this file as they
land.
