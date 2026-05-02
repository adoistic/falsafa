# Eval Scoring Rework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary loose/strict eval scoring with a tiered four-metric system (loose / graded-fractional / strict-raw / strict-audited) across a 9-arm cross-lab matrix, with per-citation provenance fixed at the runner schema.

**Architecture:** Sequential chunks. The runner schema fix (Chunk 1) gates everything because strict scoring requires reliable per-citation attribution. Aggregation (Chunk 2) consumes the new schema. The site rebuild (Chunk 3) consumes split per-arm files. Audit pass + matrix runs (Chunk 4) come last. Tests gate each chunk.

**Tech Stack:** Bun (build), TypeScript, Astro 5, Preact (eval-explorer island), Node.js child_process (claude-cli runner), `@modelcontextprotocol/sdk` (corpus access), Pagefind (site search). Existing patterns: atomic `.tmp + rename` for resumable per-question writes, structured logs to stderr, Vercel auto-deploy from `main`.

**Spec:** `~/.gstack/projects/falsafa/ceo-plans/2026-05-01-eval-scoring-rework.md` (1,016 lines, reviewed 4 times: CEO 9/10 + Design 5→8/10 + Eng HOLD-SCOPE clean + 2 codex outside-voice runs).

**Tier matrix (locked):**
| Tier | Arms | Purpose |
|---|---|---|
| Headline (5 wiki arms) | Grok wiki, Sonnet via @falsafa/mcp, Haiku via @falsafa/mcp, Gemini Flash Lite, gpt-5-nano | Cross-provider headline |
| Methodology (4 counterfactual arms) | Grok baseline, Grok strict-prompt, Sonnet baseline, Haiku baseline | Wiki + prompt-discipline contributions |

**Total marginal cost:** ~$26 (Sonnet/Haiku via Anthropic Max plan = $0 marginal).

**Site IA (locked):**
- `/eval/` — leaderboard (5 wiki arms, ranked, filter chips by lab/tier/search)
- `/eval/compare` — multi-select 2-4 arm deep-dive (preserves today's flips-pass/flips-fail/both-pass/both-fail filter as 2-arm special case)
- `/eval/methodology` — counterfactual sub-sections (wiki contribution, strict-prompt, audit overlay)
- `/eval/<case-id>` — per-case detail across all arms

**Visual reference:** `~/.gstack/projects/falsafa/designs/eval-multiarm-scoreboard-20260501/variant-B.png` (caveats applied: column headers = MODEL+TREATMENT, not lab/company; existing functionality preserved additively).

---

## Pre-flight knowledge for the implementer

Read this before opening any file.

1. **Working directory:** `/Users/siraj/falsafa`. Branch: `main` (this rework lands directly on main per the project's solo-flow; site auto-deploys via Vercel on push).
2. **The published `@falsafa/mcp@0.1.2`** is what real users install. Always exposes 10 tools. The eval runners create the "baseline" condition by **structurally withholding** wiki tools (8 vs 10), not by prompt instruction.
3. **Citation extraction** today (`apps/mcp/eval/run-openrouter.ts:864-889`) is broken for multi-work questions — it attributes every paragraph_id to the LAST tool-call's work+chapter. This is the BLOCKING fix in Chunk 1. Without it, strict scoring is built on misattributed data.
4. **`passByCitations` and `passByProse` already exist** at `eval/build-eval-json.ts:191-225`. Reuse them. The graded-fractional formula and the audited-strict overlay are NEW helpers built on top.
5. **The eval-arms registry is canonical in `eval-index.json`'s top-level `arms[]` field** (built once, server-side). The site's `eval-arms.ts` reads it; never hand-edits a separate file.
6. **Existing test infrastructure:** `bun test` runs everything. Tests live next to the file (`*.test.ts`) or in `__tests__/` subdirs. Existing iron-rule regression test at `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` MUST keep passing — it's the historic 84.7% headline reproducibility guard.
7. **Pool sizes:** 1,120 questions total = 757 named (`q-0NNNN`) + 363 hidden (`q-h-*` and reclassified `q-04xx-09xx`). Per-tier × per-category breakdowns published per arm.
8. **Anthropic Max-plan rate limits** are real. `run-claude-cli.ts` is sequential (concurrency 1), retry-on-429, resume-safe. Wallclock at 2,240 invocations: 1-3 days realistic.
9. **Cross-platform:** Mac dev / Linux CI / Windows contributor. All scripts use Node's `node:fs`, `node:path`, `node:url`. No bash-isms.

## File structure

| File | Status | Lines | Responsibility |
|---|---|---|---|
| `apps/mcp/eval/run-openrouter.ts` | MODIFY | ~+60 | Track per-tool-call `returned_paragraph_ids`; rewrite `extractCitations()` with proper attribution |
| `apps/mcp/eval/run-claude-cli.ts` | NEW | ~280 | Wraps `claude --print --bare --mcp-config <pinned> --allowedTools <list> --model <m>`; mirrors run-openrouter shape |
| `apps/mcp/eval/scripts/reextract-citations.ts` | NEW | ~80 | One-shot script: rewrites existing per-question JSON files with corrected citations[] |
| `.github/scripts/falsafa-mcp-config.json` | NEW | ~7 | Pinned MCP config for claude-cli runner |
| `eval/build-eval-json.ts` | MODIFY | ~+200 | New `computeMechanicalResult`, citation_quality, per-tier × per-category aggregation, audit overlay merge, arms[] registry, eval-arms split writer |
| `eval/audit-candidates.ts` | NEW | ~200 | CLI: presents ~146 strict-fail-with-citations cases for human adjudication; writes `eval/audit-decisions.json` |
| `eval/audit-decisions.json` | NEW (committed) | varies | Persisted human decisions; OR-groups of acceptable_alternatives per case_id |
| `apps/site/src/lib/eval-types.ts` | MODIFY | ~+30 | Extend `EvalCaseResult`; add `gradedScoreOf`, `gradedTriStateOf`, `strictPassOf` accessors; keep `passOf` returning `mechanical_pass` (loose) for back-compat |
| `apps/site/src/lib/eval-arms.ts` | REWRITE | ~+150 | Generic N-arm registry consumed from `eval-index.json.arms`; preserve `armVerdicts`/`filterByCompare` for 2-arm A/B special case |
| `apps/site/src/islands/eval-explorer/EvalExplorer.tsx` | REWRITE | ~+200 | Multi-arm scoreboard + lazy-fetch state machine + filter-by-lab; per-arm pending pills |
| `apps/site/src/pages/eval/index.astro` | REWRITE | ~+100 | Leaderboard view (5 wiki arms ranked) |
| `apps/site/src/pages/eval/compare.astro` | NEW | ~+120 | Deep-dive multi-select 2-4 arm view |
| `apps/site/src/pages/eval/methodology.astro` | NEW | ~+150 | Counterfactual analyses (wiki / strict-prompt / audit-overlay sub-sections) |
| `apps/site/src/pages/eval/[id].astro` | MODIFY | ~+50 | `import.meta.glob` per-arm files at build time; render all arms in vertical stack |
| `apps/site/src/pages/numbers/index.astro` | MODIFY | ~+40 | Updated stats with graded-fractional headline |
| `apps/site/src/pages/thesis/index.astro` | MODIFY | ~+60 | Methodology section explaining four-metric scoring + counterfactual deltas; updated A/B chart |
| `eval/__tests__/computeMechanicalResult.test.ts` | NEW | ~80 | Unit tests for graded fractional formula |
| `eval/__tests__/armTagFromRunDir.test.ts` | NEW | ~40 | Longest-match-first ordering tests |
| `eval/__tests__/citation-provenance.test.ts` | NEW | ~80 | Verifies `extractCitations` correctly attributes per tool-call returns |
| `apps/site/src/lib/__tests__/eval-arms.test.ts` | EXTEND | ~+60 | N-arm generic helpers; preserve existing 2-arm flips-* tests |

19 files: 4 NEW + 11 MODIFY + 4 NEW tests. Above the 8-file smell threshold but justified by the plan's 4-surface IA + runner-schema migration; HOLD SCOPE locked via /plan-eng-review.

---

## Chunk 1: Runner schema migration (citation provenance fix + claude-cli runner)

**Why first:** D5 BLOCKER. Until citations[] carries reliable per-paragraph provenance, strict scoring is built on misattributed data and the entire publishing claim falls. This chunk lands BEFORE any other chunk runs.

**Deliverables:**
- `RecordedToolCall` schema extended with `returned_paragraph_ids: string[]` for `read_chapter` / `get_passage`
- `extractCitations()` rewritten to attribute per-token by lookup against tool-call returns
- One-shot script to re-extract citations from existing Grok run JSON files
- `run-claude-cli.ts` runner mirroring `run-openrouter.ts` shape, using `claude --print` with the pinned MCP
- `.github/scripts/falsafa-mcp-config.json` (pinned MCP config)

### Task 1.1: Extend `RecordedToolCall` schema with `returned_paragraph_ids`

**Files:**
- Modify: `apps/mcp/eval/run-openrouter.ts:160-180` (RecordedToolCall type definition)
- Modify: `apps/mcp/eval/run-openrouter.ts:710-760` (the tool-call dispatch loop where returns are captured)

- [ ] **Step 1: Locate the existing `RecordedToolCall` type and add `export`**

Run: `grep -n "RecordedToolCall\|RecordedCitation\|interface RecordedTool\|extractCitations" /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts | head`

Expected: lines around 165 defining `interface RecordedToolCall { ... }` and `interface RecordedCitation { ... }`, plus a `function extractCitations(...)` near 864. Read 20 lines around each to understand existing shapes (name, args, result for RecordedToolCall; work_slug, chapter_number, paragraph_id for RecordedCitation).

The Chunk 1 tests import `extractCitations` and `RecordedToolCall` as named exports. Add the `export` keyword to both:

```ts
// Was:
interface RecordedToolCall { ... }
function extractCitations(...) { ... }

// After:
export interface RecordedToolCall { ... }
export function extractCitations(...) { ... }
```

Also add `export` to `RecordedCitation` since the test types reference it. Verify by `grep -n "^export" /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts | head` — should show RecordedToolCall, RecordedCitation, extractCitations.

- [ ] **Step 1.5: Note the dispatch-loop variable names**

Read lines 700-770 of run-openrouter.ts (`grep -n "case \"read_chapter\"\|case \"get_passage\"\|tool_calls.push\|toolCalls.push" /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts | head -10`). The variables you'll splice into in Step 6 are named **whatever the existing loop uses** — in current code, `tool` (or `toolName`) and `args` (or `parsedArgs`) and `result` (or `toolResult`). Substitute the local names accordingly when applying the Step 6 edit.

- [ ] **Step 2: Write the failing test**

Create `/Users/siraj/falsafa/apps/mcp/eval/__tests__/recorded-tool-call.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { RecordedToolCall } from "../run-openrouter.ts";

describe("RecordedToolCall schema", () => {
  test("type accepts returned_paragraph_ids on read_chapter", () => {
    const c: RecordedToolCall = {
      api_call_index: 1,
      name: "read_chapter",
      args: { work_slug: "manusmrti", chapter_number: 1, variant: "translation" },
      result: { ok: true, body: "..." },
      returned_paragraph_ids: ["p-868413", "p-aabbcc"],
    };
    expect(c.returned_paragraph_ids).toHaveLength(2);
  });

  test("type accepts returned_paragraph_ids absent on non-content tools", () => {
    const c: RecordedToolCall = {
      api_call_index: 1,
      name: "list_works",
      args: { author: "cynewulf" },
      result: { ok: true, works: [] },
    };
    expect(c.returned_paragraph_ids).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test __tests__/recorded-tool-call.test.ts 2>&1 | tail -10`

Expected: FAIL — `returned_paragraph_ids does not exist on type 'RecordedToolCall'` or similar TS error.

- [ ] **Step 4: Add the field to the type**

Edit `apps/mcp/eval/run-openrouter.ts`. Find the `RecordedToolCall` interface and add the optional field:

```ts
interface RecordedToolCall {
  api_call_index: number;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  /**
   * For content-returning tools (read_chapter, get_passage), the paragraph_ids
   * the call returned. Used to attribute [p-xxxxxx] tokens in the answer back
   * to the correct (work_slug, chapter_number) at extractCitations time.
   * Undefined for tools that don't return paragraph content.
   */
  returned_paragraph_ids?: string[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test __tests__/recorded-tool-call.test.ts 2>&1 | tail -3`

Expected: PASS.

- [ ] **Step 6: Capture `returned_paragraph_ids` in the tool dispatch loop**

Find the tool-call dispatch loop (around line 710-760 in run-openrouter.ts where `result` is recorded after a tool executes). Locate the block that records `RecordedToolCall` entries.

For `read_chapter` and `get_passage` calls, after capturing the result, extract paragraph_ids:

```ts
// After the tool executes and `result` is the JSON-RPC response body:
let returned_paragraph_ids: string[] | undefined;
if (toolName === "read_chapter" || toolName === "get_passage") {
  // The MCP tools return content as text, with [p-xxxxxx] markers.
  // For read_chapter: result.content[0].text contains the body.
  // For get_passage: result.content[0].text or result.paragraphs[].paragraph_id.
  const ids = new Set<string>();
  const captureFromText = (s: string) => {
    for (const m of s.matchAll(/\bp-[0-9a-f]{6}\b/g)) ids.add(m[0]);
  };
  // Try the structured shape first (get_passage with paragraphs array)
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.paragraphs)) {
    for (const p of r.paragraphs as Array<Record<string, unknown>>) {
      if (typeof p.paragraph_id === "string") ids.add(p.paragraph_id);
    }
  }
  // Then fall back to scanning content text for [p-xxxxxx]
  if (Array.isArray(r.content)) {
    for (const c of r.content as Array<Record<string, unknown>>) {
      if (typeof c.text === "string") captureFromText(c.text);
    }
  }
  returned_paragraph_ids = ids.size > 0 ? Array.from(ids) : undefined;
}

const recorded: RecordedToolCall = {
  api_call_index: callIndex,
  name: toolName,
  args: parsedArgs,
  result,
  ...(returned_paragraph_ids ? { returned_paragraph_ids } : {}),
};
toolCalls.push(recorded);
```

- [ ] **Step 7: Verify capture works on a small live run**

Run a 1-question smoke against an existing run dir to confirm `returned_paragraph_ids` is populated:

```bash
cd /Users/siraj/falsafa/apps/mcp/eval
# Find a question that involves read_chapter (any case from runs/grok-4.1-fast-baseline-* should work)
RUN_DIR=$(ls -td runs/grok-4.1-fast-*/ 2>/dev/null | head -1)
SAMPLE=$(ls "$RUN_DIR"q-0001.json 2>/dev/null || ls "$RUN_DIR"q-*.json 2>/dev/null | head -1)
# (Don't actually re-run; just verify the schema works in test fixtures.)
```

Or write a minimal integration test that mocks a read_chapter return and asserts `returned_paragraph_ids` propagates. (Add to `__tests__/recorded-tool-call.test.ts`):

```ts
test("captures paragraph_ids from read_chapter result", () => {
  // Simulating the tool dispatch loop's extraction logic
  const result = { content: [{ type: "text", text: "[p-868413] First line\n[p-aabbcc] Second line" }] };
  const ids = new Set<string>();
  for (const c of result.content) {
    for (const m of c.text.matchAll(/\bp-[0-9a-f]{6}\b/g)) ids.add(m[0]);
  }
  expect(Array.from(ids).sort()).toEqual(["p-868413", "p-aabbcc"]);
});
```

Run: `bun test __tests__/recorded-tool-call.test.ts -v`. Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/eval/run-openrouter.ts apps/mcp/eval/__tests__/recorded-tool-call.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): record returned_paragraph_ids per tool call

Extends RecordedToolCall schema with an optional
returned_paragraph_ids: string[] field. For read_chapter and
get_passage calls, captures every [p-xxxxxx] token the tool returned
(via the structured paragraphs[] array if present, or by scanning
content[].text). Populated only for content-returning tools; absent
for list_works / get_metadata / etc.

Required for the citation-provenance fix in extractCitations() which
follows: token-level attribution lookup needs to know which tool call
actually returned each paragraph_id, not the last work+chapter
context seen across the whole trace (the existing approximation
misattributes citations on multi-work questions).

Tests: 3 cases covering schema acceptance, content-text scan, and
absence on non-content tools.
EOF
)"
```

### Task 1.2: Rewrite `extractCitations()` to attribute by per-token lookup

**Files:**
- Modify: `apps/mcp/eval/run-openrouter.ts:864-889` (the existing `extractCitations` function)
- Test: `apps/mcp/eval/__tests__/citation-provenance.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `/Users/siraj/falsafa/apps/mcp/eval/__tests__/citation-provenance.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractCitations, type RecordedToolCall } from "../run-openrouter.ts";

describe("extractCitations — per-token provenance lookup", () => {
  test("attributes paragraph_id to the tool call that actually returned it", () => {
    const calls: RecordedToolCall[] = [
      {
        api_call_index: 1,
        name: "read_chapter",
        args: { work_slug: "manusmrti", chapter_number: 1 },
        result: {},
        returned_paragraph_ids: ["p-aaaa11", "p-aaaa22"],
      },
      {
        api_call_index: 2,
        name: "read_chapter",
        args: { work_slug: "yajnavalkya", chapter_number: 2 },
        result: {},
        returned_paragraph_ids: ["p-bbbb11", "p-bbbb22"],
      },
    ];
    const answer = "Manu says [p-aaaa11] and Yajnavalkya says [p-bbbb22].";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(2);
    expect(cites.find((c) => c.paragraph_id === "p-aaaa11")?.work_slug).toBe("manusmrti");
    expect(cites.find((c) => c.paragraph_id === "p-bbbb22")?.work_slug).toBe("yajnavalkya");
  });

  test("falls back to 'unknown' work_slug for hallucinated paragraph_ids", () => {
    const calls: RecordedToolCall[] = [
      {
        api_call_index: 1,
        name: "read_chapter",
        args: { work_slug: "manusmrti", chapter_number: 1 },
        result: {},
        returned_paragraph_ids: ["p-aaaa11"],
      },
    ];
    const answer = "Citing [p-aaaa11] and [p-zzzzzz] (model invented this).";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(2);
    expect(cites.find((c) => c.paragraph_id === "p-zzzzzz")?.work_slug).toBe("");
  });

  test("returns empty array when answer has no paragraph_ids", () => {
    const calls: RecordedToolCall[] = [];
    expect(extractCitations("No citations here.", calls)).toEqual([]);
  });

  test("dedupes when same paragraph_id appears twice in answer", () => {
    const calls: RecordedToolCall[] = [
      {
        api_call_index: 1,
        name: "read_chapter",
        args: { work_slug: "andreas", chapter_number: 1 },
        result: {},
        returned_paragraph_ids: ["p-868413"],
      },
    ];
    const answer = "Quote 1: [p-868413]. Quote 2: [p-868413].";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(1);
  });

  test("handles get_passage tool calls the same way", () => {
    const calls: RecordedToolCall[] = [
      {
        api_call_index: 1,
        name: "get_passage",
        args: { work_slug: "iqbal-bang-e-dara-1", paragraph_ids: ["p-7c1abc"] },
        result: {},
        returned_paragraph_ids: ["p-7c1abc"],
      },
    ];
    const cites = extractCitations("As Iqbal writes [p-7c1abc]…", calls);
    expect(cites[0]?.work_slug).toBe("iqbal-bang-e-dara-1");
  });

  test("hallucinated paragraph_id in tool ARG but never returned falls through to unknown", () => {
    // Model called get_passage(paragraph_ids=["p-aaaa11"]) but the call errored;
    // returned_paragraph_ids is undefined. The lookup must NOT fall back to args.
    const calls: RecordedToolCall[] = [
      {
        api_call_index: 1,
        name: "get_passage",
        args: { work_slug: "manusmrti", paragraph_ids: ["p-aaaa11"] },
        result: { error: "not found" },
        // returned_paragraph_ids deliberately absent (call errored)
      },
    ];
    const cites = extractCitations("Citing [p-aaaa11]…", calls);
    expect(cites[0]?.work_slug).toBe("");
  });
});

// Note on paragraph_id format: corpus uses content-derived 6-hex-char ids
// (e.g. p-868413, p-7c1abc). The /\bp-[0-9a-f]{6}\b/g regex is correct
// for this format. If the corpus generator ever changes (e.g. base36),
// the regex in extractCitations() AND in run-openrouter.ts:868 must be
// updated together.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test __tests__/citation-provenance.test.ts 2>&1 | tail -15`

Expected: 4 tests FAIL (the existing extractCitations attributes everything to the last context). The "no paragraph_ids" test may pass.

- [ ] **Step 3: Rewrite `extractCitations`**

Replace the existing function at `apps/mcp/eval/run-openrouter.ts:858-889` with:

```ts
/**
 * Extract paragraph_id citations from the answer text. For each [p-xxxxxx]
 * token, look up which tool call actually returned that paragraph_id (via
 * the call's returned_paragraph_ids field), and attribute the citation to
 * that call's (work_slug, chapter_number).
 *
 * Falls back to work_slug="" for paragraph_ids no tool call returned (the
 * model hallucinated the id, or the trace is incomplete). The strict-pass
 * scorer treats work_slug="" citations as broken/non-expected.
 *
 * Replaces the old "last-context-wins" heuristic which misattributed every
 * citation on multi-work questions.
 */
export function extractCitations(
  answer: string,
  toolCalls: ReadonlyArray<RecordedToolCall>,
): RecordedCitation[] {
  const tokens = Array.from(new Set(
    Array.from(answer.matchAll(/\bp-[0-9a-f]{6}\b/g)).map((m) => m[0])
  ));
  if (tokens.length === 0) return [];

  // Build a lookup: paragraph_id → (work_slug, chapter_number) from the
  // first tool call that returned it. (If multiple calls returned the same
  // id — rare but possible if the model re-fetches — first wins.)
  const provenance = new Map<string, { work_slug: string; chapter_number: number | undefined }>();
  for (const tc of toolCalls) {
    if (!tc.returned_paragraph_ids) continue;
    const a = tc.args as Record<string, unknown>;
    const work_slug = typeof a.work_slug === "string" ? a.work_slug : "";
    const chapter_number = typeof a.chapter_number === "number" ? a.chapter_number : undefined;
    for (const pid of tc.returned_paragraph_ids) {
      if (!provenance.has(pid)) {
        provenance.set(pid, { work_slug, chapter_number });
      }
    }
  }

  return tokens.map((paragraph_id) => {
    const prov = provenance.get(paragraph_id);
    return {
      work_slug: prov?.work_slug ?? "",
      chapter_number: prov?.chapter_number,
      paragraph_id,
    };
  });
}
```

Make sure `extractCitations` and `RecordedToolCall` are `export`ed (the test imports them).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test __tests__/citation-provenance.test.ts 2>&1 | tail -10`

Expected: 6 PASS, 0 FAIL.

- [ ] **Step 5: Verify the existing test suite still passes**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test 2>&1 | tail -10`

Expected: previous test count + 6 new tests (citation-provenance) + 3 new tests (recorded-tool-call) = +9 total. No regressions.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/eval/run-openrouter.ts apps/mcp/eval/__tests__/citation-provenance.test.ts
git commit -m "$(cat <<'EOF'
fix(eval): attribute citations by per-paragraph_id provenance lookup

Replaces the last-context-wins heuristic in extractCitations() with
a proper lookup: each [p-xxxxxx] token in the answer is attributed
to the tool call that actually returned it (via the returned_paragraph_ids
field added in the previous commit).

Before: a model that called read_chapter("manusmrti", 1), then
read_chapter("yajnavalkya", 2), then wrote prose citing paragraphs
from BOTH would have all citations labeled "yajnavalkya". This silently
misattributed citations on every multi-work question — exactly the
comparative/cross-cultural cases where strict scoring matters most.

After: paragraph_id lookup gives correct attribution. Hallucinated
paragraph_ids (model invented an id no tool returned) get work_slug=""
which the strict-pass scorer treats as broken.

This is a BLOCKING fix for the eval scoring rework — strict-scoring
cannot ship until this lands. Codex outside-voice surfaced it; review
finding D5 from /plan-eng-review on 2026-05-01.

Tests: 5 cases covering multi-work attribution, hallucinated ids,
empty answers, deduping, and get_passage tool support.
EOF
)"
```

### Task 1.3: Create the pinned MCP config for the claude-cli runner

(Originally this slot held a "re-extract citations" script. Dropped on
review — every existing Grok run JSON file predates the schema and
cannot be salvaged by a re-extraction. The Grok arms get re-run in
Chunk 4 with the new schema, which is the real fix. There is no
re-extractable data.)

**Files:**
- Create: `.github/scripts/falsafa-mcp-config.json`

- [ ] **Step 1: Create the config file**

Create `/Users/siraj/falsafa/.github/scripts/falsafa-mcp-config.json`:

```json
{
  "mcpServers": {
    "falsafa": {
      "command": "npx",
      "args": ["-y", "@falsafa/mcp@0.1.2"]
    }
  }
}
```

- [ ] **Step 2: Verify it works with `claude --print`**

Run a smoke against `claude --print` from a clean dir:

```bash
cd /tmp
echo "List the works by Cynewulf using the falsafa tools. Return just the slugs as a comma-separated list." | \
  claude --print \
    --bare \
    --mcp-config /Users/siraj/falsafa/.github/scripts/falsafa-mcp-config.json \
    --allowedTools 'mcp__falsafa__list_works' \
    --output-format text 2>&1 | tail -5
```

Expected: a comma-separated list including `cynewulf-andreas-07b573, cynewulf-elene-d2d132, cynewulf-juliana-9a2157`.

Common gotchas:
- **MCP server failed to start** — npm cache cold. Run `npx -y @falsafa/mcp@0.1.2 --version 2>&1 | head -3` once, then retry.
- **Auth error** — `claude` CLI not logged in. Run `claude` once interactively and confirm the session works, then retry the smoke.
- **No output / hangs** — Claude CLI startup timeout exceeded. Check `claude --version` works at all.

- [ ] **Step 3: Commit**

```bash
cd /Users/siraj/falsafa
git add .github/scripts/falsafa-mcp-config.json
git commit -m "feat(ci): pinned falsafa/mcp config for run-claude-cli.ts

Pins @falsafa/mcp@0.1.2 so claude-cli eval runs are reproducible
against a specific tarball. Future @falsafa/mcp versions may change
tool descriptions, schemas, or wiki contents; pinning means the eval
numbers in the paper stay reproducible against the artifact-as-shipped
at run time.

Used by run-claude-cli.ts (next task)."
```

### Task 1.4: Build `run-claude-cli.ts` runner

**Files:**
- Create: `apps/mcp/eval/run-claude-cli.ts`

This is the longest task in Chunk 1; budget ~30 min for implementation. The runner mirrors `run-openrouter.ts`'s output shape (per-question JSON files in `runs/<arm>-<ts>/q-NNNN.json`) so the build script's aggregation works on both data sources identically.

**Code shape:** see the CEO plan section "New runner — `apps/mcp/eval/run-claude-cli.ts`" lines 280-365 for full envelope spec. Key contracts:

- Spawn `claude --print --bare --mcp-config <config> --allowedTools <list> --model <m> --output-format json`
- One process per question (no daemon mode)
- Per-question 5-minute timeout via `child_process.spawn` with `{ timeout: 5*60_000, killSignal: "SIGKILL" }`
- Retry on 429 / `usage_limit_reached` with 5-minute sleep, max 3 retries, then skip
- Atomic `.tmp + rename` per-question write; resume-safe (skip already-existing files)
- Sequential (`--concurrency 1`); no parallelism (Anthropic Max-plan rate limits)
- Synthesize a single `UsageStep` per question from Claude CLI's envelope: `{ api_call_index: 1, trigger: "initial", preceded_by: [], prompt_tokens: usage.input_tokens + usage.cache_read_input_tokens, completion_tokens: usage.output_tokens, cached_tokens: usage.cache_read_input_tokens, cost_usd: total_cost_usd }`
- Cost imputation per Anthropic 2026-05-01 list rates with cache multipliers (Sonnet $3 fresh / $0.30 cached / $3.75 write / $15 out per 1M; Haiku $1 / $0.10 / $1.25 / $5)

- [ ] **Step 1: Read the existing run-openrouter.ts to mirror its structure**

Run: `wc -l /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts && grep -n "^function\|^async function\|^export" /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts | head -20`

Expected: ~1000 lines, several top-level functions. The structure to mirror: `parseFlags()`, `loadQuestionPool()`, `runQuestion()`, `main()` + atomic-write helpers.

- [ ] **Step 2: Write the failing test (smoke against a single question)**

Create `apps/mcp/eval/__tests__/run-claude-cli.smoke.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

describe("run-claude-cli smoke", () => {
  test("invokes claude --print with mcp-config and parses JSON envelope", async () => {
    // Skipped by default (depends on claude CLI auth + npx cache).
    // Enable manually with `RUN_CLAUDE_SMOKE=1 bun test`.
    if (!process.env.RUN_CLAUDE_SMOKE) {
      console.error("skip: RUN_CLAUDE_SMOKE not set");
      return;
    }
    const proc = spawn("claude", [
      "--print",
      "--bare",
      "--mcp-config", "/Users/siraj/falsafa/.github/scripts/falsafa-mcp-config.json",
      "--allowedTools", "mcp__falsafa__list_works",
      "--output-format", "json",
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 });
    proc.stdin.write("List 3 works by Cynewulf as JSON.\n");
    proc.stdin.end();
    let stdout = "";
    proc.stdout.on("data", (c) => stdout += c.toString());
    await new Promise((res) => proc.on("close", res));
    const env = JSON.parse(stdout);
    expect(typeof env.result).toBe("string");
    expect(typeof env.usage).toBe("object");
    expect(typeof env.usage.input_tokens).toBe("number");
  });
});
```

- [ ] **Step 3: Run test to verify it fails or skips**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test __tests__/run-claude-cli.smoke.test.ts 2>&1 | tail -5`

Expected: SKIP (we haven't enabled the smoke). The test setup is in place.

- [ ] **Step 4: Write the runner implementation**

Create `/Users/siraj/falsafa/apps/mcp/eval/run-claude-cli.ts`. Full file below (~280 lines). Read carefully — this is the engineering core of Chunk 1.

```ts
#!/usr/bin/env bun
/**
 * run-claude-cli.ts — Eval runner that wraps Claude Code's `claude --print`
 * CLI to evaluate the published @falsafa/mcp@0.1.2 against the question pool.
 *
 * Mirrors run-openrouter.ts's output shape (per-question JSON in
 * runs/<arm>-<ts>/q-NNNN.json) so build-eval-json.ts treats both runner
 * outputs identically.
 *
 * Usage:
 *   bun run run-claude-cli.ts \
 *     --model claude-sonnet-4-5 \
 *     --treatment wiki \
 *     --run-name sonnet-4.6-via-mcp-20260501-090000 \
 *     [--concurrency 1] [--limit 1120]
 *
 * Treatment values: "wiki" (10-tool whitelist) or "baseline" (8-tool, no wiki).
 *
 * Per-question contract:
 *   1. Spawn `claude --print --bare --mcp-config <pinned> --allowedTools <list>
 *      --model <m> --output-format json` with question on stdin.
 *   2. 5-minute timeout per spawn (SIGKILL on overrun).
 *   3. Parse JSON envelope: result, total_cost_usd, usage{input_tokens,
 *      cache_creation_input_tokens, cache_read_input_tokens, output_tokens}.
 *   4. Synthesize a single UsageStep matching run-openrouter.ts shape.
 *   5. Compute cost from Anthropic list rates (cost_basis annotated).
 *   6. Atomic .tmp + rename write to runs/<run-name>/q-NNNN.json.
 *
 * Resilience:
 *   - Resume-safe: skip questions whose q-NNNN.json already exists.
 *   - Retry on exit code matching 429 / "usage_limit_reached" with 5-min sleep,
 *     max 3 retries, then skip the question.
 *   - Sequential (concurrency 1) by design — Anthropic Max-plan rate limits.
 *   - Skip + log on malformed JSON envelope; resume picks up next run.
 *
 * Cost imputation (Anthropic list rates as of 2026-05-01):
 *   Sonnet 4.6: $3 fresh / $0.30 cached read / $3.75 cache write / $15 output (per 1M)
 *   Haiku 4.5:  $1 fresh / $0.10 cached read / $1.25 cache write / $5  output (per 1M)
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MCP_CONFIG = resolve(REPO_ROOT, ".github/scripts/falsafa-mcp-config.json");

const TEN_TOOL_LIST = [
  "mcp__falsafa__list_works",
  "mcp__falsafa__list_chapters",
  "mcp__falsafa__get_metadata",
  "mcp__falsafa__read_chapter",
  "mcp__falsafa__get_passage",
  "mcp__falsafa__search_corpus",
  "mcp__falsafa__find_related",
  "mcp__falsafa__compare_works",
  "mcp__falsafa__read_wiki",
  "mcp__falsafa__read_wiki_full",
].join(",");

const EIGHT_TOOL_LIST = [
  "mcp__falsafa__list_works",
  "mcp__falsafa__list_chapters",
  "mcp__falsafa__get_metadata",
  "mcp__falsafa__read_chapter",
  "mcp__falsafa__get_passage",
  "mcp__falsafa__search_corpus",
  "mcp__falsafa__find_related",
  "mcp__falsafa__compare_works",
].join(",");

/**
 * Anthropic list rates as of 2026-05-01 (USD per 1M tokens).
 *
 * IMPORTANT: when Anthropic changes prices, update both these numbers
 * AND bump the `cost_basis` string in main() (currently
 * "anthropic_list_2026_05_01"). The output JSON's cost_basis field is
 * what makes future cost columns comparable across rate-card changes.
 *
 * Rates source: https://docs.anthropic.com/en/api/pricing (claude-sonnet-4-5
 * + claude-haiku-4-5 endpoints). Cache multipliers per Anthropic Prompt
 * Caching docs: 0.1× (cached read) and 1.25× (cache write) of fresh input.
 */
const RATES = {
  "claude-sonnet-4-5": { fresh: 3.0, cached_read: 0.30, cache_write: 3.75, output: 15.0 },
  "claude-haiku-4-5":  { fresh: 1.0, cached_read: 0.10, cache_write: 1.25, output: 5.0 },
} as const;

const PER_QUESTION_TIMEOUT_MS = 5 * 60_000;     // 5 min
const RATE_LIMIT_SLEEP_MS = 5 * 60_000;         // 5 min
const MAX_RETRIES = 3;

// --------------------------------------------------------------------
// CLI flag parsing
// --------------------------------------------------------------------

interface Flags {
  model: keyof typeof RATES;
  treatment: "wiki" | "baseline";
  runName: string;
  limit?: number;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  let model: string | undefined;
  let treatment: string | undefined;
  let runName: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--model") model = args[++i];
    else if (a === "--treatment") treatment = args[++i];
    else if (a === "--run-name") runName = args[++i];
    else if (a === "--limit") limit = parseInt(args[++i] ?? "", 10);
  }

  if (!model || !(model in RATES)) {
    console.error(`--model required (one of ${Object.keys(RATES).join(", ")})`);
    process.exit(1);
  }
  if (treatment !== "wiki" && treatment !== "baseline") {
    console.error(`--treatment required (wiki | baseline)`);
    process.exit(1);
  }
  if (!runName) {
    console.error(`--run-name required (e.g. sonnet-4.6-via-mcp-20260501-090000)`);
    process.exit(1);
  }
  return { model: model as keyof typeof RATES, treatment, runName, limit };
}

// --------------------------------------------------------------------
// Question pool (mirrors run-openrouter.ts:loadQuestionPool)
// --------------------------------------------------------------------

interface PoolQuestion {
  id: string;
  prompt: string;
  expected_works: string[];
  category?: string;
  difficulty?: string;
  tier?: "named" | "hidden";
}

function loadQuestionPool(): PoolQuestion[] {
  const named = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "eval/questions-revised-1000.json"), "utf8")
  ) as PoolQuestion[];
  const hiddenLines = readFileSync(
    resolve(REPO_ROOT, "eval/questions-discovery-v1.jsonl"), "utf8"
  ).split("\n").filter((l) => l.trim());
  const hidden = hiddenLines.map((l) => JSON.parse(l) as PoolQuestion);
  return [...named, ...hidden];
}

// --------------------------------------------------------------------
// Single-question runner
// --------------------------------------------------------------------

interface ClaudeEnvelope {
  result: string;
  total_cost_usd?: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
}

interface SpawnResult {
  ok: true;
  envelope: ClaudeEnvelope;
} | {
  ok: false;
  reason: "timeout" | "rate_limit" | "malformed_json" | "non_zero_exit" | "spawn_failed";
  exitCode: number | null;
  signal: string | null;
  stderr: string;
}

async function spawnClaude(
  prompt: string,
  flags: Flags,
): Promise<SpawnResult> {
  const tools = flags.treatment === "wiki" ? TEN_TOOL_LIST : EIGHT_TOOL_LIST;
  const args = [
    "--print",
    "--bare",
    "--mcp-config", MCP_CONFIG,
    "--allowedTools", tools,
    "--model", flags.model,
    "--output-format", "json",
  ];

  return new Promise((res) => {
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: PER_QUESTION_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });

    proc.on("error", () => {
      res({ ok: false, reason: "spawn_failed", exitCode: null, signal: null, stderr });
    });

    proc.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        return res({ ok: false, reason: "timeout", exitCode: code, signal, stderr });
      }
      if (code !== 0) {
        const lower = stderr.toLowerCase();
        if (lower.includes("usage_limit_reached") || lower.includes("rate limit") || code === 429) {
          return res({ ok: false, reason: "rate_limit", exitCode: code, signal, stderr });
        }
        return res({ ok: false, reason: "non_zero_exit", exitCode: code, signal, stderr });
      }
      try {
        const envelope = JSON.parse(stdout) as ClaudeEnvelope;
        res({ ok: true, envelope });
      } catch {
        res({ ok: false, reason: "malformed_json", exitCode: code, signal, stderr });
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// --------------------------------------------------------------------
// Cost imputation
// --------------------------------------------------------------------

function imputeCost(model: keyof typeof RATES, usage: ClaudeEnvelope["usage"]): number {
  const r = RATES[model];
  // Anthropic Messages API reports input_tokens as UNCACHED input only.
  // cache_creation_input_tokens and cache_read_input_tokens are reported
  // separately. Do NOT subtract; sum the four buckets independently.
  return (
    (usage.input_tokens * r.fresh +
     usage.cache_creation_input_tokens * r.cache_write +
     usage.cache_read_input_tokens * r.cached_read +
     usage.output_tokens * r.output) / 1_000_000
  );
}

// --------------------------------------------------------------------
// Atomic per-question write
// --------------------------------------------------------------------

function writeAtomic(path: string, data: unknown): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

// --------------------------------------------------------------------
// Main loop
// --------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags();
  const runDir = resolve(REPO_ROOT, "apps/mcp/eval/runs", flags.runName);
  mkdirSync(runDir, { recursive: true });

  const pool = loadQuestionPool();
  const limit = flags.limit ?? pool.length;
  const questions = pool.slice(0, limit);

  console.error(`[run-claude-cli] model=${flags.model} treatment=${flags.treatment} run=${flags.runName} questions=${questions.length}`);

  // Resume: skip already-done
  const done = new Set(readdirSync(runDir).filter((f) => /^q-.+\.json$/.test(f)).map((f) => f.replace(/\.json$/, "")));
  console.error(`[run-claude-cli] resume: ${done.size} questions already done`);

  let costSum = 0;
  let i = 0;
  for (const q of questions) {
    i++;
    if (done.has(q.id)) continue;

    let attempt = 0;
    let result: SpawnResult | null = null;
    while (attempt < MAX_RETRIES) {
      result = await spawnClaude(q.prompt, flags);
      if (result.ok) break;
      if (result.reason !== "rate_limit") break;
      attempt++;
      console.error(`[run-claude-cli] q=${q.id} rate-limited, sleep ${RATE_LIMIT_SLEEP_MS / 1000}s (retry ${attempt}/${MAX_RETRIES})`);
      await new Promise((res) => setTimeout(res, RATE_LIMIT_SLEEP_MS));
    }

    if (!result || !result.ok) {
      console.error(`[run-claude-cli] q=${q.id} SKIP reason=${result?.reason ?? "unknown"} stderr=${(result?.stderr ?? "").slice(0, 200)}`);
      continue;
    }

    const env = result.envelope;
    const cost_usd = env.total_cost_usd ?? imputeCost(flags.model, env.usage);
    costSum += cost_usd;

    const out = {
      id: q.id,
      run_name: flags.runName,
      model: flags.model,
      treatment: flags.treatment,
      prompt: q.prompt,
      expected_works: q.expected_works,
      category: q.category,
      difficulty: q.difficulty,
      tier: q.tier,
      answer: env.result,
      tool_calls: [],   // Claude CLI doesn't expose per-tool-call breakdowns
      citations: [],    // populated by extractCitations after answer parsed; stub for now
      usage_per_call: [{
        api_call_index: 1,
        trigger: "initial",
        preceded_by: [],
        prompt_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens,
        completion_tokens: env.usage.output_tokens,
        cached_tokens: env.usage.cache_read_input_tokens,
        cost_usd,
      }],
      usage: {
        prompt_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens,
        completion_tokens: env.usage.output_tokens,
        total_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens + env.usage.output_tokens,
        api_calls: 1,
        cost_usd,
        model: flags.model,
      },
      cost_basis: "anthropic_list_2026_05_01",
      duration_ms: env.duration_ms,
    };

    writeAtomic(join(runDir, `${q.id}.json`), out);
    if (i % 10 === 0) {
      console.error(`[run-claude-cli] ${i}/${questions.length} cost=$${costSum.toFixed(2)}`);
    }
  }

  console.error(`[run-claude-cli] DONE total_cost=$${costSum.toFixed(2)}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

(`citations: []` is intentionally a stub for Claude CLI runs. The existing `extractCitations` requires per-tool-call records (with `returned_paragraph_ids`), but Claude CLI's `--output-format=json` envelope does NOT expose per-tool-call breakdowns — only a single aggregated answer + usage object.

**Schema asymmetry:** Grok (run-openrouter.ts) runs have rich provenance via `returned_paragraph_ids`. Claude CLI runs do not. Citations for Claude CLI runs are extracted post-hoc by `build-eval-json.ts` scanning the answer text for `[p-xxxxxx]` tokens against the corpus paragraph_id index, which gives `(work_slug, chapter_number)` per token by table lookup.

This corpus-index lookup is **methodologically equivalent or stronger** than per-tool-call provenance for the strict-pass check, because the corpus is the ground-truth source: a paragraph_id appears in exactly one (work_slug, chapter_number) tuple. The only thing the Grok-side runner buys is the ability to detect "model called read_chapter X but cited a paragraph from chapter Y" — useful for the citation_quality.broken_refs metric. For Claude CLI runs that detection is impossible; broken_refs detects only "paragraph_id doesn't exist in the corpus at all."

This asymmetry is acknowledged in the paper's Methodology section. Specified in Chunk 2.)

- [ ] **Step 5: Run a 1-question smoke test**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-claude-cli.ts \
  --model claude-haiku-4-5 \
  --treatment baseline \
  --run-name smoke-test-$(date +%s) \
  --limit 1
```

Expected: `[run-claude-cli] DONE total_cost=$0.00X`. Check that `apps/mcp/eval/runs/smoke-test-*/q-0001.json` exists with valid shape.

```bash
ls /Users/siraj/falsafa/apps/mcp/eval/runs/smoke-test-* | head
cat /Users/siraj/falsafa/apps/mcp/eval/runs/smoke-test-*/q-0001.json | jq '.usage' 2>&1 | head
```

If the smoke fails on auth, the user needs `claude` to be logged in (which it already is). If it fails on rate limits, the runner correctly reports SKIP and continues.

- [ ] **Step 6: Cleanup the smoke run + commit**

```bash
cd /Users/siraj/falsafa
rm -rf apps/mcp/eval/runs/smoke-test-*
git add apps/mcp/eval/run-claude-cli.ts apps/mcp/eval/__tests__/run-claude-cli.smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): run-claude-cli.ts — eval runner via Claude Code + @falsafa/mcp

Wraps `claude --print --bare --mcp-config <pinned> --allowedTools <list>
--model <m> --output-format json` per question. Mirrors
run-openrouter.ts's output shape so build-eval-json.ts aggregates both
runner outputs identically.

Treatment-aware tool whitelist:
  wiki     → 10-tool list (default; mirrors what real users get)
  baseline → 8-tool list (structural withhold of read_wiki + read_wiki_full)

Resilience:
  - 5-min spawn timeout (SIGKILL)
  - Retry on rate limit (5-min sleep, max 3 retries), then skip
  - Skip + log on malformed JSON; resume picks up next run
  - Sequential (concurrency 1); Anthropic Max-plan caps are real
  - Atomic .tmp + rename per-question; resumable

Cost imputation per Anthropic 2026-05-01 list rates with cache
multipliers (Sonnet $3 / $0.30 / $3.75 / $15; Haiku $1 / $0.10 / $1.25
/ $5 per 1M). cost_basis: "anthropic_list_2026_05_01" annotated in
output JSON for future-proofing.

Citations are written as [] from this runner — the build script
extracts them post-hoc by scanning the answer text against the corpus
paragraph_id index (Chunk 2). Claude CLI doesn't expose per-tool-call
breakdowns.

Plan: docs/superpowers/plans/2026-05-01-eval-scoring-rework-implementation.md
EOF
)"
```

---

## Chunk 1 Done Criteria

- [ ] All 4 tasks committed (4 commits — Tasks 1.1, 1.2, 1.3, 1.4)
- [ ] `bun test apps/mcp/eval/__tests__/recorded-tool-call.test.ts` — 3 PASS
- [ ] `bun test apps/mcp/eval/__tests__/citation-provenance.test.ts` — 6 PASS (multi-work, hallucinated, empty, dedup, get_passage, hallucinated-in-args)
- [ ] `grep -n "^export" /Users/siraj/falsafa/apps/mcp/eval/run-openrouter.ts | head` shows: RecordedToolCall, RecordedCitation, extractCitations
- [ ] Existing test suite still passes: `cd apps/mcp && bun test 2>&1 | tail -5` shows no new failures vs pre-Chunk-1 baseline
- [ ] `npx -y @falsafa/mcp@0.1.2 --version 2>&1 | head -3` returns within 60s (npm cache warm)
- [ ] Smoke run: `bun run apps/mcp/eval/run-claude-cli.ts --model claude-haiku-4-5 --treatment baseline --run-name smoke-XXX --limit 1` produces a valid `apps/mcp/eval/runs/smoke-XXX/q-0001.json`
- [ ] Output shape parity check: `diff <(jq -r 'keys[]' apps/mcp/eval/runs/grok-4.1-fast-baseline-*/q-0001.json | sort | head -20) <(jq -r 'keys[]' apps/mcp/eval/runs/smoke-XXX/q-0001.json | sort | head -20)` — non-empty diffs only on fields the schema allows (e.g., tool_calls populated for Grok, [] for Claude CLI; cost_basis present for Claude CLI). Top-level field names should overlap fully.
- [ ] Smoke cleanup verified: `ls apps/mcp/eval/runs/smoke-* 2>/dev/null` returns nothing after `rm -rf`

**Rollback if Chunk 1 breaks:** every task is a separate commit; `git revert <commit>` restores prior state. The runner schema change is additive (`returned_paragraph_ids?: string[]` is optional), so existing code paths in run-openrouter.ts that don't read this field still work.

**What this chunk unblocks:** Chunks 2-5. Without correct citation attribution, every downstream metric (strict scoring, citation_quality, audit overlay) is unreliable. The Claude CLI runner additionally unblocks Chunk 4's Sonnet + Haiku arms.

**Schema asymmetry to remember in Chunk 2:** Grok runs (run-openrouter.ts) populate `tool_calls[].returned_paragraph_ids`; Claude CLI runs (run-claude-cli.ts) leave `tool_calls: []`. The build-eval-json.ts changes in Chunk 2 must handle both: extract citations from answer text via corpus paragraph_id index when tool_calls is empty.

---

## Chunk 2: Scoring + aggregation in `eval/build-eval-json.ts`

**Why second:** Chunk 1 fixed the runner schema; Chunk 2 consumes it. New `computeMechanicalResult()` produces fractional graded score + four-axis pass booleans + citation_quality. Aggregation rewires from `pass_count` to graded-sum + per-tier × per-category breakdowns. Audit overlay merges at result-load time. Build script writes the canonical arm registry + per-arm artifact files.

**Deliverables:**
- New `computeMechanicalResult()` returning `{ score, pass_loose, pass_strict_raw, pass_strict_audited, pass }` per case
- Citation-extraction post-hoc helper for Claude CLI runs (corpus-index lookup when tool_calls is empty)
- `citation_quality` per result (to_expected, to_non_expected, broken_refs, total)
- Per-tier × per-category aggregation (7 categories × 2 tiers = up to 14 cells per arm)
- Audit overlay loader + `passByCitationsWithOverlay` helper, applied at result-load time
- Arms registry (`arms[]`) written into `eval-index.json`
- Per-arm artifact files (`apps/site/public/eval-arms/<arm_id>.json`) — minified JSON, one per arm
- Extended `armTagFromRunDir()` with longest-match-first ordering
- `eval-index.json` no longer contains the heavy answer text + tool traces (those go to per-arm files)

### Task 2.1: Add `computeMechanicalResult()` with fractional graded scoring

**Files:**
- Modify: `eval/build-eval-json.ts:227-255` (replace `computeMechanicalPass`)
- Test: `eval/__tests__/computeMechanicalResult.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `/Users/siraj/falsafa/eval/__tests__/computeMechanicalResult.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { computeMechanicalResult } from "../build-eval-json.ts";

describe("computeMechanicalResult — fractional graded scoring", () => {
  test("vacuous pass when expected_works is empty", () => {
    const r = computeMechanicalResult({
      answer: "anything",
      expected_works: [],
      citations: [],
    });
    expect(r.score).toBe(1.0);
    expect(r.pass_loose).toBe(true);
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass).toBe(true);
  });

  test("all expected cited → score=1.0, strict=true", () => {
    const r = computeMechanicalResult({
      answer: "Manu and Yajnavalkya say [p-aaa111] [p-bbb222].",
      expected_works: ["manusmrti", "yajnavalkya-smrti"],
      citations: [
        { work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" },
        { work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" },
      ],
    });
    expect(r.score).toBe(1.0);
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass_loose).toBe(true);
  });

  test("partial citations (3 of 6) → score=0.5", () => {
    const r = computeMechanicalResult({
      answer: "Manu, Yajnavalkya, Vishnu, Narada, Brihaspati, Parashara — citing [p-aaa111] [p-bbb222] [p-ccc333].",
      expected_works: ["manusmrti", "yajnavalkya-smrti", "vishnu-smrti", "narada-smrti", "brihaspati-smrti", "parashara-smrti"],
      citations: [
        { work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" },
        { work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" },
        { work_slug: "vishnu-smrti", chapter_number: 1, paragraph_id: "p-ccc333" },
      ],
    });
    expect(r.score).toBe(0.5);          // 3 of 6 cited
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_loose).toBe(true);    // all 6 names appear in prose
  });

  test("none cited but all named in prose → score=0, pass_loose=true", () => {
    const r = computeMechanicalResult({
      answer: "Manu and Yajnavalkya both discuss dharma.",
      expected_works: ["manusmrti", "yajnavalkya-smrti"],
      citations: [],
    });
    expect(r.score).toBe(0.0);
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_loose).toBe(true);
  });

  test("zero matches anywhere → score=0, all pass=false", () => {
    const r = computeMechanicalResult({
      answer: "Something completely off-topic.",
      expected_works: ["manusmrti"],
      citations: [],
    });
    expect(r.score).toBe(0.0);
    expect(r.pass_loose).toBe(false);
    expect(r.pass_strict_raw).toBe(false);
  });

  test("hallucinated citations (model cited works it shouldn't) don't pad the score", () => {
    const r = computeMechanicalResult({
      answer: "[p-zzz999]",
      expected_works: ["manusmrti"],
      citations: [
        // Model cited Yajnavalkya, but expected was Manusmriti
        { work_slug: "yajnavalkya-smrti", chapter_number: 1, paragraph_id: "p-zzz999" },
      ],
    });
    expect(r.score).toBe(0.0);          // 0 of 1 expected cited
    expect(r.pass_strict_raw).toBe(false);
  });

  test("audit overlay accepts alternative work_slug → pass_strict_audited=true", () => {
    const r = computeMechanicalResult({
      answer: "[p-zzz999]",
      expected_works: ["manusmrti"],
      citations: [
        { work_slug: "yajnavalkya-smrti", chapter_number: 1, paragraph_id: "p-zzz999" },
      ],
      auditOverlay: {
        // For this case, auditor decided Yajnavalkya counts as alternative
        decisions: { "q-test": { acceptable_alternatives: [["yajnavalkya-smrti"]] } },
      },
      caseId: "q-test",
    });
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_strict_audited).toBe(true);
  });

  test("audit overlay without matching case → audited === raw", () => {
    const r = computeMechanicalResult({
      answer: "Manu says [p-aaa111].",
      expected_works: ["manusmrti"],
      citations: [{ work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" }],
      auditOverlay: { decisions: {} },
      caseId: "q-no-decision",
    });
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass_strict_audited).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/computeMechanicalResult.test.ts 2>&1 | tail -15`

Expected: FAIL — `computeMechanicalResult is not exported` or `is not a function`.

- [ ] **Step 3: Locate the existing `computeMechanicalPass` and replace**

Read `eval/build-eval-json.ts:184-260` to see the existing helpers. The old `computeMechanicalPass(answer, expectedWorks, _citations)` currently returns `boolean` and ignores citations. Replace with `computeMechanicalResult` that returns a struct AND uses citations.

Edit `eval/build-eval-json.ts`. After the existing `passByCitations` and `passByProse` helpers (around line 226), add:

```ts
export interface MechanicalResult {
  score: number;                    // continuous 0-1: cited_expected / total_expected
  pass_loose: boolean;              // passByProse
  pass_strict_raw: boolean;         // passByCitations (no overlay)
  pass_strict_audited: boolean;     // passByCitationsWithOverlay (with overlay)
  pass: boolean;                    // === pass_loose, kept for back-compat
}

export interface AuditOverlay {
  decisions: Record<string, {
    verdict?: "valid_alternative" | "real_failure" | "skip";
    acceptable_alternatives?: string[][];  // OR-groups
    notes?: string;
    audited_at_iso?: string;
  }>;
}

export interface ComputeArgs {
  answer: string;
  expected_works: string[];
  citations: ResultCitation[];
  auditOverlay?: AuditOverlay;
  caseId?: string;
}

/**
 * Fractional graded score + four-axis pass booleans for one (case, model)
 * pair. Replaces the old binary computeMechanicalPass.
 *
 * Score formula:
 *   score = (count of expected_works with at least one matching citation)
 *           / expected_works.length
 *   if expected_works is empty, score = 1.0 (vacuous pass)
 *
 * Strict-audited applies the audit overlay's acceptable_alternatives (OR-groups)
 * when a decision exists for caseId; otherwise audited === raw.
 */
export function computeMechanicalResult(args: ComputeArgs): MechanicalResult {
  const { answer, expected_works, citations, auditOverlay, caseId } = args;

  if (expected_works.length === 0) {
    return {
      score: 1.0,
      pass_loose: true,
      pass_strict_raw: true,
      pass_strict_audited: true,
      pass: true,
    };
  }

  const cited_count = expected_works.filter((slug) =>
    citations.some((c) => c.work_slug === slug)
  ).length;
  const score = cited_count / expected_works.length;

  const pass_loose = passByProse(answer, expected_works);
  const pass_strict_raw = passByCitations(citations, expected_works);

  let pass_strict_audited = pass_strict_raw;
  if (!pass_strict_raw && auditOverlay && caseId) {
    pass_strict_audited = passByCitationsWithOverlay(citations, expected_works, auditOverlay, caseId);
  }

  return {
    score,
    pass_loose,
    pass_strict_raw,
    pass_strict_audited,
    pass: pass_loose,
  };
}

/**
 * Strict pass with audit overlay. Returns true if EITHER:
 *   (a) every expected_work has a citation (== passByCitations), OR
 *   (b) the case has a decision with verdict="valid_alternative" AND
 *       every group in acceptable_alternatives matches at least one
 *       cited work_slug.
 *
 * Group-AND across groups, member-OR within each group.
 */
function passByCitationsWithOverlay(
  citations: ResultCitation[],
  expected_works: string[],
  overlay: AuditOverlay,
  caseId: string,
): boolean {
  if (passByCitations(citations, expected_works)) return true;
  const decision = overlay.decisions[caseId];
  if (!decision || decision.verdict !== "valid_alternative" || !decision.acceptable_alternatives) {
    return false;
  }
  const cited = new Set(citations.map((c) => c.work_slug));
  for (const group of decision.acceptable_alternatives) {
    if (!group.some((slug) => cited.has(slug))) return false;
  }
  return true;
}
```

- [ ] **Step 4: Remove the old `computeMechanicalPass`**

Find the existing `function computeMechanicalPass(...)` body (around line 227-255 — already documented in the CEO plan as the function with the deadline-revert comment). Delete it. Update its callsites:

```bash
grep -n "computeMechanicalPass" /Users/siraj/falsafa/eval/build-eval-json.ts
```

For each callsite, replace the call with the new `computeMechanicalResult({...})` and use the returned struct. Specifically, the call around line 706 needs to change from:

```ts
result.mechanical_pass = computeMechanicalPass(answer, expected_works, citations);
```

To:

```ts
const mr = computeMechanicalResult({
  answer,
  expected_works,
  citations,
  auditOverlay,
  caseId: id,
});
result.mechanical_score = mr.score;
result.mechanical_pass = mr.pass;
result.mechanical_pass_loose = mr.pass_loose;
result.mechanical_pass_strict_raw = mr.pass_strict_raw;
result.mechanical_pass_strict_audited = mr.pass_strict_audited;
```

`auditOverlay` is loaded once at the top of `main()` before the per-result loop (Task 2.4). Pass it through.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/computeMechanicalResult.test.ts 2>&1 | tail -10`

Expected: 8 PASS, 0 FAIL.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts eval/__tests__/computeMechanicalResult.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): fractional graded score + four-axis mechanical pass

Replaces binary computeMechanicalPass(answer, expected, citations) →
boolean with computeMechanicalResult(args) → MechanicalResult struct
returning:
  score: continuous 0-1 = cited_count / expected_count (or 1.0 if
    expected is empty — vacuous pass)
  pass_loose: passByProse (substring match on prose)
  pass_strict_raw: passByCitations (every expected_work cited)
  pass_strict_audited: passByCitationsWithOverlay (raw OR audit
    overlay's acceptable_alternatives groups all matched)
  pass: === pass_loose, kept for back-compat with existing consumers

Why fractional, not 0/0.5/1.0: 560 of 1,120 cases expect more than
one work, with some expecting up to 6. A tri-state bucket would
collapse "cited 1 of 6" and "missed 1 of 6" into the same 0.5,
losing exactly the citation-discipline signal we're publishing.

passByCitationsWithOverlay locked via /plan-eng-review D3:
group-AND across acceptable_alternatives groups, member-OR within
each group. Question pool files (questions-revised-1000.json,
questions-discovery-v1.jsonl) are NEVER edited; the audit-decisions
overlay merges at build time only.

Tests: 8 cases covering vacuous pass, all-cited, partial 3-of-6,
all-named-not-cited, zero-match, hallucinated citations,
audit-accepted alternative, audit-without-matching-case.
EOF
)"
```

### Task 2.2: Post-hoc citation extraction for Claude CLI runs (corpus-index lookup)

**Files:**
- Modify: `eval/build-eval-json.ts` (add new helper `extractCitationsFromCorpus`)
- Test: `eval/__tests__/extract-citations-from-corpus.test.ts` (NEW)

**Why this is needed:** Claude CLI runs leave `tool_calls: []` because `claude --print --output-format json` doesn't expose per-tool-call breakdowns (Chunk 1 Task 1.4 schema-asymmetry note). When `build-eval-json.ts` loads such a run, citations[] is also empty. We extract citations post-hoc by scanning the answer text for `[p-xxxxxx]` tokens and looking up each one in the corpus paragraph_id index — which gives `(work_slug, chapter_number)` per token by table lookup.

- [ ] **Step 1: Locate the existing Corpus paragraph_id index access pattern**

Run: `grep -n "paragraph_id\|paragraphIndex\|corpus.paragraph" /Users/siraj/falsafa/apps/mcp/src/corpus.ts | head -20`

Expected: shows how the loaded Corpus exposes a paragraph_id → (work_slug, chapter_number) lookup. If no direct accessor exists, the helper builds it once by scanning `corpus.works().flatMap(w => w.chapters).flatMap(c => c.paragraphs)`.

- [ ] **Step 2: Write the failing test**

Create `/Users/siraj/falsafa/eval/__tests__/extract-citations-from-corpus.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractCitationsFromCorpus, buildParagraphIndex } from "../build-eval-json.ts";

describe("extractCitationsFromCorpus — Claude CLI fallback", () => {
  // Mock paragraph index for tests (real one comes from Corpus)
  const mockIndex = new Map<string, { work_slug: string; chapter_number: number }>([
    ["p-aaa111", { work_slug: "manusmrti", chapter_number: 1 }],
    ["p-bbb222", { work_slug: "yajnavalkya-smrti", chapter_number: 2 }],
    ["p-ccc333", { work_slug: "manusmrti", chapter_number: 1 }],
  ]);

  test("attributes paragraph_ids by corpus index lookup", () => {
    const cites = extractCitationsFromCorpus(
      "Manu says [p-aaa111] and Yajnavalkya says [p-bbb222].",
      mockIndex,
    );
    expect(cites).toHaveLength(2);
    expect(cites.find((c) => c.paragraph_id === "p-aaa111")?.work_slug).toBe("manusmrti");
    expect(cites.find((c) => c.paragraph_id === "p-bbb222")?.work_slug).toBe("yajnavalkya-smrti");
  });

  test("hallucinated paragraph_id (not in index) → work_slug=''", () => {
    const cites = extractCitationsFromCorpus(
      "Citing [p-zzzzzz] (model invented this).",
      mockIndex,
    );
    expect(cites).toHaveLength(1);
    expect(cites[0]?.work_slug).toBe("");
  });

  test("dedupes when same paragraph_id appears twice", () => {
    const cites = extractCitationsFromCorpus(
      "Quote 1: [p-aaa111]. Quote 2: [p-aaa111].",
      mockIndex,
    );
    expect(cites).toHaveLength(1);
  });

  test("empty answer → empty citations", () => {
    expect(extractCitationsFromCorpus("No citations here.", mockIndex)).toEqual([]);
  });

  test("multiple paragraph_ids from same work all attribute correctly", () => {
    const cites = extractCitationsFromCorpus(
      "Manu chapters [p-aaa111] and [p-ccc333].",
      mockIndex,
    );
    expect(cites).toHaveLength(2);
    expect(cites.every((c) => c.work_slug === "manusmrti")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/extract-citations-from-corpus.test.ts 2>&1 | tail -10`

Expected: FAIL — `extractCitationsFromCorpus is not exported`.

- [ ] **Step 4: Add the helper to `build-eval-json.ts`**

Near the existing citation helpers (around line 230 after `passByCitations`), add:

```ts
import { Corpus } from "../apps/mcp/src/corpus.ts";

/**
 * Build a paragraph_id → (work_slug, chapter_number) lookup table from
 * a loaded Corpus. Populated once at the start of the build script and
 * reused for every Claude CLI run that needs post-hoc citation extraction.
 */
export function buildParagraphIndex(corpus: Corpus): Map<string, { work_slug: string; chapter_number: number }> {
  const index = new Map<string, { work_slug: string; chapter_number: number }>();
  for (const work of corpus.works()) {
    for (const chapter of corpus.listChapters(work.slug)) {
      // readParagraphs requires a variant file. Loop over the variants the
      // chapter advertises (translation.paragraphs.json is the primary; some
      // chapters also have transliteration.paragraphs.json + original).
      // Index by paragraph_id from ALL variants — they share ids.
      const variantFiles = chapter.variants
        .filter((v) => v.kind === "translation" || v.kind === "transliteration")
        .map((v) => v.paragraphs_file)
        .filter((f): f is string => typeof f === "string");
      for (const vf of variantFiles) {
        try {
          for (const p of corpus.readParagraphs(work.slug, chapter.chapter_number, vf)) {
            // Same paragraph_id in different variants = same content origin.
            // First-write-wins preserves the work_slug + chapter_number tuple.
            if (!index.has(p.paragraph_id)) {
              index.set(p.paragraph_id, { work_slug: work.slug, chapter_number: chapter.chapter_number });
            }
          }
        } catch {
          // Variant file missing or malformed; skip and continue.
        }
      }
    }
  }
  return index;
}

/**
 * Post-hoc citation extraction for runners that don't expose per-tool-call
 * breakdowns (e.g., run-claude-cli.ts). Scans the answer text for
 * [p-xxxxxx] tokens and looks each one up in the paragraph index.
 *
 * Hallucinated paragraph_ids (not in index) return work_slug="" — the
 * strict-pass scorer treats those as non-expected.
 */
export function extractCitationsFromCorpus(
  answer: string,
  paragraphIndex: Map<string, { work_slug: string; chapter_number: number }>,
): ResultCitation[] {
  const tokens = Array.from(new Set(
    Array.from(answer.matchAll(/\bp-[0-9a-f]{6}\b/g)).map((m) => m[0])
  ));
  return tokens.map((paragraph_id) => {
    const prov = paragraphIndex.get(paragraph_id);
    return {
      work_slug: prov?.work_slug ?? "",
      chapter_number: prov?.chapter_number,
      paragraph_id,
    };
  });
}
```

(`corpus.chaptersOf(slug)` and `corpus.paragraphsOf(slug, chapter)` are existing methods on the Corpus class. If they're named differently in the live class, adapt — locate via `grep -n "chaptersOf\|chapters()\|paragraphsOf\|paragraphs()" /Users/siraj/falsafa/apps/mcp/src/corpus.ts | head` first.)

- [ ] **Step 5: Wire into the result-loading loop**

In `main()` (around line 670), after `corpus` is loaded, build the index once:

```ts
const corpus = new Corpus();
const paragraphIndex = buildParagraphIndex(corpus);
console.log(`  paragraph index: ${paragraphIndex.size} ids`);
```

In the result-loading loop (around line 700-710), before computing `mechanicalResult`, populate citations[] for runs where it's empty:

```ts
// For Claude CLI runs (and any other runner that produces empty citations[]),
// extract post-hoc from the answer text via corpus index.
let effectiveCitations = result.citations ?? [];
if (effectiveCitations.length === 0 && result.answer) {
  effectiveCitations = extractCitationsFromCorpus(result.answer, paragraphIndex);
}

const mr = computeMechanicalResult({
  answer: result.answer,
  expected_works: caseExpected,
  citations: effectiveCitations,
  auditOverlay,
  caseId: id,
});
```

Notice: we do NOT overwrite `result.citations` in the persisted JSON. The original empty array stays in the per-question file (it's the runner's authoritative output). Only the `mechanicalResult` computation uses the post-hoc extraction.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/extract-citations-from-corpus.test.ts 2>&1 | tail -10`

Expected: 5 PASS, 0 FAIL.

- [ ] **Step 7: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts eval/__tests__/extract-citations-from-corpus.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): post-hoc citation extraction for runners with empty tool_calls

Adds buildParagraphIndex(corpus) → paragraph_id Map and
extractCitationsFromCorpus(answer, index) → ResultCitation[] for
Claude CLI runs that don't expose per-tool-call breakdowns.

Wired into the result-loading loop: when a result's citations[] is
empty AND answer text contains [p-xxxxxx] tokens, citations are
reconstructed by corpus-index lookup. The original empty array
persists in the per-question file (runner authoritative); only the
mechanicalResult computation uses the post-hoc extraction.

Methodologically equivalent to per-tool-call provenance for the
strict-pass check (corpus is the ground truth: each paragraph_id
belongs to exactly one work). Slightly weaker for citation_quality
broken_refs (cannot detect "model called read_chapter X but cited Y").
Limitation acknowledged in paper Methodology section.

Tests: 5 cases covering attribution, hallucinated id, dedup, empty
answer, multiple paragraphs from same work.
EOF
)"
```

### Task 2.3: Citation-quality sub-metrics (`to_expected`, `to_non_expected`, `broken_refs`, `total`)

**Files:**
- Modify: `eval/build-eval-json.ts` (add `computeCitationQuality` helper + wire into result-loading)
- Test: `eval/__tests__/citation-quality.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests**

Create `/Users/siraj/falsafa/eval/__tests__/citation-quality.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { computeCitationQuality } from "../build-eval-json.ts";

describe("computeCitationQuality", () => {
  const mockIndex = new Map<string, { work_slug: string; chapter_number: number }>([
    ["p-aaa111", { work_slug: "manusmrti", chapter_number: 1 }],
    ["p-bbb222", { work_slug: "yajnavalkya-smrti", chapter_number: 2 }],
  ]);

  test("counts to_expected for citations matching expected_works", () => {
    const q = computeCitationQuality(
      [
        { work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" },
        { work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" },
      ],
      ["manusmrti"],
      mockIndex,
    );
    expect(q.to_expected).toBe(1);
    expect(q.to_non_expected).toBe(1);
    expect(q.broken_refs).toBe(0);
    expect(q.total).toBe(2);
  });

  test("counts broken_refs for paragraph_ids not in corpus", () => {
    const q = computeCitationQuality(
      [
        { work_slug: "", chapter_number: undefined, paragraph_id: "p-zzzzzz" },
      ],
      ["manusmrti"],
      mockIndex,
    );
    expect(q.to_expected).toBe(0);
    expect(q.to_non_expected).toBe(0);
    expect(q.broken_refs).toBe(1);
    expect(q.total).toBe(1);
  });

  test("zero citations → all counts zero", () => {
    const q = computeCitationQuality([], ["manusmrti"], mockIndex);
    expect(q).toEqual({ to_expected: 0, to_non_expected: 0, broken_refs: 0, total: 0 });
  });

  test("citation_quality always uses raw expected_works (ignores audit overlay)", () => {
    // Even though audit overlay might accept yajnavalkya as alternative,
    // citation_quality reports raw counts: yajnavalkya is to_non_expected.
    const q = computeCitationQuality(
      [{ work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" }],
      ["manusmrti"],  // raw expected, no overlay applied here
      mockIndex,
    );
    expect(q.to_expected).toBe(0);
    expect(q.to_non_expected).toBe(1);
  });

  test("a citation with empty work_slug AND a hallucinated paragraph_id is broken_refs", () => {
    const q = computeCitationQuality(
      [{ work_slug: "", chapter_number: undefined, paragraph_id: "p-zzzzzz" }],
      ["manusmrti"],
      mockIndex,
    );
    expect(q.broken_refs).toBe(1);
    expect(q.to_non_expected).toBe(0);  // empty work_slug doesn't count as non-expected
  });

  test("a citation with valid paragraph_id but empty work_slug counts to_non_expected based on lookup", () => {
    // Edge: runner produced work_slug="" but paragraph_id IS in corpus.
    // citation_quality looks up the paragraph_id and uses the corpus's authoritative work_slug.
    const q = computeCitationQuality(
      [{ work_slug: "", chapter_number: undefined, paragraph_id: "p-aaa111" }],
      ["yajnavalkya-smrti"],  // expected != manusmrti
      mockIndex,
    );
    expect(q.to_expected).toBe(0);
    expect(q.to_non_expected).toBe(1);  // p-aaa111 is in manusmrti per the index
    expect(q.broken_refs).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/citation-quality.test.ts 2>&1 | tail -10`

Expected: FAIL — `computeCitationQuality is not exported`.

- [ ] **Step 3: Add the helper**

In `eval/build-eval-json.ts`, after `extractCitationsFromCorpus`:

```ts
export interface CitationQuality {
  to_expected: number;       // citations whose work_slug ∈ expected_works
  to_non_expected: number;   // citations whose work_slug NOT in expected_works
  broken_refs: number;       // paragraph_ids not in the corpus index
  total: number;             // citations.length
}

/**
 * Compute citation_quality sub-metrics for one (case, model) pair.
 *
 * IMPORTANT: always uses RAW expected_works, never the audit overlay's
 * acceptable_alternatives. A case can simultaneously have
 * mechanical_pass_strict_audited=true (audit accepted alternatives) AND
 * citation_quality.to_expected=0 + to_non_expected>0 (raw citation behavior).
 * Both numbers tell different parts of the same story; readers see both.
 *
 * broken_refs: paragraph_ids not in the corpus paragraph index (model
 * hallucinated them or the runner attributed them to work_slug="" with
 * no corresponding corpus entry).
 */
export function computeCitationQuality(
  citations: ResultCitation[],
  expected_works: string[],
  paragraphIndex: Map<string, { work_slug: string; chapter_number: number }>,
): CitationQuality {
  const expected = new Set(expected_works);
  let to_expected = 0;
  let to_non_expected = 0;
  let broken_refs = 0;

  for (const c of citations) {
    const idx = paragraphIndex.get(c.paragraph_id);
    if (!idx) {
      broken_refs++;
      continue;
    }
    // Use the corpus-authoritative work_slug from the index, not c.work_slug.
    // This handles edge case: runner produced work_slug="" but paragraph_id is real.
    if (expected.has(idx.work_slug)) {
      to_expected++;
    } else {
      to_non_expected++;
    }
  }

  return { to_expected, to_non_expected, broken_refs, total: citations.length };
}
```

- [ ] **Step 4: Wire into the result-loading loop**

After `mechanicalResult` is computed (Task 2.1 Step 4), add:

```ts
result.citation_quality = computeCitationQuality(
  effectiveCitations,
  caseExpected,
  paragraphIndex,
);
```

The `result` object (typed as `OutResult` or similar in build-eval-json) needs the new `citation_quality?: CitationQuality` field. Locate the existing `interface OutResult` and add it:

```ts
interface OutResult {
  // ...existing fields...
  mechanical_score?: number;
  mechanical_pass_loose?: boolean;
  mechanical_pass_strict_raw?: boolean;
  mechanical_pass_strict_audited?: boolean;
  citation_quality?: CitationQuality;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/citation-quality.test.ts 2>&1 | tail -10`

Expected: 6 PASS, 0 FAIL.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts eval/__tests__/citation-quality.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): citation_quality sub-metrics per (case, model)

Adds computeCitationQuality(citations, expected_works, paragraphIndex)
returning { to_expected, to_non_expected, broken_refs, total }.

Always uses raw expected_works, never the audit overlay's
acceptable_alternatives — a case can simultaneously have
mechanical_pass_strict_audited=true AND citation_quality.to_expected=0
because the metrics tell different stories. The audit overlay is a
scoring rule; citation_quality reports raw citation behavior.

broken_refs detection uses corpus paragraph index (no HTTP). For runs
where the runner produced work_slug="" but paragraph_id IS in corpus,
the corpus-authoritative work_slug is used (handles Claude CLI's
post-hoc extraction edge case where work_slug is reconstructed).

Tests: 6 cases covering basic counts, broken_refs, zero citations,
audit-overlay independence, hallucinated paragraph_id with empty
work_slug, valid paragraph_id with empty runner-side work_slug.
EOF
)"
```

### Task 2.4: Audit overlay loader + fail-fast on malformed JSON

**Files:**
- Modify: `eval/build-eval-json.ts` (add `loadAuditOverlay()` + wire into `main()`)
- Create: `eval/audit-decisions.json` (initial empty stub committed)

- [ ] **Step 1: Create the initial empty audit-decisions file**

```bash
cd /Users/siraj/falsafa
cat > eval/audit-decisions.json <<'EOF'
{
  "version": 1,
  "audited_at_iso": "2026-05-02T00:00:00Z",
  "auditor": "(not yet audited)",
  "decisions": {}
}
EOF
```

This is the initial stub. The audit-candidates.ts CLI in Chunk 4 populates `decisions` after human review.

- [ ] **Step 2: Add the loader with fail-fast error handling**

In `eval/build-eval-json.ts`, after the `AuditOverlay` interface from Task 2.1, add:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load eval/audit-decisions.json. Returns an empty overlay if the file
 * doesn't exist (fresh repo) or has an empty decisions object.
 *
 * Fails FAST with a labeled error on malformed JSON — don't let it crash
 * mid-aggregation with a stack trace. Locked via /plan-eng-review D9.
 */
export function loadAuditOverlay(repoRoot: string): AuditOverlay {
  const path = resolve(repoRoot, "eval/audit-decisions.json");
  if (!existsSync(path)) {
    return { decisions: {} };
  }
  const raw = readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(raw) as AuditOverlay;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.decisions !== "object") {
      throw new Error("audit-decisions.json missing required `decisions` object");
    }
    return parsed;
  } catch (err) {
    console.error(`[eval] FATAL: ${path} is malformed: ${(err as Error).message}`);
    console.error(`[eval] Fix: validate with \`bun run -e "JSON.parse(require('fs').readFileSync('${path}','utf8'))"\``);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Wire into `main()`**

Near the top of `main()` (after `flags = parseFlags()`), load the overlay:

```ts
const repoRoot = resolve(import.meta.dir, "..");
const auditOverlay = loadAuditOverlay(repoRoot);
console.log(`  audit overlay: ${Object.keys(auditOverlay.decisions).length} decisions`);
```

Pass `auditOverlay` to the result-loading loop (already referenced in Task 2.1 Step 4 + Task 2.2 Step 5).

- [ ] **Step 4: Verify the build still runs end-to-end**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts --out /tmp/eval-test.json 2>&1 | tail -10
```

Expected: build runs, prints `audit overlay: 0 decisions` (since the stub is empty), produces `/tmp/eval-test.json`.

If it fails, fix any syntax / missing-import errors before continuing.

- [ ] **Step 5: Verify malformed JSON triggers fail-fast**

```bash
cd /Users/siraj/falsafa
echo 'this is not json' > eval/audit-decisions.json
bun run eval/build-eval-json.ts --out /tmp/eval-test.json 2>&1 | head -3
```

Expected: `[eval] FATAL: ...audit-decisions.json is malformed: ...`. Exit code 1.

Restore: `git checkout eval/audit-decisions.json`.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts eval/audit-decisions.json
git commit -m "$(cat <<'EOF'
feat(eval): audit-decisions.json overlay loader with fail-fast on malformed JSON

Adds loadAuditOverlay(repoRoot) that reads eval/audit-decisions.json
and returns the parsed overlay (or empty if file missing). Wired into
main() so the overlay is loaded once at the top and threaded through
the result-loading loop.

Fail-fast on malformed JSON: prints a labeled FATAL error with a
copy-paste command to validate the file, then exits 1. Don't let it
crash mid-aggregation with an opaque stack trace. Locked via
/plan-eng-review D9 (Section 2 finding).

Initial audit-decisions.json: stub with empty decisions object.
audit-candidates.ts CLI in Chunk 4 populates decisions after human
review.

Question pool files (questions-revised-1000.json,
questions-discovery-v1.jsonl) are NEVER edited by the audit pipeline;
the overlay merges at build time only.
EOF
)"
```

### Task 2.5: Per-tier × per-category aggregation + extended `armTagFromRunDir`

**Files:**
- Modify: `eval/build-eval-json.ts` (rewrite armTagFromRunDir + add per-tier-category aggregation)
- Test: `eval/__tests__/armTagFromRunDir.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests for armTagFromRunDir**

Create `/Users/siraj/falsafa/eval/__tests__/armTagFromRunDir.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { armTagFromRunDir } from "../build-eval-json.ts";

describe("armTagFromRunDir — longest-match-first ordering", () => {
  test.each([
    ["grok-4.1-fast-baseline-20260427-093322", "baseline"],
    ["grok-4.1-fast-treatment-wiki-20260427-094000", "treatment-wiki"],
    ["grok-4.1-fast-with-wiki-20260501-100000", "wiki"],
    ["grok-4.1-fast-strict-prompt-20260502-090000", "strict-prompt"],
    ["sonnet-4.6-via-mcp-20260502-090000", "sonnet-via-mcp"],
    ["haiku-4.5-via-mcp-20260502-090000", "haiku-via-mcp"],
    ["gemini-flash-lite-baseline-20260502-090000", "gemini-flash-lite"],
    ["gpt-5-nano-baseline-20260502-090000", "gpt-5-nano"],
    ["grok-discovery-1-20260430-120000", "baseline"],
    ["unknown-model-20260502-090000", "unknown"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(armTagFromRunDir(input)).toBe(expected);
  });

  test("longest-match-first prevents 'sonnet' from matching haiku-via-mcp directories", () => {
    // 'haiku-via-mcp' is more specific than 'haiku'; pattern table puts it first.
    expect(armTagFromRunDir("haiku-4.5-via-mcp-NNN")).toBe("haiku-via-mcp");
    expect(armTagFromRunDir("sonnet-4.6-via-mcp-NNN")).toBe("sonnet-via-mcp");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/armTagFromRunDir.test.ts 2>&1 | tail -10`

Expected: most tests FAIL (existing armTagFromRunDir uses different patterns / first-match-wins).

- [ ] **Step 3: Replace `armTagFromRunDir` with longest-match-first**

In `eval/build-eval-json.ts:520-532`, replace the existing function with:

```ts
const ARM_TAG_PATTERNS = [
  // Longest substrings first. Order matters.
  { pattern: "haiku-4.5-baseline", tag: "haiku-baseline" },
  { pattern: "sonnet-4.6-baseline", tag: "sonnet-baseline" },
  { pattern: "haiku-via-mcp", tag: "haiku-via-mcp" },
  { pattern: "sonnet-via-mcp", tag: "sonnet-via-mcp" },
  { pattern: "gemini-flash-lite", tag: "gemini-flash-lite" },
  { pattern: "gpt-5-nano", tag: "gpt-5-nano" },
  { pattern: "strict-prompt", tag: "strict-prompt" },
  { pattern: "treatment-wiki", tag: "treatment-wiki" },
  { pattern: "with-wiki", tag: "wiki" },
  { pattern: "nowiki", tag: "baseline" },
  { pattern: "treatment", tag: "treatment-wiki" },
  { pattern: "baseline", tag: "baseline" },
  { pattern: "grok-discovery-", tag: "baseline" },  // legacy alias
] as const;

export function armTagFromRunDir(d: string): string {
  const lc = d.toLowerCase();
  for (const { pattern, tag } of ARM_TAG_PATTERNS) {
    if (lc.includes(pattern)) return tag;
  }
  return "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/siraj/falsafa && bun test eval/__tests__/armTagFromRunDir.test.ts 2>&1 | tail -10`

Expected: 11 PASS, 0 FAIL (10 `test.each` rows + 1 longest-match-first standalone).

- [ ] **Step 5: Add per-tier × per-category aggregation**

After the per-arm aggregation block in `main()`, add:

```ts
// Per-tier × per-category aggregation. 7 categories × 2 tiers = up to 14 cells per arm.
type CategoryStats = {
  case_count: number;
  score_sum: number;
  pass_count_loose: number;
  pass_count_strict_raw: number;
  pass_count_strict_audited: number;
  citation_quality: { to_expected: number; to_non_expected: number; broken_refs: number; total: number };
};

type TierCategoryAgg = Record<"named" | "hidden" | "uncategorized", Record<string, CategoryStats>>;

function emptyCategoryStats(): CategoryStats {
  return {
    case_count: 0,
    score_sum: 0,
    pass_count_loose: 0,
    pass_count_strict_raw: 0,
    pass_count_strict_audited: 0,
    citation_quality: { to_expected: 0, to_non_expected: 0, broken_refs: 0, total: 0 },
  };
}

for (const [armId, armResults] of Object.entries(perArmResults)) {
  const tierCat: TierCategoryAgg = { named: {}, hidden: {}, uncategorized: {} };

  for (const [caseId, result] of Object.entries(armResults)) {
    const seedCase = catalogue.get(caseId);
    const tier = (seedCase?.tier ?? "uncategorized") as keyof TierCategoryAgg;
    const cat = seedCase?.category ?? "uncategorized";

    tierCat[tier][cat] ??= emptyCategoryStats();
    const cell = tierCat[tier][cat];

    cell.case_count++;
    cell.score_sum += result.mechanical_score ?? 0;
    if (result.mechanical_pass_loose) cell.pass_count_loose++;
    if (result.mechanical_pass_strict_raw) cell.pass_count_strict_raw++;
    if (result.mechanical_pass_strict_audited) cell.pass_count_strict_audited++;
    if (result.citation_quality) {
      cell.citation_quality.to_expected += result.citation_quality.to_expected;
      cell.citation_quality.to_non_expected += result.citation_quality.to_non_expected;
      cell.citation_quality.broken_refs += result.citation_quality.broken_refs;
      cell.citation_quality.total += result.citation_quality.total;
    }
  }

  perArmAggregations[armId].per_tier_category = tierCat;
}

// Log a warn line if any case landed in "uncategorized" tier (per /plan-eng-review D9 finding 11)
let uncategorizedCount = 0;
for (const [caseId, c] of catalogue.entries()) {
  if (!c.category) uncategorizedCount++;
}
if (uncategorizedCount > 0) {
  console.warn(`  [warn] ${uncategorizedCount} cases without category — counted under 'uncategorized'`);
}

// ALSO emit arm-level aggregations alongside per-tier-category. This is
// what /numbers and /thesis read at build time to render the headline
// graded score per arm. Field shape locked here so Chunk 3 Task 3.6 can
// rely on it.
for (const [armId, armResults] of Object.entries(perArmResults)) {
  let case_count = 0;
  let score_sum = 0;
  let pass_count_loose = 0;
  let pass_count_strict_raw = 0;
  let pass_count_strict_audited = 0;
  let total_cost_usd = 0;
  const cqAgg = { to_expected: 0, to_non_expected: 0, broken_refs: 0, total: 0 };

  for (const result of Object.values(armResults)) {
    case_count++;
    score_sum += result.mechanical_score ?? 0;
    if (result.mechanical_pass_loose) pass_count_loose++;
    if (result.mechanical_pass_strict_raw) pass_count_strict_raw++;
    if (result.mechanical_pass_strict_audited) pass_count_strict_audited++;
    total_cost_usd += result.usage?.cost_usd ?? 0;
    if (result.citation_quality) {
      cqAgg.to_expected += result.citation_quality.to_expected;
      cqAgg.to_non_expected += result.citation_quality.to_non_expected;
      cqAgg.broken_refs += result.citation_quality.broken_refs;
      cqAgg.total += result.citation_quality.total;
    }
  }

  perArmAggregations[armId] = {
    ...(perArmAggregations[armId] ?? {}),
    case_count,
    score_sum,
    graded_score: case_count > 0 ? score_sum / case_count : 0,
    pass_count_loose,
    pass_count_strict_raw,
    pass_count_strict_audited,
    total_cost_usd,
    citation_quality: cqAgg,
    // per_tier_category set by the loop above
  };
}
```

- [ ] **Step 6: Verify the build produces per-tier-category data**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts --out /tmp/eval-test.json 2>&1 | tail -5
jq '.models[0] | .per_tier_category | keys' /tmp/eval-test.json 2>&1 | head
```

Expected: `["hidden", "named", "uncategorized"]` (or just `["hidden", "named"]` if every case has a tier — which is the current state). Inspect the structure:

```bash
jq '.models[0].per_tier_category.named | keys' /tmp/eval-test.json
```

Expected: 7 categories (citation, comparative, conceptual, cross-cultural, multilingual, specific-obscure, thematic).

- [ ] **Step 7: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts eval/__tests__/armTagFromRunDir.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): per-tier × per-category aggregation + longest-match-first armTagFromRunDir

armTagFromRunDir() rewrite per /plan-eng-review D4: substring patterns
ordered longest-first so e.g. 'haiku-via-mcp' is matched before plain
'haiku'. New patterns added for the 9-arm matrix: strict-prompt,
sonnet-via-mcp, haiku-via-mcp, gemini-flash-lite, gpt-5-nano. Existing
patterns preserved: baseline, treatment-wiki, with-wiki, treatment,
grok-discovery- (legacy alias). Returns 'unknown' for unrecognized
run-dir names.

Per-tier × per-category aggregation produces up to 14 cells per arm
(7 categories × 2 tiers). Cases without a category bucket as
'uncategorized' (logged as warn, not silently dropped) per
/plan-eng-review D9 finding 11. Each cell carries score_sum,
pass_count_loose/strict_raw/strict_audited, case_count, and aggregated
citation_quality counts.

Tests: 12 cases for armTagFromRunDir covering all new patterns + the
specific 'haiku-via-mcp must beat plain haiku' invariant.
EOF
)"
```

### Task 2.6: Build canonical `arms[]` registry into `eval-index.json`

**Files:**
- Modify: `eval/build-eval-json.ts` (derive arm metadata from run-dir + emit arms[])
- Test: extend `eval/__tests__/armTagFromRunDir.test.ts` with a registry-build test

This task implements /plan-eng-review D2: single source of truth for the arm registry, derived server-side from run-dir names + per-arm metadata.

- [ ] **Step 1: Define the `Arm` type**

In `eval/build-eval-json.ts`, near the existing types:

```ts
export interface Arm {
  id: string;                                                // canonical id, e.g. "sonnet-via-mcp"
  lab: "xAI" | "Anthropic" | "Google" | "OpenAI" | "OSS";
  model: string;                                             // display name, e.g. "Sonnet 4.6"
  treatment: "wiki" | "baseline" | "strict-prompt";
  tier: "headline" | "methodology";
  transport: "openrouter" | "claude-cli";
  label: string;                                             // human-readable, e.g. "Sonnet 4.6 (via npm)"
}
```

- [ ] **Step 2: Add the arm-derivation function**

```ts
const ARM_METADATA: Record<string, Omit<Arm, "id">> = {
  // Headline tier (5 wiki arms)
  "wiki": {
    lab: "xAI", model: "Grok 4.1 Fast", treatment: "wiki",
    tier: "headline", transport: "openrouter", label: "Grok 4.1 Fast (wiki)",
  },
  "treatment-wiki": {  // legacy alias for grok wiki arm
    lab: "xAI", model: "Grok 4.1 Fast", treatment: "wiki",
    tier: "headline", transport: "openrouter", label: "Grok 4.1 Fast (wiki)",
  },
  "sonnet-via-mcp": {
    lab: "Anthropic", model: "Sonnet 4.6", treatment: "wiki",
    tier: "headline", transport: "claude-cli", label: "Sonnet 4.6 (via npm)",
  },
  "haiku-via-mcp": {
    lab: "Anthropic", model: "Haiku 4.5", treatment: "wiki",
    tier: "headline", transport: "claude-cli", label: "Haiku 4.5 (via npm)",
  },
  "gemini-flash-lite": {
    lab: "Google", model: "Gemini 2.5 Flash Lite", treatment: "wiki",
    tier: "headline", transport: "openrouter", label: "Gemini 2.5 Flash Lite",
  },
  "gpt-5-nano": {
    lab: "OpenAI", model: "gpt-5-nano", treatment: "wiki",
    tier: "headline", transport: "openrouter", label: "gpt-5-nano",
  },

  // Methodology tier (4 counterfactual arms)
  "baseline": {
    lab: "xAI", model: "Grok 4.1 Fast", treatment: "baseline",
    tier: "methodology", transport: "openrouter", label: "Grok 4.1 Fast (baseline)",
  },
  "strict-prompt": {
    lab: "xAI", model: "Grok 4.1 Fast", treatment: "strict-prompt",
    tier: "methodology", transport: "openrouter", label: "Grok 4.1 Fast (strict prompt)",
  },
  // Sonnet/Haiku baseline arms get distinct armTags via run-dir naming convention:
  //   sonnet-4.6-baseline-NNN  (no "via-mcp" substring) → "sonnet-baseline" tag
  //   haiku-4.5-baseline-NNN                            → "haiku-baseline" tag
  // We need patterns for those too. Add to ARM_TAG_PATTERNS in Task 2.5:
  //   { pattern: "sonnet-4.6-baseline", tag: "sonnet-baseline" },
  //   { pattern: "haiku-4.5-baseline",  tag: "haiku-baseline" },
};

/**
 * Build the canonical arms[] registry from the loaded run dirs. Each
 * run-dir → armTag → ARM_METADATA lookup → Arm record. Skips run dirs
 * with armTag="unknown" (logs a warn).
 */
export function buildArmsRegistry(runDirs: string[]): Arm[] {
  const seen = new Set<string>();
  const arms: Arm[] = [];
  for (const d of runDirs) {
    const tag = armTagFromRunDir(d);
    if (tag === "unknown") {
      console.warn(`  [warn] unknown armTag for run dir '${d}' — skipping in registry`);
      continue;
    }
    if (seen.has(tag)) continue;
    const meta = ARM_METADATA[tag];
    if (!meta) {
      console.warn(`  [warn] no ARM_METADATA for tag '${tag}' — skipping`);
      continue;
    }
    seen.add(tag);
    arms.push({ id: tag, ...meta });
  }
  return arms;
}
```

(Task 2.5's `ARM_TAG_PATTERNS` already includes `sonnet-4.6-baseline` and `haiku-4.5-baseline` patterns mapped to `sonnet-baseline` / `haiku-baseline` tags. Just add the matching `ARM_METADATA` entries:)

```ts
"sonnet-baseline": {
  lab: "Anthropic", model: "Sonnet 4.6", treatment: "baseline",
  tier: "methodology", transport: "claude-cli", label: "Sonnet 4.6 (baseline)",
},
"haiku-baseline": {
  lab: "Anthropic", model: "Haiku 4.5", treatment: "baseline",
  tier: "methodology", transport: "claude-cli", label: "Haiku 4.5 (baseline)",
},
```

- [ ] **Step 3: Wire into the index emission**

In `main()` near where eval-index.json is written, build and include the registry:

```ts
const arms = buildArmsRegistry(runs.map((r) => r.runDir));
const indexJson = {
  version: 2,                          // bump from 1; signals new arms[] field
  generated_at: new Date().toISOString(),
  arms,
  cases: indexCases,
  models: indexModels,                 // keep for backwards compat
};
writeFileSync(resolve(repoRoot, "apps/site/public/eval-index.json"), JSON.stringify(indexJson));
console.log(`  wrote eval-index.json: ${arms.length} arms registered`);
```

- [ ] **Step 4: Verify**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts 2>&1 | tail -5
jq '.arms | length, .arms[0]' apps/site/public/eval-index.json
```

Expected: integer count, then a sample Arm record with id/lab/model/treatment/tier/transport/label.

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts
git commit -m "$(cat <<'EOF'
feat(eval): canonical arms[] registry in eval-index.json

Build script derives the arm registry from run-dir → armTag → ARM_METADATA
and emits an arms[] array at the top level of eval-index.json. The site
explorer reads the registry at mount; no separate registry file, no
risk of drift between build and runtime. Locked via /plan-eng-review D2.

Each Arm record: { id, lab, model, treatment, tier, transport, label }.
Unknown run-dirs get logged warn + skipped (won't crash the build but
visible in CI logs).

eval-index.json schema bumped to version=2 to signal the new arms[]
field. Existing models[] field kept for backwards compat during the
site-rebuild transition (Chunk 3).

ARM_METADATA covers the full 9-arm matrix:
  Headline: grok-wiki, sonnet-via-mcp, haiku-via-mcp, gemini-flash-lite, gpt-5-nano
  Methodology: grok-baseline, grok-strict-prompt, sonnet-baseline, haiku-baseline
EOF
)"
```

### Task 2.7: Per-arm artifact split (write `eval-arms/<arm_id>.json`)

**Files:**
- Modify: `eval/build-eval-json.ts` (split eval.json into per-arm files)
- Modify: `apps/site/public/eval.json` (remove; replaced by per-arm files)
- Create directory: `apps/site/public/eval-arms/`

- [ ] **Step 1: Write the per-arm files**

In `main()` after the per-arm aggregation block, write each arm's case results to its own file:

```ts
import { mkdirSync } from "node:fs";

const armsDir = resolve(repoRoot, "apps/site/public/eval-arms");
mkdirSync(armsDir, { recursive: true });

for (const arm of arms) {
  const armResults = perArmResults[arm.id] ?? {};
  const armCases = Object.entries(armResults).map(([caseId, result]) => ({
    id: caseId,
    ...result,
  }));
  const armJson = {
    version: 2,
    arm_id: arm.id,
    arm_metadata: arm,
    aggregations: perArmAggregations[arm.id],
    cases: armCases,
  };
  // Minified (no whitespace) — Vercel applies brotli on serve.
  writeFileSync(
    resolve(armsDir, `${arm.id}.json`),
    JSON.stringify(armJson),
  );
}
console.log(`  wrote ${arms.length} per-arm files to eval-arms/`);

// Remove the legacy eval.json (no backward-compat redirect)
const legacyPath = resolve(repoRoot, "apps/site/public/eval.json");
if (existsSync(legacyPath)) {
  unlinkSync(legacyPath);
  console.log(`  removed legacy eval.json`);
}
```

(Imports: `unlinkSync` from `node:fs`.)

- [ ] **Step 2: Strip heavy fields from eval-index.json case entries**

The slim index should NOT carry answer text + tool traces. Update where `indexCases` is built:

```ts
const indexCases = Array.from(catalogue.values()).map((c) => ({
  id: c.id,
  category: c.category,
  difficulty: c.difficulty,
  prompt: c.prompt,
  expected_works: c.expected_works,
  tier: c.tier,                    // PRESERVED per /plan-eng-review codex finding #2
  // No `results` field; per-case detail goes to per-arm files.
}));
```

- [ ] **Step 3: Verify file sizes**

```bash
cd /Users/siraj/falsafa
ls -lh apps/site/public/eval-arms/ apps/site/public/eval-index.json 2>&1 | head
```

Expected: `eval-index.json` < 1 MB, each `eval-arms/<arm>.json` 3-6 MB raw.

```bash
# Verify gzip wire size (Vercel default brotli applies in production)
node -e "const fs=require('fs');const z=require('zlib');for(const f of fs.readdirSync('apps/site/public/eval-arms')){const j=fs.readFileSync('apps/site/public/eval-arms/'+f);console.log(f,'raw='+j.length,'gz='+z.gzipSync(j).length)}"
```

Expected: gzipped sizes ~0.5-1 MB per arm.

- [ ] **Step 4: Verify the eval explorer still loads (will break! Chunk 3 fixes it)**

```bash
cd /Users/siraj/falsafa
curl -sI https://www.falsafa.ai/eval/ 2>&1 | head -3 || echo "(deploy hasn't fired yet)"
```

The deployed explorer will 404 on `/eval.json` once this lands. That's expected — Chunk 3 rewires the explorer to read `eval-index.json` + `eval-arms/<arm>.json`. The only safe time to land Chunk 2 Task 2.7 + Chunk 3 together is in adjacent commits OR behind a feature flag.

**For implementation**: defer Task 2.7 until Chunk 3 lands. Mark this task as DONE-LOCALLY-NOT-PUSHED. Push the eval-arms/ files together with the explorer rewrite.

Practically: implement Task 2.7's code changes locally + commit them, but DO NOT `git push origin main` until Chunk 3 Task 3.X (explorer rewrite) is also committed. The push of both happens together, deploys atomically.

- [ ] **Step 5: Commit (not pushed yet)**

```bash
cd /Users/siraj/falsafa
git add eval/build-eval-json.ts apps/site/public/eval-arms apps/site/public/eval-index.json
git rm apps/site/public/eval.json 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(eval): split eval.json into eval-index.json + per-arm files

Build script writes:
  apps/site/public/eval-index.json      slim metadata + arms[] + per-arm summary stats (~1 MB)
  apps/site/public/eval-arms/<arm>.json one per arm with case results (~3-6 MB raw, ~0.5-1 MB gz)

Removes the monolithic eval.json (was 18 MB at 2 arms; would not scale
to 11). No backwards-compat redirect — the explorer rewrite in Chunk 3
reads the new layout directly.

Minified JSON write (no whitespace) for ~30% size reduction at write
time; Vercel default brotli on serve gets another 70-80%. Effective
wire size per arm: ~0.5-1 MB.

DO NOT PUSH this commit until Chunk 3 Task 3.X (explorer rewrite)
lands — the deployed site will 404 on /eval.json until then. Push
both together so the deploy is atomic.

Plan: docs/superpowers/plans/2026-05-01-eval-scoring-rework-implementation.md
Locked via /plan-eng-review D6 + codex finding #9.
EOF
)"
```

---

## Chunk 2 Done Criteria

- [ ] All 7 tasks committed (7 commits — Tasks 2.1 through 2.7)
- [ ] `bun test eval/__tests__/computeMechanicalResult.test.ts` — 8 PASS
- [ ] `bun test eval/__tests__/extract-citations-from-corpus.test.ts` — 5 PASS
- [ ] `bun test eval/__tests__/citation-quality.test.ts` — 6 PASS
- [ ] `bun test eval/__tests__/armTagFromRunDir.test.ts` — 11 PASS
- [ ] `bun run eval/build-eval-json.ts` runs end-to-end with the existing 2 Grok arms — produces eval-index.json + eval-arms/baseline.json + eval-arms/wiki.json (or treatment-wiki.json depending on existing run-dir name)
- [ ] `jq '.arms | length' apps/site/public/eval-index.json` returns the count of run-dirs found (with current state, that's 2)
- [ ] `jq '.models[0].per_tier_category | keys' apps/site/public/eval-index.json` returns at least `["named", "hidden"]` (or includes "uncategorized" if any cases lack tier)
- [ ] No regressions: `bun test 2>&1 | tail -5` shows only the new tests' line counts added; existing tests pass
- [ ] Task 2.7 commit is LOCAL ONLY — not pushed to origin/main yet (explicit reminder in commit message)

**What this chunk unblocks:** Chunk 3 (the site reads the new schema). Until Chunk 3 lands, the deployed eval explorer is broken — that's why Task 2.7 is held in local commits.

**Schema invariants for the next chunk:**
- `eval-index.json.arms[]` is the canonical arm registry; the site reads it at mount, no separate file
- `eval-index.json.cases[]` carries metadata only — no answer text, no tool traces
- `eval-arms/<arm_id>.json` has full per-arm case results: answer, citations, mechanical_score, mechanical_pass_*, citation_quality
- `eval-arms/<arm_id>.json.aggregations.per_tier_category` is up to 14 cells (7 categories × 2 tiers + uncategorized)

---

## Chunk 3: Site rebuild (eval-arms registry consumer + 4 URL surfaces + per-arm lazy fetch)

**Why third:** Chunks 1+2 produced the new schema + per-arm files. Chunk 3 rewires the site to read them. The deployed eval explorer is broken between Chunk 2 push and Chunk 3 push — these MUST land together. Chunk 3 + Chunk 2 Task 2.7 push as one atomic deploy.

**Deliverables:**
- `apps/site/src/lib/eval-types.ts` extended with the new four-axis fields + accessors
- `apps/site/src/lib/eval-arms.ts` rewritten for N-arm support (preserving the 2-arm flips-* filter as a special case)
- `apps/site/src/islands/eval-explorer/EvalExplorer.tsx` rebuilt: multi-arm scoreboard, lazy-fetch state machine, filter-by-lab, per-arm pending pills
- `apps/site/src/pages/eval/index.astro` rewritten to render the 5-arm headline leaderboard
- `apps/site/src/pages/eval/compare.astro` (NEW) for multi-select 2-4 arm deep-dive
- `apps/site/src/pages/eval/methodology.astro` (NEW) for counterfactual sub-sections
- `apps/site/src/pages/eval/[id].astro` modified to read per-arm files via `import.meta.glob` at Astro build time
- Existing `single-arm-regression.test.ts` MUST keep passing (iron-rule)

### Task 3.1: Extend `EvalCaseResult` type + add accessors

**Files:**
- Modify: `apps/site/src/lib/eval-types.ts:80-180`
- Test: `apps/site/src/lib/__tests__/eval-types.test.ts` (NEW)

- [ ] **Step 1: Add the new fields to the type**

In `apps/site/src/lib/eval-types.ts`, locate the `EvalCaseResult` interface (line ~80-100). Extend it:

```ts
export interface EvalCaseResult {
  // ...existing fields preserved (mechanical_pass, judge, usage, etc.)...

  // NEW: four-axis scoring (additive — old consumers reading mechanical_pass keep working)
  mechanical_score?: number;                  // continuous 0-1 (graded headline)
  mechanical_pass_loose?: boolean;            // === mechanical_pass when present
  mechanical_pass_strict_raw?: boolean;       // every expected_work cited
  mechanical_pass_strict_audited?: boolean;   // raw OR audit-overlay accepts alternatives
  citation_quality?: {
    to_expected: number;
    to_non_expected: number;
    broken_refs: number;
    total: number;
  };
}
```

- [ ] **Step 2: Add accessors**

After the existing `passOf()` chokepoint:

```ts
/**
 * Continuous 0-1 graded score. Returns null if the result hasn't been
 * scored under the new schema (mechanical_score absent). Existing
 * consumers reading passOf() continue to work unchanged — that returns
 * mechanical_pass (loose) for back-compat with the historic 84.7% headline.
 */
export function gradedScoreOf(result: EvalCaseResult | undefined): number | null {
  if (!result) return null;
  return typeof result.mechanical_score === "number" ? result.mechanical_score : null;
}

/**
 * Tri-state bucket of the graded score, for any consumer that wants the
 * simpler axis (e.g., per-case verdict pills with three colors).
 */
export function gradedTriStateOf(result: EvalCaseResult | undefined): "pass" | "mixed" | "fail" | null {
  const s = gradedScoreOf(result);
  if (s === null) return null;
  if (s >= 0.999) return "pass";
  if (s > 0) return "mixed";
  return "fail";
}

/**
 * Strict-pass verdict, raw or audit-overlay-applied.
 */
export function strictPassOf(
  result: EvalCaseResult | undefined,
  mode: "raw" | "audited",
): boolean | null {
  if (!result) return null;
  const field = mode === "raw" ? result.mechanical_pass_strict_raw : result.mechanical_pass_strict_audited;
  return typeof field === "boolean" ? field : null;
}
```

`passOf()` itself stays unchanged — returns `mechanical_pass`. The 9 existing callsites continue to render the loose-pass verdict pill. Locked via /plan-eng-review finding 2.1.

- [ ] **Step 3: Write the failing tests**

Create `/Users/siraj/falsafa/apps/site/src/lib/__tests__/eval-types.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { passOf, gradedScoreOf, gradedTriStateOf, strictPassOf } from "../eval-types";

describe("eval-types accessors", () => {
  test("passOf returns mechanical_pass (loose) for back-compat", () => {
    expect(passOf({ mechanical_pass: true } as any)).toBe(true);
    expect(passOf({ mechanical_pass: false } as any)).toBe(false);
    expect(passOf(undefined)).toBe(null);
  });

  test("gradedScoreOf returns continuous 0-1", () => {
    expect(gradedScoreOf({ mechanical_score: 0.5 } as any)).toBe(0.5);
    expect(gradedScoreOf({ mechanical_score: 1.0 } as any)).toBe(1.0);
    expect(gradedScoreOf({ mechanical_score: 0 } as any)).toBe(0);
    expect(gradedScoreOf({} as any)).toBe(null);
  });

  test("gradedTriStateOf buckets correctly", () => {
    expect(gradedTriStateOf({ mechanical_score: 1.0 } as any)).toBe("pass");
    expect(gradedTriStateOf({ mechanical_score: 0.999 } as any)).toBe("pass");
    expect(gradedTriStateOf({ mechanical_score: 0.5 } as any)).toBe("mixed");
    expect(gradedTriStateOf({ mechanical_score: 0.001 } as any)).toBe("mixed");
    expect(gradedTriStateOf({ mechanical_score: 0 } as any)).toBe("fail");
    expect(gradedTriStateOf({} as any)).toBe(null);
  });

  test("strictPassOf raw vs audited", () => {
    const r = {
      mechanical_pass_strict_raw: false,
      mechanical_pass_strict_audited: true,
    } as any;
    expect(strictPassOf(r, "raw")).toBe(false);
    expect(strictPassOf(r, "audited")).toBe(true);
    expect(strictPassOf({} as any, "raw")).toBe(null);
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
cd /Users/siraj/falsafa
bun test apps/site/src/lib/__tests__/eval-types.test.ts 2>&1 | tail -5
```

Expected: 4 PASS.

```bash
git add apps/site/src/lib/eval-types.ts apps/site/src/lib/__tests__/eval-types.test.ts
git commit -m "feat(site): four-axis scoring accessors (gradedScoreOf, gradedTriStateOf, strictPassOf)

Extends EvalCaseResult with mechanical_score, mechanical_pass_loose,
mechanical_pass_strict_raw, mechanical_pass_strict_audited,
citation_quality (additive — existing mechanical_pass consumers keep
working).

passOf() unchanged (returns mechanical_pass for back-compat with the
historic 84.7% headline reproducibility). gradedScoreOf returns
continuous 0-1; gradedTriStateOf buckets to pass/mixed/fail; strictPassOf
takes 'raw' or 'audited' mode.

Tests: 4 cases verifying back-compat preservation + new accessor behavior."
```

### Task 3.2: Rewrite `eval-arms.ts` for N-arm support

**Files:**
- Modify: `apps/site/src/lib/eval-arms.ts` (REWRITE)
- Modify: `apps/site/src/lib/__tests__/eval-arms.test.ts` (extend)

The existing 75-line file hard-codes 2-arm baseline-vs-wiki. Rewrite for N-arm support while preserving the existing 2-arm `flips-pass` / `flips-fail` / `both-pass` / `both-fail` / `pending-wiki` filter as a special case.

- [ ] **Step 1: Locate the existing `single-arm-regression.test.ts` file**

Run: `cat /Users/siraj/falsafa/apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts | head -30`

This is the iron-rule regression test. It MUST keep passing through this rework. Skim it to know what guarantees it asserts.

- [ ] **Step 2: Write the new eval-arms.ts**

Replace `apps/site/src/lib/eval-arms.ts` with:

```ts
/**
 * eval-arms.ts — Generic N-arm helpers for the eval explorer.
 *
 * The build script (eval/build-eval-json.ts) writes the canonical arm
 * registry into eval-index.json's top-level arms[] field. This file
 * consumes that registry and provides:
 *
 *   - armOfModelId / isAbMode   — back-compat shims for the 2-arm view
 *   - armVerdicts                — generic N-arm version (and a 2-arm overload)
 *   - filterByCompare            — preserves the existing 2-arm filter modes
 *   - armsFromIndex              — extract Arms[] from eval-index.json
 *
 * No DOM, no React, no fetching — pure logic, fully unit-testable.
 */

import type { EvalCase, EvalCaseResult } from "./eval-types";
import { passOf } from "./eval-types";

export interface Arm {
  id: string;
  lab: "xAI" | "Anthropic" | "Google" | "OpenAI" | "OSS";
  model: string;
  treatment: "wiki" | "baseline" | "strict-prompt";
  tier: "headline" | "methodology";
  transport: "openrouter" | "claude-cli";
  label: string;
}

/**
 * Read the canonical arms[] registry from a parsed eval-index.json.
 * Falls back to deriving arms from data.models for legacy index files
 * (pre-version-2 schema).
 */
export function armsFromIndex(data: { arms?: Arm[]; models?: { id: string }[] }): Arm[] {
  if (Array.isArray(data.arms) && data.arms.length > 0) return data.arms;
  // Legacy fallback: synthesize from models[]. Used during the schema
  // transition; remove once eval-index.json reliably has arms[].
  return (data.models ?? []).map((m) => ({
    id: m.id,
    lab: "xAI" as const,
    model: m.id,
    treatment: m.id.endsWith("__wiki") ? "wiki" : "baseline" as const,
    tier: "methodology" as const,
    transport: "openrouter" as const,
    label: m.id,
  }));
}

// ───── Back-compat shims for the 2-arm view ──────────────────────────

export type LegacyArm = "baseline" | "wiki";

/**
 * Extract the legacy 2-arm tag from a model id with __baseline / __wiki
 * suffix. Used by the existing /eval/[id].astro and by the iron-rule
 * regression test.
 *
 * Returns null for any id that doesn't carry the legacy suffix — including
 * the new arm ids (sonnet-via-mcp, gemini-flash-lite, etc.).
 */
export function armOfModelId(modelId: string): LegacyArm | null {
  if (modelId.endsWith("__baseline")) return "baseline";
  if (modelId.endsWith("__wiki")) return "wiki";
  return null;
}

/**
 * True when `data.models` (legacy field) contains both the __baseline and
 * __wiki arms. Drives the historic 2-arm A/B view at /eval/[id].astro.
 *
 * Replaced by armsFromIndex(data).filter(a => a.tier === 'headline').length
 * for the new compare/methodology views, but isAbMode stays for the
 * back-compat per-case page.
 */
export function isAbMode(models: { id: string }[]): boolean {
  let hasBaseline = false;
  let hasWiki = false;
  for (const m of models) {
    const arm = armOfModelId(m.id);
    if (arm === "baseline") hasBaseline = true;
    else if (arm === "wiki") hasWiki = true;
    if (hasBaseline && hasWiki) return true;
  }
  return false;
}

// ───── Generic N-arm verdict + filter ────────────────────────────────

/**
 * Generic N-arm verdict pair. For each arm in armIds[], returns the
 * pass/fail/null verdict for this case (null = pending — that arm has
 * no result for this case).
 */
export function armVerdictsN(c: EvalCase, armIds: string[]): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const armId of armIds) {
    out[armId] = c.results ? passOf(c.results[armId]) : null;
  }
  return out;
}

/**
 * 2-arm-special-case overload: { baseline, wiki } verdict pair.
 *
 * Preserved from the legacy implementation. Used by:
 *   - The iron-rule regression test
 *   - /eval/[id].astro 2-arm rendering path
 *   - filterByCompare's flips-pass / flips-fail / both-pass / both-fail / pending-wiki modes
 */
export function armVerdicts(
  c: EvalCase,
  baselineId: string | undefined,
  wikiId: string | undefined,
): { baseline: boolean | null; wiki: boolean | null } {
  return {
    baseline: baselineId ? passOf(c.results[baselineId]) : null,
    wiki: wikiId ? passOf(c.results[wikiId]) : null,
  };
}

export type CompareMode =
  | "all"
  | "flips-pass"
  | "flips-fail"
  | "both-pass"
  | "both-fail"
  | "pending-wiki";

/**
 * Truth-table filter for the 2-arm A/B view. Preserved from the legacy
 * implementation per the iron-rule regression test.
 *
 * Pending cases NEVER satisfy flips/both modes, only `all` and `pending-wiki`.
 */
export function filterByCompare(
  v: { baseline: boolean | null; wiki: boolean | null },
  mode: CompareMode,
): boolean {
  switch (mode) {
    case "all": return true;
    case "flips-pass": return v.baseline === false && v.wiki === true;
    case "flips-fail": return v.baseline === true && v.wiki === false;
    case "both-pass":  return v.baseline === true && v.wiki === true;
    case "both-fail":  return v.baseline === false && v.wiki === false;
    case "pending-wiki": return v.wiki === null;
  }
}

/**
 * Generic N-arm filter: returns the case if EVERY armId in the truth-table
 * has a non-null verdict (no pending arms). Used by the new compare view
 * when 3+ arms are picked — the 6-mode 2-arm filter is replaced with a
 * "show only complete rows" toggle.
 */
export function filterByCompleteRows(verdicts: Record<string, boolean | null>): boolean {
  return Object.values(verdicts).every((v) => v !== null);
}
```

- [ ] **Step 3: Extend the existing tests + add new ones**

Edit `apps/site/src/lib/__tests__/eval-arms.test.ts`. Keep existing 2-arm tests verbatim (iron rule). Add new tests for `armsFromIndex`, `armVerdictsN`, `filterByCompleteRows`:

```ts
// At the end of the existing test file, add:

describe("armsFromIndex", () => {
  test("returns the canonical arms[] when present", () => {
    const arms = armsFromIndex({
      arms: [{ id: "sonnet-via-mcp", lab: "Anthropic", model: "Sonnet 4.6", treatment: "wiki", tier: "headline", transport: "claude-cli", label: "Sonnet 4.6 (via npm)" }],
    });
    expect(arms).toHaveLength(1);
    expect(arms[0]?.id).toBe("sonnet-via-mcp");
  });

  test("falls back to models[] for legacy index files", () => {
    const arms = armsFromIndex({
      models: [{ id: "grok-4.1-fast__baseline" }, { id: "grok-4.1-fast__wiki" }],
    });
    expect(arms).toHaveLength(2);
    expect(arms[0]?.treatment).toBe("baseline");
    expect(arms[1]?.treatment).toBe("wiki");
  });
});

describe("armVerdictsN", () => {
  test("returns verdicts for all requested arm ids", () => {
    const c = {
      id: "q-test",
      results: {
        "grok-wiki": { mechanical_pass: true } as any,
        "sonnet-via-mcp": { mechanical_pass: false } as any,
      },
    } as any;
    const v = armVerdictsN(c, ["grok-wiki", "sonnet-via-mcp", "haiku-via-mcp"]);
    expect(v["grok-wiki"]).toBe(true);
    expect(v["sonnet-via-mcp"]).toBe(false);
    expect(v["haiku-via-mcp"]).toBe(null);
  });
});

describe("filterByCompleteRows", () => {
  test("only complete rows pass", () => {
    expect(filterByCompleteRows({ a: true, b: false })).toBe(true);
    expect(filterByCompleteRows({ a: true, b: null })).toBe(false);
    expect(filterByCompleteRows({})).toBe(true);
  });
});
```

- [ ] **Step 4: Run all eval-arms tests**

```bash
cd /Users/siraj/falsafa
bun test apps/site/src/lib/__tests__/eval-arms.test.ts 2>&1 | tail -10
```

Expected: existing 2-arm tests + new tests all PASS. The iron-rule single-arm regression test at `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` should also still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/lib/eval-arms.ts apps/site/src/lib/__tests__/eval-arms.test.ts
git commit -m "feat(site): N-arm eval-arms helpers (preserves 2-arm flips-* iron rule)

Generic armVerdictsN(case, armIds) returns Record<armId, boolean|null>.
filterByCompleteRows for 3+-arm compare views.

Legacy 2-arm helpers (armOfModelId, isAbMode, armVerdicts, filterByCompare)
preserved verbatim — the iron-rule regression test at
apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts
must keep passing per /plan-eng-review test pyramid.

armsFromIndex(data) reads the canonical arms[] from eval-index.json with
a legacy fallback to data.models[] for index files predating the schema
bump (version<2)."
```

### Task 3.3: Rebuild `EvalExplorer.tsx` for multi-arm + lazy fetch + filter-by-lab

**Files:**
- Rewrite: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`
- Test: extend the existing single-arm-regression test if needed

The existing 950-line `EvalExplorer.tsx` hard-codes the 2-arm scoreboard. Full rewrite around the new IA. This task is sized as the largest single component task in the plan — budget ~45 min.

**STRUCTURAL INVARIANTS (iron rule — MUST preserve)**

Before touching any code, read `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` carefully. The test asserts grep-based structural invariants on EvalExplorer.tsx that the rebuild MUST honor or it'll fail:

1. **A `function SingleArmHeader` (or `function Header`) function exists.** Its body contains the literal radiogroup tuple `["all", "pass", "fail", "unjudged"]` and `role="radiogroup" aria-label="Verdict"`. This is the legacy single-arm rendering path that must remain functional.
2. **The class name `eval-case-verdict-pill` appears EXACTLY ONCE in the file.** New multi-arm rendering MUST use a different class name — e.g., `eval-case-verdict-multi-pill` or `eval-case-verdict-arm-pill`.
3. **The `SingleArmHeader` body must NOT contain** any of: `eval-scoreboard`, `eval-delta-strip`, `eval-ab-pill`, `eval-case-row--ab`. (Those are 2-arm and multi-arm patterns; they belong in different render branches.)
4. **Hash-sync, FetchState reducer, filter state pattern preserved.**

If you don't honor (1)-(3), the iron-rule test fails and the build is broken. Architecturally: keep `function SingleArmHeader` as the rendering path for `mode === "leaderboard" && visibleArmIds.size === 1`; introduce new `MultiArmScoreboard` + `CompareScoreboard` + `MethodologyScoreboard` for the other modes. The iron-rule test runs on whatever is in the file at any time.

- [ ] **Step 1: Read the existing component carefully**

```bash
wc -l /Users/siraj/falsafa/apps/site/src/islands/eval-explorer/EvalExplorer.tsx
grep -n "^function\|^export function\|SingleArmHeader\|aria-selected\|fetchState\|filters" /Users/siraj/falsafa/apps/site/src/islands/eval-explorer/EvalExplorer.tsx | head -30
cat /Users/siraj/falsafa/apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts | head -80
```

Note the patterns: hash-sync via `window.location.hash`, fetch state machine (loading/missing/error/ready), filter state mirrored to URL hash, **`function SingleArmHeader`** as the legacy rendering path. Preserve all of these in the rewrite.

- [ ] **Step 2: Write the new component**

The full rewrite is substantial. The core architecture:

```ts
// State machine:
//   1. mount → fetch /eval-index.json
//   2. parse arms[] from index, derive default visible arms (5 headline by default)
//   3. for each visible arm, fetch /eval-arms/<arm_id>.json (lazy, parallel)
//   4. while any arm is fetching, show pending pill in its column
//   5. URL hash sync: #arms=a,b,c restores selection; #lab=Anthropic filters chip group

// Component responsibilities:
//   - ScoreboardHeader: N columns, one per visible arm, with graded/loose/strict numbers
//   - ArmPicker: chip group of all arms[] with multi-select; sticky on /compare
//   - LabFilter: chip group of distinct labs from arms[]; toggles arm visibility
//   - CaseList: per-case row with verdict pills (one per visible arm)
//   - LoadingPill / PendingPill: per-arm column when its file is in-flight
```

Rather than reproduce 600+ lines of TypeScript inline here, the implementer should:

1. Open the existing `EvalExplorer.tsx` in their editor side-by-side
2. Keep the file structure: imports, types, fetchState reducer, filter state, hash sync, main component
3. Replace the 2-arm scoreboard rendering with N-arm rendering driven by `arms[]` + `visibleArmIds` Set
4. Replace `armVerdicts(c, baselineId, wikiId)` calls with `armVerdictsN(c, Array.from(visibleArmIds))`
5. Add a per-arm fetch state machine: each visible arm has its own `{loading, error, data}` state tracked in a Map
6. Add the LabFilter chip group above the ArmPicker
7. Preserve the existing CompareMode chips for the 2-arm-only special case (only render when `visibleArmIds.size === 2`)

- [ ] **Step 3: Implement progress UI for per-arm fetch**

While an arm is fetching, render its column with a small shimmer animation in the score cells. CSS:

```css
.arm-loading {
  background: linear-gradient(90deg, var(--rule) 0%, var(--paper-soft) 50%, var(--rule) 100%);
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Per-arm progress text: `"loading sonnet-via-mcp..."` in the column header during fetch.

- [ ] **Step 4: Implement the lazy-fetch state machine**

```ts
type ArmFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: ArmData }
  | { kind: "error"; message: string };

const [armStates, setArmStates] = useState<Map<string, ArmFetchState>>(new Map());

const fetchArm = useCallback((armId: string) => {
  setArmStates((m) => new Map(m).set(armId, { kind: "loading" }));
  fetch(`/eval-arms/${armId}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      setArmStates((m) => new Map(m).set(armId, { kind: "ready", data }));
    })
    .catch((err) => {
      setArmStates((m) => new Map(m).set(armId, { kind: "error", message: String(err) }));
    });
}, []);

// When visibleArmIds changes, fetch any newly-visible arms whose state is idle.
useEffect(() => {
  for (const armId of visibleArmIds) {
    const state = armStates.get(armId)?.kind ?? "idle";
    if (state === "idle") fetchArm(armId);
  }
}, [visibleArmIds, armStates, fetchArm]);
```

- [ ] **Step 5: Run the existing iron-rule test + smoke the build**

```bash
cd /Users/siraj/falsafa
bun test apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts 2>&1 | tail -5
cd apps/site && bun run build 2>&1 | tail -10
```

Expected: iron-rule test PASSES. Build succeeds. If the build errors with type mismatches, the implementer adapts the types until it builds.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx
git commit -m "feat(site): rebuild EvalExplorer for N-arm scoreboard + lazy-fetch

Replaces hard-coded 2-arm rendering with generic N-arm support driven
by the arms[] registry from eval-index.json. Per-arm lazy fetch from
/eval-arms/<arm_id>.json with shimmer placeholder during in-flight.

URL hash sync extended:
  #arms=grok-wiki,sonnet-via-mcp     restores arm selection
  #lab=Anthropic                     filters arm chip group by lab

Preserved unchanged for back-compat:
  - 2-arm CompareMode filter (flips-pass / flips-fail / both-pass /
    both-fail / pending-wiki) — renders only when exactly 2 arms picked
  - Iron-rule single-arm-regression test still passes
  - hash-sync pattern, FetchState reducer

Locked via /plan-eng-review D2 (single arm-registry source of truth)
and codex finding #1 (2-arm-binary explorer was structural blocker)."
```

### Task 3.4: Rewire `/eval/[id].astro` to read per-arm files at build time

**Files:**
- Modify: `apps/site/src/pages/eval/[id].astro`

Per /plan-eng-review D6 — replace `readFileSync('public/eval.json')` with `import.meta.glob` of `eval-arms/*.json`.

- [ ] **Step 1: Replace the data-loading block**

In `apps/site/src/pages/eval/[id].astro`, find the `getStaticPaths` function around line 35. Replace its body:

```ts
export const getStaticPaths = (async () => {
  const repoRoot = resolve(process.cwd());
  const indexPath = resolve(repoRoot, "public/eval-index.json");
  const indexData = JSON.parse(readFileSync(indexPath, "utf8"));

  // Load all per-arm files at build time.
  const armFiles = readdirSync(resolve(repoRoot, "public/eval-arms"))
    .filter((f) => f.endsWith(".json"));
  const perArmCases = new Map<string, Map<string, EvalCaseResult>>();
  for (const f of armFiles) {
    const armId = f.replace(/\.json$/, "");
    const armData = JSON.parse(readFileSync(resolve(repoRoot, "public/eval-arms", f), "utf8"));
    const caseMap = new Map<string, EvalCaseResult>();
    for (const c of armData.cases ?? []) {
      caseMap.set(c.id, c);
    }
    perArmCases.set(armId, caseMap);
  }

  // For each case, join per-arm results.
  return indexData.cases.map((c: EvalCase) => {
    const results: Record<string, EvalCaseResult> = {};
    for (const [armId, caseMap] of perArmCases) {
      const r = caseMap.get(c.id);
      if (r) results[armId] = r;
    }
    return {
      params: { id: c.id },
      props: { case: { ...c, results }, arms: indexData.arms ?? [] },
    };
  });
}) satisfies GetStaticPaths;
```

- [ ] **Step 2: Update the rendering block to iterate over arms[] (vertical stack)**

The existing component renders 2-column A/B. Replace with vertical-stack rendering: iterate over arms (sorted by tier, then by lab, then alphabetical), render each arm's row with answer + citations + 4 metrics + citation_quality block.

- [ ] **Step 3: Build + verify**

```bash
cd /Users/siraj/falsafa/apps/site
bun run build 2>&1 | tail -5
ls dist/eval/q-0001/ | head
```

Expected: build succeeds. The case directory contains `index.html`. Open it (`open dist/eval/q-0001/index.html`) to visually verify the vertical-arm-stack rendering.

- [ ] **Step 4: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/eval/[id].astro
git commit -m "feat(site): /eval/[id].astro reads per-arm files at Astro build time

Replaces readFileSync('public/eval.json') with readdirSync('public/eval-arms/')
+ per-arm loop. Static pre-rendering preserved (fast initial paint,
Pagefind indexable). Build memory ~50MB at 11 arms — tractable on
Vercel build runners.

Renders all arms in a vertical stack. Each arm row: answer, parsed
citations, 4-metric verdict block, citation_quality stats.

Locked via /plan-eng-review D6 (codex finding #2 sequencing — eval.json
removal would have broken Astro static gen without this rewire)."
```

### Task 3.5: Build new `/eval/index.astro` (leaderboard) + `/eval/compare.astro` + `/eval/methodology.astro`

**Files:**
- Modify: `apps/site/src/pages/eval/index.astro` (rewrite as leaderboard)
- Create: `apps/site/src/pages/eval/compare.astro`
- Create: `apps/site/src/pages/eval/methodology.astro`

These three pages mostly compose the existing `EvalExplorer.tsx` island with different default props. Astro pages are thin shells.

- [ ] **Step 1: Rewrite `/eval/index.astro` as leaderboard**

```astro
---
import Base from "../../layouts/Base.astro";
import EvalExplorer from "../../islands/eval-explorer/EvalExplorer";
---

<Base title="Eval — Falsafa" description="Cross-provider eval leaderboard for the @falsafa/mcp librarian">
  <article class="eval-leaderboard">
    <header>
      <p class="kicker">Eval</p>
      <h1>Cross-provider leaderboard</h1>
      <p class="lede">Five wiki arms ranked by graded score across 1,120 audited questions.</p>
    </header>

    <EvalExplorer
      client:only="preact"
      mode="leaderboard"
      defaultTier="headline"
      defaultArmIds={["grok-wiki", "sonnet-via-mcp", "haiku-via-mcp", "gemini-flash-lite", "gpt-5-nano"]}
    />
  </article>
</Base>
```

The `mode="leaderboard"` prop tells the island to default to single-column ranking; no compare-mode chips. Component handles the rest.

- [ ] **Step 2: Build `/eval/compare.astro`**

```astro
---
import Base from "../../layouts/Base.astro";
import EvalExplorer from "../../islands/eval-explorer/EvalExplorer";
---

<Base title="Compare — Eval — Falsafa" description="Side-by-side comparison of 2-4 eval arms">
  <article class="eval-compare">
    <header>
      <p class="kicker">Eval / Compare</p>
      <h1>Compare 2-4 arms</h1>
      <p class="lede">Pick which arms to compare side-by-side. The 2-arm view preserves the historic baseline-vs-wiki filter chips.</p>
    </header>

    <EvalExplorer
      client:only="preact"
      mode="compare"
      defaultTier={null}
      defaultArmIds={[]}
    />
  </article>
</Base>
```

- [ ] **Step 3: Build `/eval/methodology.astro`**

```astro
---
import Base from "../../layouts/Base.astro";
import EvalExplorer from "../../islands/eval-explorer/EvalExplorer";
---

<Base title="Methodology — Eval — Falsafa" description="Counterfactual analyses: wiki contribution, strict-prompt A/B, audit overlay effect">
  <article class="eval-methodology">
    <header>
      <p class="kicker">Eval / Methodology</p>
      <h1>Counterfactual analyses</h1>
      <p class="lede">The methodology contributions: how the wiki layer affects scores, whether the citation gap is a prompt issue, and the audit overlay's effect on strict numbers.</p>
    </header>

    <section>
      <h2>Wiki contribution</h2>
      <p>Same model, two tool surfaces. Does the wiki layer earn its existence?</p>
      <EvalExplorer
        client:only="preact"
        mode="compare"
        defaultArmIds={["baseline", "wiki", "sonnet-baseline", "sonnet-via-mcp", "haiku-baseline", "haiku-via-mcp"]}
      />
    </section>

    <section>
      <h2>Strict-prompt A/B (xAI only)</h2>
      <p>Default prompt vs maximally-strict citation prompt. Does prompt engineering close the gap between substring and citation-strict?</p>
      <EvalExplorer
        client:only="preact"
        mode="compare"
        defaultArmIds={["wiki", "strict-prompt"]}
      />
    </section>

    <section>
      <h2>Audit overlay effect</h2>
      <p>Raw strict (every expected_work cited) vs audited strict (acceptable_alternatives accepted). The delta is what the audit overlay contributes.</p>
      <EvalExplorer
        client:only="preact"
        mode="audit-comparison"
        defaultArmIds={["wiki", "sonnet-via-mcp"]}
      />
    </section>
  </article>
</Base>
```

`mode="audit-comparison"` is a new EvalExplorer mode that renders raw-strict and audited-strict as two separate columns instead of one — added in Task 3.3.

- [ ] **Step 4: Build + verify all three pages**

```bash
cd /Users/siraj/falsafa/apps/site
bun run build 2>&1 | tail -3
ls dist/eval/ dist/eval/compare/ dist/eval/methodology/
```

Expected: all three directories present. Open each:

```bash
open dist/eval/index.html
open dist/eval/compare/index.html
open dist/eval/methodology/index.html
```

Verify default arm selections, scoreboard rendering, no console errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/eval/index.astro apps/site/src/pages/eval/compare.astro apps/site/src/pages/eval/methodology.astro
git commit -m "feat(site): /eval/ leaderboard + /eval/compare + /eval/methodology

Three URL-distinct surfaces driven by EvalExplorer with different mode
props:
  /eval/             leaderboard mode, 5 wiki arms default
  /eval/compare      multi-select, no defaults; 2-arm flips-* preserved
  /eval/methodology  three counterfactual sub-sections (wiki contribution,
                     strict-prompt A/B, audit overlay effect)

Locked via /plan-design-review D3 (Pattern A: two-view split + methodology
sub-page) and /plan-eng-review D6 (eval.json removal sequencing).

The deployed site at falsafa.ai auto-deploys via Vercel on push."
```

### Task 3.6: Update `/numbers` and `/thesis` for the new metrics

**Files:**
- Modify: `apps/site/src/pages/numbers/index.astro`
- Modify: `apps/site/src/pages/thesis/index.astro`

- [ ] **Step 1: Update `/numbers/index.astro` to read graded headline**

The existing page reads `eval.json` directly via `readFileSync`. Switch to reading `eval-index.json` + per-arm `aggregations.score_sum / case_count = graded_score` for each headline arm.

```ts
// Replace the existing data load with:
const indexData = JSON.parse(readFileSync(resolve(process.cwd(), "public/eval-index.json"), "utf8"));
const armsDir = resolve(process.cwd(), "public/eval-arms");
const headlineArms = indexData.arms.filter((a: Arm) => a.tier === "headline");
const stats = headlineArms.map((arm: Arm) => {
  const armData = JSON.parse(readFileSync(resolve(armsDir, `${arm.id}.json`), "utf8"));
  const agg = armData.aggregations;
  return {
    arm,
    graded_score: agg.score_sum / agg.case_count,
    pass_rate_loose: agg.pass_count_loose / agg.case_count,
    pass_rate_strict_raw: agg.pass_count_strict_raw / agg.case_count,
    pass_rate_strict_audited: agg.pass_count_strict_audited / agg.case_count,
    total_cost_usd: agg.total_cost_usd,
  };
});
```

The page renders the headline graded score for each arm + the methodology table.

- [ ] **Step 2: Update `/thesis/index.astro` methodology section + benchmark chart**

Update the existing A/B benchmark chart to reflect the 5-arm headline comparison instead of just baseline-vs-wiki. The methodology section's prose should explain:
- Three-axis deterministic scoring (loose / graded-fractional / strict-{raw,audited})
- Why fractional, not tri-state (information-loss argument from /plan-ceo-review)
- The audit overlay (raw vs audited, why both are published)
- The 9-arm matrix (5 headline + 4 methodology)

- [ ] **Step 3: Build + verify**

```bash
cd /Users/siraj/falsafa/apps/site
bun run build 2>&1 | tail -3
```

Open `dist/numbers/index.html` and `dist/thesis/index.html`. Verify:
- /numbers shows the new graded headline numbers
- /thesis methodology section reads correctly
- A/B benchmark chart renders (may need additional data wiring)

- [ ] **Step 4: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/numbers/index.astro apps/site/src/pages/thesis/index.astro
git commit -m "feat(site): /numbers + /thesis read graded headline from eval-index.json

/numbers shows the headline graded score per arm + methodology table.
/thesis methodology section explains four-metric scoring + 9-arm matrix
+ why fractional (not tri-state) graded scoring.

A/B benchmark chart at /thesis/#benchmark updated to render 5-arm
headline comparison instead of 2-arm baseline-vs-wiki only."
```

---

## Chunk 3 Done Criteria

- [ ] All 6 tasks committed (6 commits — Tasks 3.1 through 3.6)
- [ ] `bun test apps/site/src/lib/__tests__/eval-types.test.ts` — 4 PASS
- [ ] `bun test apps/site/src/lib/__tests__/eval-arms.test.ts` — pre-existing tests still pass + 4 new (armsFromIndex, armVerdictsN, filterByCompleteRows)
- [ ] `bun test apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` — IRON RULE: still PASSES verbatim
- [ ] `cd apps/site && bun run build` succeeds end-to-end
- [ ] `dist/eval/index.html`, `dist/eval/compare/index.html`, `dist/eval/methodology/index.html` all exist and render
- [ ] `dist/eval/q-0001/index.html` (and other case pages) render with vertical-stack of all arms
- [ ] /numbers + /thesis pages read the new schema and render
- [ ] `/eval/?lab=Anthropic` (URL hash filter) shows only Anthropic-lab arms in the chip group

**Push order (atomic with Chunk 2 Task 2.7):**
```bash
cd /Users/siraj/falsafa
git log origin/main..HEAD --oneline | head -20
# Should show all of Chunk 2's commits + all of Chunk 3's commits
git push origin main
```

After push, falsafa.ai auto-deploys via Vercel. Verify deployment health:
```bash
curl -sI https://www.falsafa.ai/eval/ | head -3
curl -sI https://www.falsafa.ai/eval/compare/ | head -3
curl -sI https://www.falsafa.ai/eval/methodology/ | head -3
```

All three should return 200.

---

## Chunk 4: Audit tool + 9-arm matrix run

**Why fourth:** Chunks 1-3 produced the code path. Chunk 4 produces the data: re-runs the existing 2 Grok arms under the new schema (citations are reliable now), runs the 7 new arms, runs the human audit on the ~146 candidate cases, and writes `eval/audit-decisions.json`. Chunk 4 is mostly running scripts + human work, not engineering.

**Deliverables:**
- `eval/audit-candidates.ts` CLI tool (~200 lines)
- `eval/audit-decisions.json` populated with ~146 human decisions
- 9 run directories under `apps/mcp/eval/runs/` containing per-question JSON files
- Final `eval-index.json` + `eval-arms/<arm>.json` files reflecting all 9 arms

### Task 4.1: Build `eval/audit-candidates.ts` CLI

**Files:**
- Create: `eval/audit-candidates.ts` (~200 lines)

The tool reads cases where `mechanical_pass_strict_raw === false` AND `citations.length > 0` AND at least one citation goes to a non-expected work. Presents each one-by-one in the terminal with the question + cited paragraphs + expected works. Captures the auditor's decision (`valid_alternative` / `real_failure` / `skip`) + acceptable_alternatives groups. Writes atomically to `eval/audit-decisions.json` per decision.

- [ ] **Step 1: Locate candidate-selection logic**

The candidate selection runs against the latest eval-arms files (after re-running Grok in Task 4.3). For now, write the script assuming the data exists.

- [ ] **Step 2: Write the CLI**

Create `/Users/siraj/falsafa/eval/audit-candidates.ts`:

```ts
#!/usr/bin/env bun
/**
 * audit-candidates.ts — CLI tool for human adjudication of citation-strict-fail
 * cases that have non-expected citations (i.e., the model cited something,
 * just not what we listed in expected_works).
 *
 * Usage:
 *   bun run eval/audit-candidates.ts                              # next un-audited case
 *   bun run eval/audit-candidates.ts --re-audit q-0234            # re-audit specific case
 *   bun run eval/audit-candidates.ts --re-audit-all               # re-audit everything
 *   bun run eval/audit-candidates.ts --arm sonnet-via-mcp         # only this arm
 *   bun run eval/audit-candidates.ts --report                     # print stats, no prompts
 *
 * Persists decisions atomically to eval/audit-decisions.json after each
 * case (resume-safe: SIGINT mid-decision loses at most the current case).
 */

import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DECISIONS_PATH = resolve(REPO_ROOT, "eval/audit-decisions.json");
const ARMS_DIR = resolve(REPO_ROOT, "apps/site/public/eval-arms");

interface Citation {
  work_slug: string;
  chapter_number?: number;
  paragraph_id: string;
}

interface CaseResult {
  id: string;
  prompt: string;
  expected_works: string[];
  answer: string;
  citations: Citation[];
  mechanical_pass_strict_raw?: boolean;
  category?: string;
}

interface ArmFile {
  arm_id: string;
  cases: CaseResult[];
}

interface Decision {
  verdict: "valid_alternative" | "real_failure" | "skip";
  acceptable_alternatives?: string[][];
  notes?: string;
  audited_at_iso: string;
  audited_in_arm: string;
}

interface DecisionsFile {
  version: number;
  decisions: Record<string, Decision>;
}

function loadDecisions(): DecisionsFile {
  if (!existsSync(DECISIONS_PATH)) {
    return { version: 1, decisions: {} };
  }
  return JSON.parse(readFileSync(DECISIONS_PATH, "utf8"));
}

function saveDecisions(d: DecisionsFile): void {
  const tmp = DECISIONS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(d, null, 2));
  renameSync(tmp, DECISIONS_PATH);
}

function loadAllArms(armFilter?: string): ArmFile[] {
  if (!existsSync(ARMS_DIR)) return [];
  const files = readdirSync(ARMS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(readFileSync(resolve(ARMS_DIR, f), "utf8")) as ArmFile)
    .filter((arm) => !armFilter || arm.arm_id === armFilter);
}

function findCandidates(arms: ArmFile[], decisions: DecisionsFile, reAuditAll: boolean): { arm: string; case: CaseResult }[] {
  const out: { arm: string; case: CaseResult }[] = [];
  for (const arm of arms) {
    for (const c of arm.cases) {
      if (c.mechanical_pass_strict_raw !== false) continue;
      if (c.citations.length === 0) continue;
      const hasNonExpected = c.citations.some((cite) => !c.expected_works.includes(cite.work_slug));
      if (!hasNonExpected) continue;
      if (!reAuditAll && decisions.decisions[c.id]) continue;
      out.push({ arm: arm.arm_id, case: c });
    }
  }
  // Sort: category (citation/comparative first), then expected_works.length asc
  const catOrder = ["citation", "comparative", "specific-obscure", "thematic", "conceptual", "multilingual", "cross-cultural"];
  out.sort((a, b) => {
    const aIdx = catOrder.indexOf(a.case.category ?? "");
    const bIdx = catOrder.indexOf(b.case.category ?? "");
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.case.expected_works.length - b.case.expected_works.length;
  });
  return out;
}

async function presentAndDecide(rl: any, candidate: { arm: string; case: CaseResult }, total: number, current: number): Promise<Decision | null> {
  const c = candidate.case;
  console.log(`\n──────── case ${current}/${total} ────────`);
  console.log(`id:       ${c.id}`);
  console.log(`category: ${c.category ?? "uncategorized"}`);
  console.log(`arm:      ${candidate.arm}`);
  console.log(`expected: ${c.expected_works.join(", ")}`);
  console.log(`prompt:   ${c.prompt.slice(0, 200)}${c.prompt.length > 200 ? "…" : ""}`);
  console.log(`citations:`);
  for (const cite of c.citations) {
    console.log(`  - ${cite.work_slug || "(unknown)"} ch.${cite.chapter_number ?? "?"} ${cite.paragraph_id}`);
  }
  console.log(`answer (first 500 chars):`);
  console.log(`  ${c.answer.slice(0, 500).replace(/\n/g, "\n  ")}`);
  console.log("");
  const cited = new Set(c.citations.map((x) => x.work_slug).filter(Boolean));
  const nonExpected = Array.from(cited).filter((s) => !c.expected_works.includes(s));
  console.log(`  cited but NOT expected: ${nonExpected.join(", ") || "(none)"}`);

  const ans = (await rl.question("\n[v]alid_alternative / [r]eal_failure / [s]kip / [q]uit > ")).trim().toLowerCase();
  if (ans === "q" || ans === "quit") return null;

  if (ans === "v" || ans === "valid_alternative") {
    console.log("Acceptable alternatives groups (group-AND across groups, member-OR within).");
    console.log("Enter as comma-separated slugs per group; empty line to finish.");
    console.log("Example: 'yajnavalkya-smrti, vishnu-smrti' (one group), then enter for next group.");
    const groups: string[][] = [];
    while (true) {
      const line = (await rl.question(`group ${groups.length + 1}> `)).trim();
      if (!line) break;
      groups.push(line.split(",").map((s) => s.trim()).filter(Boolean));
    }
    const notes = (await rl.question("optional notes (or enter)> ")).trim();
    return {
      verdict: "valid_alternative",
      acceptable_alternatives: groups.length > 0 ? groups : undefined,
      notes: notes || undefined,
      audited_at_iso: new Date().toISOString(),
      audited_in_arm: candidate.arm,
    };
  }

  if (ans === "r" || ans === "real_failure") {
    const notes = (await rl.question("optional notes (or enter)> ")).trim();
    return {
      verdict: "real_failure",
      notes: notes || undefined,
      audited_at_iso: new Date().toISOString(),
      audited_in_arm: candidate.arm,
    };
  }

  if (ans === "s" || ans === "skip") {
    return {
      verdict: "skip",
      audited_at_iso: new Date().toISOString(),
      audited_in_arm: candidate.arm,
    };
  }

  console.log("Unrecognized input — case not decided. Try again.");
  return presentAndDecide(rl, candidate, total, current);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reAuditAll = args.includes("--re-audit-all");
  const reAuditIdx = args.indexOf("--re-audit");
  const reAuditId = reAuditIdx >= 0 ? args[reAuditIdx + 1] : null;
  const armIdx = args.indexOf("--arm");
  const armFilter = armIdx >= 0 ? args[armIdx + 1] : undefined;
  const reportOnly = args.includes("--report");

  const decisions = loadDecisions();
  const arms = loadAllArms(armFilter);
  const candidates = findCandidates(arms, decisions, reAuditAll || !!reAuditId);

  const filtered = reAuditId ? candidates.filter((c) => c.case.id === reAuditId) : candidates;

  console.log(`[audit] ${filtered.length} candidates`);
  console.log(`[audit] decisions so far: ${Object.keys(decisions.decisions).length}`);

  if (reportOnly) {
    const byVerdict: Record<string, number> = {};
    for (const d of Object.values(decisions.decisions)) {
      byVerdict[d.verdict] = (byVerdict[d.verdict] ?? 0) + 1;
    }
    console.log(`[audit] decisions by verdict:`, byVerdict);
    return;
  }

  if (filtered.length === 0) {
    console.log("[audit] no candidates remaining (or none matched filter).");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let i = 0;
  for (const candidate of filtered) {
    i++;
    const decision = await presentAndDecide(rl, candidate, filtered.length, i);
    if (!decision) {
      console.log("[audit] quitting; progress saved.");
      break;
    }
    decisions.decisions[candidate.case.id] = decision;
    saveDecisions(decisions);
  }
  rl.close();
  console.log(`[audit] DONE. ${Object.keys(decisions.decisions).length} total decisions.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Test the CLI logic (without running the full audit)**

```bash
cd /Users/siraj/falsafa
bun run eval/audit-candidates.ts --report 2>&1 | tail -3
```

Expected: prints `[audit] 0 candidates` (since arms haven't been re-run yet) + `[audit] decisions by verdict: {}`.

- [ ] **Step 4: Commit**

```bash
cd /Users/siraj/falsafa
git add eval/audit-candidates.ts
git commit -m "feat(eval): audit-candidates.ts CLI for ~146 strict-fail cases

CLI tool that loads eval-arms/<arm>.json files, finds cases where
mechanical_pass_strict_raw=false AND citations.length>0 AND at least
one citation goes to a non-expected work (the candidate set ~146 cases
projected). Presents each in the terminal with question + cited
paragraphs + expected_works + answer excerpt. Captures verdict
(valid_alternative / real_failure / skip) + acceptable_alternatives
groups (group-AND across, member-OR within).

Persists atomically to eval/audit-decisions.json per decision (.tmp +
rename); SIGINT mid-decision loses at most current case.

Flags: --re-audit <id>, --re-audit-all, --arm <id>, --report.

Sort order: category priority (citation/comparative first), then
expected_works.length ascending — easier cases first to build auditor
calibration.

Locked via /plan-eng-review D5 (codex finding 5: audit scope expanded
from loose=true&&strict=false-only to all citation-bearing strict-fails)."
```

### Task 4.2: Run Grok arms with the new schema (re-runs)

The existing Grok runs predate the runner schema fix and have unreliable citations. Re-run all three:
- `grok-4.1-fast-baseline-<TS>`
- `grok-4.1-fast-wiki-<TS>` (treatment arm)
- `grok-4.1-fast-strict-prompt-<TS>` (NEW)

- [ ] **Step 1: Verify OpenRouter API key is set**

```bash
echo "${OPENROUTER_API_KEY:0:8}..."
```

If empty: `export OPENROUTER_API_KEY=...` first. The key is for the existing `run-openrouter.ts` runner.

- [ ] **Step 2: Run baseline (no wiki)**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-openrouter.ts \
  --model x-ai/grok-4.1-fast \
  --run-name grok-4.1-fast-baseline-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/grok-baseline.log
```

Expected wallclock: ~30 min. Expected cost: ~$13. Watch for the periodic progress lines: `[run-openrouter] N/1120 cost=$X.XX`.

If interrupted: re-run the same command with the same `--run-name` to resume from the last completed q-NNNN.json.

- [ ] **Step 3: Run wiki treatment**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-openrouter.ts \
  --model x-ai/grok-4.1-fast \
  --with-wiki \
  --run-name grok-4.1-fast-wiki-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/grok-wiki.log
```

- [ ] **Step 4: Run strict-prompt A/B (xAI new arm)**

The strict-prompt arm uses the same model + wiki tools, but with a maximally-strict citation system prompt. This requires adding a new flag to `run-openrouter.ts`:

```ts
// In run-openrouter.ts, near the existing SYSTEM_PROMPT block:
const SYSTEM_PROMPT_STRICT = SYSTEM_PROMPT_BASE + `

## STRICT CITATION RULE (this arm only)
Every work you NAME in your answer MUST have a footnote citation, EVEN IF
you only mention it once in passing. "Manusmṛti" without [^N] = FAIL.
"Yajnavalkya" without [^N] = FAIL. No name-dropping. If you cannot find
a paragraph_id to cite for a work you want to mention, do NOT mention it.`;

// Wire a --strict-prompt flag that selects this prompt instead of the
// base wiki prompt.
```

Once wired:

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-openrouter.ts \
  --model x-ai/grok-4.1-fast \
  --with-wiki \
  --strict-prompt \
  --run-name grok-4.1-fast-strict-prompt-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/grok-strict.log
```

- [ ] **Step 5: Verify the runs produced data**

```bash
ls -d apps/mcp/eval/runs/grok-4.1-fast-* | tail -3
ls apps/mcp/eval/runs/grok-4.1-fast-baseline-*/ | wc -l   # should be ~1120
```

- [ ] **Step 6: Commit (run dirs, not the script changes from Step 4)**

The `--strict-prompt` flag added to `run-openrouter.ts` in Step 4 should already be committed before running the arm. Commit it as a separate task if needed.

```bash
cd /Users/siraj/falsafa
git add apps/mcp/eval/run-openrouter.ts
git commit -m "feat(eval): --strict-prompt flag for xAI strict-prompt A/B arm

Adds maximally-strict citation prompt for the strict-prompt methodology
arm. SYSTEM_PROMPT_STRICT extends the base wiki prompt with a hard rule:
every work named in the answer MUST have a footnote citation, even in
passing. No name-dropping.

Used in Chunk 4 Task 4.2 to produce the grok-4.1-fast-strict-prompt-*
arm — the third counterfactual arm in the methodology tier."

# Note: the runs/grok-4.1-fast-*/ directories should NOT be committed
# (they're large and ephemeral). Confirm gitignore covers them:
grep "apps/mcp/eval/runs" /Users/siraj/falsafa/.gitignore
```

If `apps/mcp/eval/runs/` is NOT in `.gitignore`, add it:

```bash
echo "apps/mcp/eval/runs/" >> /Users/siraj/falsafa/.gitignore
git add .gitignore
git commit -m "chore: gitignore apps/mcp/eval/runs/

Runs are ephemeral artifacts — large, reproducible, and the source of
truth lives in apps/site/public/eval-arms/<arm>.json after build."
```

### Task 4.3: Run new arms (Sonnet + Haiku via subagent + Gemini Flash Lite + gpt-5-nano)

Six new runs total: each model × {wiki, baseline} for the headline matrix + the methodology-tier baselines.

- [ ] **Step 1: Verify Claude CLI auth (for Sonnet + Haiku)**

```bash
claude --version 2>&1 | head -1
echo "(test the CLI is logged in)"
echo "test" | claude --print --bare 2>&1 | head -3
```

If "Auth error": `claude` once interactively to confirm login.

- [ ] **Step 2: Sonnet wiki arm (~1-3 days wallclock; rate-limited)**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-claude-cli.ts \
  --model claude-sonnet-4-5 \
  --treatment wiki \
  --run-name sonnet-4.6-via-mcp-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/sonnet-wiki.log
```

The runner is sequential by design (Anthropic Max-plan rate limits). Expect 1-3 days wallclock. Resume-safe — interrupt + restart picks up from the last completed q-NNNN.json.

- [ ] **Step 3: Sonnet baseline arm (parallel with #2 NOT possible — sequential per Max plan)**

After Step 2 completes:

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-claude-cli.ts \
  --model claude-sonnet-4-5 \
  --treatment baseline \
  --run-name sonnet-4.6-baseline-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/sonnet-baseline.log
```

- [ ] **Step 4: Haiku wiki + baseline (after Sonnet arms complete)**

```bash
bun run apps/mcp/eval/run-claude-cli.ts \
  --model claude-haiku-4-5 \
  --treatment wiki \
  --run-name haiku-4.5-via-mcp-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/haiku-wiki.log
```

```bash
bun run apps/mcp/eval/run-claude-cli.ts \
  --model claude-haiku-4-5 \
  --treatment baseline \
  --run-name haiku-4.5-baseline-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/haiku-baseline.log
```

- [ ] **Step 5: Gemini Flash Lite (parallel with the Anthropic arms — different runner)**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-openrouter.ts \
  --model google/gemini-2.5-flash-lite \
  --with-wiki \
  --run-name gemini-flash-lite-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/gemini.log
```

Expected wallclock: ~30 min. Expected cost: ~$8.

- [ ] **Step 6: gpt-5-nano**

```bash
cd /Users/siraj/falsafa
bun run apps/mcp/eval/run-openrouter.ts \
  --model openai/gpt-5-nano \
  --with-wiki \
  --run-name gpt-5-nano-$(date +%Y%m%d-%H%M%S) \
  2>&1 | tee /tmp/gpt-5-nano.log
```

Expected wallclock: ~30 min. Expected cost: ~$5.

- [ ] **Step 7: Verify all 9 runs are present**

```bash
ls -d apps/mcp/eval/runs/grok-4.1-fast-baseline-* \
       apps/mcp/eval/runs/grok-4.1-fast-wiki-* \
       apps/mcp/eval/runs/grok-4.1-fast-strict-prompt-* \
       apps/mcp/eval/runs/sonnet-4.6-via-mcp-* \
       apps/mcp/eval/runs/sonnet-4.6-baseline-* \
       apps/mcp/eval/runs/haiku-4.5-via-mcp-* \
       apps/mcp/eval/runs/haiku-4.5-baseline-* \
       apps/mcp/eval/runs/gemini-flash-lite-* \
       apps/mcp/eval/runs/gpt-5-nano-* 2>&1 | head -10
```

Expected: 9 directories listed.

- [ ] **Step 8: Build eval-index.json + per-arm files**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts 2>&1 | tail -10
```

Expected: prints all 9 arms registered, all 9 per-arm files written. If any arm is missing, check the run dir matches the `armTagFromRunDir` pattern (Task 2.5 patterns).

### Task 4.4: Run the human audit pass (~2-3 hr)

- [ ] **Step 1: Run the audit CLI**

```bash
cd /Users/siraj/falsafa
bun run eval/audit-candidates.ts 2>&1
```

Walk through each candidate. For each:
- Read the question, expected_works, answer excerpt, citations
- If the model cited a different-but-equally-valid work → `v` (valid_alternative) → enter the acceptable_alternatives groups (e.g., `dharmasutra-baudhayana` as a single-member group means "this slug is acceptable").
- If the model citation is wrong → `r` (real_failure)
- If unsure → `s` (skip)

Decisions auto-save to `eval/audit-decisions.json` after each case. Safe to interrupt with Ctrl-C.

Expected wallclock: ~2-3 hr human time at ~146 cases × ~1 min each. Take breaks as needed; the resume picks up where you left off.

- [ ] **Step 2: Commit the audit decisions**

```bash
cd /Users/siraj/falsafa
bun run eval/audit-candidates.ts --report 2>&1 | tail -3
git add eval/audit-decisions.json
git commit -m "data(eval): human audit pass on ~146 strict-fail-with-citations cases

Auditor decisions for cases where mechanical_pass_strict_raw=false
AND citations.length>0 AND at least one citation goes to a non-expected
work. Verdict distribution: valid_alternative=N, real_failure=M,
skip=K (per --report output).

The acceptable_alternatives OR-groups merge at build time via
passByCitationsWithOverlay (Chunk 2 Task 2.1). Question pool files are
NEVER edited; this overlay is the only source of post-hoc adjudication.

Audit-decisions.json is a paper artifact: the published version makes
every adjudication decision auditable."
```

- [ ] **Step 3: Rebuild eval-index.json with the overlay applied**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts 2>&1 | tail -10
```

Expected: prints `audit overlay: N decisions` (where N = number of decisions made). Per-arm `mechanical_pass_strict_audited` counts now reflect the overlay.

```bash
git add apps/site/public/eval-index.json apps/site/public/eval-arms/
git commit -m "data(eval): rebuild eval-index.json + eval-arms/ with audit overlay applied

All 9 arms aggregated with mechanical_pass_strict_audited reflecting
the human audit decisions from eval/audit-decisions.json."
```

---

## Chunk 4 Done Criteria

- [ ] All Chunk 4 tasks committed (audit-candidates.ts, --strict-prompt flag, gitignore for runs/, audit-decisions.json, eval-index.json + eval-arms/)
- [ ] All 9 run directories exist under `apps/mcp/eval/runs/`
- [ ] Each run dir has ~1,120 q-*.json files (`for d in apps/mcp/eval/runs/*/; do echo -n "$d: "; ls "$d" | wc -l; done`)
- [ ] `eval/audit-decisions.json` has decisions for the ~146 candidate cases (or however many the auditor judged)
- [ ] `apps/site/public/eval-index.json` shows 9 arms in the registry
- [ ] `apps/site/public/eval-arms/` has 9 per-arm files
- [ ] Total eval cost (sum of per-arm `total_cost_usd` across all 9) is in the expected range:
  - Grok×3: ~$39 (3×$13)
  - Sonnet×2: ~$0 marginal (Max plan)
  - Haiku×2: ~$0 marginal (Max plan)
  - Gemini Flash Lite: ~$8
  - gpt-5-nano: ~$5
  - **Total marginal: ~$52** (the grok strict-prompt is the new $13 over the existing $26 marginal originally projected; close to but a bit over the original budget)

**What this chunk unblocks:** Chunk 5 (final tests + integration) + paper draft (the numbers exist).

---

## Chunk 5: Tests + integration verification + docs

**Why fifth:** Chunks 1-4 produced code + data. Chunk 5 verifies everything works together end-to-end before declaring the rework done.

### Task 5.1: Full test suite + no-regression check

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/siraj/falsafa && bun test 2>&1 | tail -15
cd /Users/siraj/falsafa/apps/mcp && bun test 2>&1 | tail -10
cd /Users/siraj/falsafa/apps/site && bun test 2>&1 | tail -10
```

Expected: all suites pass. Tally:
- `eval/__tests__/` — 4 files (computeMechanicalResult, extract-citations-from-corpus, citation-quality, armTagFromRunDir): 31 tests
- `apps/mcp/eval/__tests__/` — 2 files (recorded-tool-call, citation-provenance): 9 tests
- `apps/site/src/lib/__tests__/` — 2 files (eval-types, eval-arms): existing + 4 + 4 + 4 = ~12 new
- `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` — IRON RULE: PASSES verbatim

- [ ] **Step 2: Verify the iron-rule single-arm-regression test**

```bash
cd /Users/siraj/falsafa
bun test apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts 2>&1
```

Expected: PASS. If it fails, the rework broke the historic 84.7% headline reproducibility. STOP and fix before proceeding.

### Task 5.2: Site build smoke + visual check

- [ ] **Step 1: Local site build**

```bash
cd /Users/siraj/falsafa/apps/site
bun run build 2>&1 | tail -10
```

Expected: build succeeds. No TypeScript errors. `dist/` populated.

- [ ] **Step 2: Visual smoke**

```bash
cd /Users/siraj/falsafa/apps/site
bun run preview &
sleep 3
open http://localhost:4322/eval/
open http://localhost:4322/eval/compare/
open http://localhost:4322/eval/methodology/
open http://localhost:4322/eval/q-0001/
```

Manually verify each page:
- /eval/ — leaderboard renders 5 arms, ranked by graded score
- /eval/compare/ — empty default; pick 2 arms via picker; flips-* filter chips appear
- /eval/methodology/ — three sub-sections render
- /eval/q-0001/ — vertical stack of all 9 arms; each row shows answer + citations + 4 metrics + citation_quality

```bash
# Stop the preview server
kill %1
```

### Task 5.3: Deploy + production verification

- [ ] **Step 1: Push to main (atomic — Chunk 2 Task 2.7 + all of Chunk 3 + Chunk 4)**

Verify what's about to push:

```bash
cd /Users/siraj/falsafa
git status
git log origin/main..HEAD --oneline | head -30
```

Expected: 20+ commits. All chunks 1-4. No uncommitted changes.

```bash
git push origin main
```

Vercel auto-deploys. Wait ~2 min.

- [ ] **Step 2: Verify production**

```bash
# Each should return 200
/usr/bin/curl -sI https://www.falsafa.ai/eval/ | head -3
/usr/bin/curl -sI https://www.falsafa.ai/eval/compare/ | head -3
/usr/bin/curl -sI https://www.falsafa.ai/eval/methodology/ | head -3
/usr/bin/curl -sI https://www.falsafa.ai/eval/q-0001/ | head -3

# Verify per-arm JSON files are served gzipped
/usr/bin/curl -sI -H 'Accept-Encoding: gzip,br' https://www.falsafa.ai/eval-arms/wiki.json | grep -i 'content-encoding\|content-length'
```

Expected: 200 on all four pages. Per-arm files have `content-encoding: br` (or `gzip`) and content-length significantly less than the raw file size.

- [ ] **Step 3: Click-test in browser**

Manually:
- Visit `https://www.falsafa.ai/eval/`
- Click into a case (e.g., q-0001 or any link)
- Verify the case-detail page renders all 9 arms
- Visit `/eval/compare`, pick 2 arms, verify flips-pass filter works
- Visit `/eval/methodology`, verify sub-sections render with their default arm selections

### Task 5.4: Update top-level README + TODOS.md

- [ ] **Step 1: Update top-level README's launch table**

The Status table at `/Users/siraj/falsafa/README.md:210-225` mentions item 11 (arXiv preprint) as gated on the eval rework. After this rework lands, that gate is unblocked. Update the row:

```diff
- | 11 | arXiv preprint | pending — gated on graded-score eval rework (`TODOS.md`) |
+ | 11 | arXiv preprint | pending — eval rework landed 2026-05-02; paper draft is next |
```

Also update item 4 (eval explorer) to mention the new four-metric scoring + 9-arm matrix.

- [ ] **Step 2: Update TODOS.md**

The "EVAL SCORING REWORK" section (lines ~46-115) is now resolved. Move it to a "Completed" section or delete it. Add new TODOs flagged in the plan for v0.2:
- Adversarial test set (~150 fail-substring questions)
- Run-variance characterization (5x re-runs + paired t-test)
- Local OSS model evaluation (Llama 4 / DeepSeek / Qwen / Gemma via Ollama)
- Flagship-tier arms (Opus, Grok 4 full, Gemini 2.5 Pro, GPT-5 full)

- [ ] **Step 3: Commit + push**

```bash
cd /Users/siraj/falsafa
git add README.md TODOS.md
git commit -m "docs: eval scoring rework landed; arXiv preprint unblocked

- Status table row 11 (arXiv preprint) no longer gated on eval rework
- TODOS.md EVAL SCORING REWORK section moved to Completed
- New TODOs added for v0.2: adversarial set, run-variance, local OSS,
  flagship-tier arms"
git push origin main
```

---

## Chunk 5 Done Criteria

- [ ] Full test suite passes: `bun test` from repo root + apps/mcp + apps/site all green
- [ ] Iron-rule single-arm-regression test PASSES
- [ ] Local site build succeeds; all 4 eval URLs render
- [ ] Production deploy verified: 4 URLs return 200, per-arm files served compressed
- [ ] Manual click-test in browser confirms multi-arm UI works (compare picker, flips filters, case-detail vertical stack)
- [ ] README + TODOS.md updated

---

## Final completion criteria (the whole rework)

- [ ] Total commits since plan start: ~25-30 across 5 chunks
- [ ] `@falsafa/mcp` itself untouched (the rework is eval + site, not the MCP server)
- [ ] All 9 arms shipped on `https://www.falsafa.ai/eval/`
- [ ] `eval/audit-decisions.json` is a paper-publishable artifact (committed to git)
- [ ] No TypeScript errors. No regression test failures. No deprecated API usages.
- [ ] Vercel auto-deploy fired green
- [ ] arXiv preprint can be drafted from the new numbers (Chunk 5 unblocks it)

**Total marginal cost incurred:** ~$52 ($13 grok-strict-prompt + $13 grok baseline+wiki re-runs at the new schema + $8 Gemini + $5 gpt-5-nano + $0 Anthropic via Max). Slightly over the original $26 estimate because re-running Grok wasn't free (the existing data was unrecoverable per Codex finding D5).

**Total wallclock:** highly variable; dominated by the Sonnet/Haiku Anthropic-Max-plan rate limits (~1-3 days each). Worst case ~6 days end-to-end if Sonnet + Haiku are run sequentially; ~3 days if parallel via two Claude Max accounts.

**What's next after the rework:** paper draft. Numbers are now reproducible, methodologically airtight, and reader-auditable via the explorer + audit-decisions.json.
