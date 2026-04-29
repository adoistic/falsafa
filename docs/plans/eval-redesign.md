# Eval / Audit redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three coupled changes from [docs/designs/eval-redesign.md](../designs/eval-redesign.md) — collapse the four Sonnet runs into one model, add per-case detail pages at `/eval/q-NNNN/`, and restructure `/try/` into two equal-weight cards (install + BYOK live).

**Architecture:** Static-first. The merge happens in [eval/build-eval-json.ts](../../eval/build-eval-json.ts) so the consumed `eval.json` is already correct. Per-case pages are pre-rendered via Astro `getStaticPaths` (no Preact island, just HTML + CSS). `/try/` keeps its existing BYOK Preact island; new structure wraps it. Shared types live in a new `apps/site/src/lib/eval-types.ts` module so Astro components and the existing islands don't cross-import.

**Tech Stack:** Astro 5.18, Preact (BYOK + eval-explorer islands), TypeScript, Bun, `marked` (Markdown), Pagefind (search index), `@tanstack/virtual-core` (being removed).

**Phasing rationale:** Foundation first (types + build script), then explorer cleanup (consumes new shape), then per-case page (consumes shape + new components), then `/try/` enhancements (BYOK URL param + JSON download), then `/try/` restructure (uses new shared components). Each phase produces a working, testable site.

---

## File structure

### New files

| Path | Purpose |
|---|---|
| `apps/site/src/lib/eval-types.ts` | Single home for `EvalToolCall`, `EvalCitation`, `EvalCaseResult`, `EvalCase`, `EvalJudge`, `EvalModelMeta`, `EvalJson`, `ByokDownloadPayload`. Exports `passOf()`. Used by both Astro pages/components and Preact islands. |
| `apps/site/src/lib/eval-paragraph-link.ts` | `(answer, citations, listChapters) → answerHtml` helper. Walks the answer text, replaces `p-XXXXXX` tokens with anchors when a matching citation exists, leaves them as plain text otherwise. |
| `apps/site/src/lib/eval-paragraph-link.test.ts` | Unit tests for the resolver. |
| `apps/site/src/lib/byok-download.ts` | `(state) → ByokDownloadPayload` builder for the BYOK download button. ToolCall→EvalToolCall mapping lives here. |
| `apps/site/src/lib/byok-download.test.ts` | Unit tests for the builder. |
| `apps/site/src/components/NonDeterminismCaveat.astro` | Shared 3-sentence caveat block. |
| `apps/site/src/components/ReportThis.astro` | GitHub issue + email buttons. Optional case context. |
| `apps/site/src/components/InstallCard.astro` | Left-card on `/try/`. Tab strip for surfaces + "Coming soon" pill row. |
| `apps/site/src/components/ToolCallTrace.astro` | Pre-recorded tool-call cards. |
| `apps/site/src/components/RunItYourself.astro` | Primary `/try/?prompt=` CTA + collapsible CLI block. |
| `apps/site/src/pages/eval/[id].astro` | Per-case detail page, pre-rendered. |
| `apps/site/src/styles/tool-trace.css` | Shared CSS for tool-call cards (live + recorded). |

### Modified files

| Path | Change |
|---|---|
| [eval/build-eval-json.ts](../../eval/build-eval-json.ts) | Collapse `*:sonnet` runs into one `sonnet` model entry. Stamp `result.from_run`. Update `humaniseModelName` to drop the run-dir suffix. |
| [apps/site/src/islands/eval-explorer/types.ts](../../apps/site/src/islands/eval-explorer/types.ts) | Becomes a re-export of `lib/eval-types.ts`. Adds `from_run: string` to `EvalCaseResult`. |
| [apps/site/src/islands/eval-explorer/EvalExplorer.tsx](../../apps/site/src/islands/eval-explorer/EvalExplorer.tsx) | Drop Run filter; drop inline expansion; drop virtualization; row → `<a href="/eval/<id>/">`; collapse header to one Sonnet row with mechanical-pass caption. |
| [apps/site/src/islands/byok/ByokDemo.tsx](../../apps/site/src/islands/byok/ByokDemo.tsx) | Read `?prompt=` URL param on mount; render `[Download run as JSON]` after a run completes. |
| [apps/site/src/islands/byok/types.ts](../../apps/site/src/islands/byok/types.ts) | No type changes; serves as the source for `byok-download.ts`'s ToolCall→EvalToolCall mapping. |
| [apps/site/src/pages/try/index.astro](../../apps/site/src/pages/try/index.astro) | Restructure into two-card hero (`<InstallCard>` + `<ByokDemo>`) + clone block + caveat + report. |
| [apps/site/src/pages/eval/index.astro](../../apps/site/src/pages/eval/index.astro) | No structural change; the explorer island handles the new behavior. |
| [apps/site/package.json](../../apps/site/package.json) | Drop `@tanstack/virtual-core` dependency. |

---

## Chunk 1: Foundation (data + types + explorer cleanup)

This chunk delivers a working site where the four Sonnet runs appear as one model, the explorer drops the Run filter and the inline expansion, and rows are anchors that 404 (the per-case pages don't exist yet). After this chunk: `bun run dev` shows the cleaner explorer; clicking a row 404s. That's expected — chunk 2 lands the pages.

### Task 1: Create the shared types module

**Files:**
- Create: `apps/site/src/lib/eval-types.ts`
- Modify: `apps/site/src/islands/eval-explorer/types.ts` (becomes re-export)

- [ ] **Step 1.1: Move types to `lib/eval-types.ts`**

Copy the full contents of `apps/site/src/islands/eval-explorer/types.ts` into a new file at `apps/site/src/lib/eval-types.ts`. Add `from_run: string` to `EvalCaseResult` and add the new `ByokDownloadPayload` interface (see Section 3 of the spec for exact shape).

The new file's exports:
```ts
export interface EvalModelMeta { id: string; name: string; label: string; pass_count?: number; case_count?: number; }
export interface EvalToolCall { name: string; args: unknown; result_summary?: string; }
export interface EvalCitation { work_slug: string; chapter_number?: number; paragraph_id?: string; }
export interface EvalJudge { factual_correct: boolean; citation_backed: boolean; hallucinated: boolean; naturalness_1to5: number; reasoning: string; judge_model: string; }
export interface EvalCaseResult {
  answer: string;
  tool_calls: EvalToolCall[];
  citations: EvalCitation[];
  duration_ms: number;
  mechanical_pass?: boolean;
  judge?: EvalJudge;
  /** Original run dir (e.g. "1k-orchestrated-200"). New in eval-redesign. */
  from_run: string;
}
export interface EvalCase { id: string; category: string; difficulty: string; prompt: string; rationale?: string; expected_works: string[]; results: Record<string, EvalCaseResult>; }
export interface EvalJson { version: string; generated_at: string; models: EvalModelMeta[]; cases: EvalCase[]; }

export interface ByokDownloadPayload {
  schema_version: "falsafa-byok/v1";
  generated_at: string;
  prompt: string;
  provider: "openrouter" | "anthropic" | "google" | "openai";
  model: string;
  result: EvalCaseResult;  // result.from_run will always be "live-byok" for downloads
}

export function passOf(result: EvalCaseResult | undefined): boolean | null { /* unchanged from existing impl */ }
```

- [ ] **Step 1.2: Convert `islands/eval-explorer/types.ts` to a re-export**

Replace the full contents of `apps/site/src/islands/eval-explorer/types.ts` with:
```ts
/**
 * Re-export of the shared eval types module. Lives at the canonical
 * location lib/eval-types.ts so Astro pages/components and Preact
 * islands import from the same source. This file exists for
 * backward-compatibility with existing internal imports inside the
 * eval-explorer island.
 */
export * from "../../lib/eval-types";
```

- [ ] **Step 1.3: Verify typecheck passes**

Run: `cd apps/site && bun run check`
Expected: No new type errors. Pre-existing errors (if any) unchanged.

- [ ] **Step 1.4: Commit**

```bash
git add apps/site/src/lib/eval-types.ts apps/site/src/islands/eval-explorer/types.ts
git commit -m "refactor(site): move eval types to lib/eval-types.ts

Single source of truth for EvalCase, EvalCaseResult, EvalToolCall,
etc. Astro components and Preact islands both import from here.
The islands/eval-explorer/types.ts is now a thin re-export to
preserve the existing import surface inside the island.

Adds from_run: string to EvalCaseResult (will be populated by the
build script in the next commit) and the new ByokDownloadPayload
type for the /try download button."
```

---

### Task 2: Update build-eval-json.ts to merge Sonnet runs

**Files:**
- Modify: `eval/build-eval-json.ts`

- [ ] **Step 2.1: Add `runDir` to `ResolvedRun` and replace `humaniseModelName`**

In [eval/build-eval-json.ts](../../eval/build-eval-json.ts) at line 248, the `ResolvedRun` interface has `modelId: string` (currently `${runDir}:${sub}`). Add a separate `runDir: string` field so the run-dir is available without parsing `modelId`. Update the constructor at line 304 to populate it:

```ts
out.push({
  modelId: `${runDir}:${sub}`,         // legacy, kept for now
  modelLabel: sub,                     // already exists
  runDir,                              // NEW
  modelName: humaniseModelLabel(sub),  // see below
  resultsDir: subPath,
  judgeDir,
});
```

Replace the existing `humaniseModelName(sub, runDir)` helper with `humaniseModelLabel(label)` — takes only the label and returns just the human-readable model name (e.g. `"Claude Sonnet 4.6"`). Drop the `· ${runDir}` concatenation. Internal call sites get the simpler invocation.

- [ ] **Step 2.2: Re-key `c.results` from `modelId` to `modelLabel`, stamp `from_run`**

The current main loop at line 443 does `c.results[run.modelId] = result;`. Change to:

```ts
result.from_run = run.runDir;       // stamp before storing
const existing = c.results[run.modelLabel];
if (existing) {
  // Same model, multiple runs — defensive merge. Pick the result whose
  // source q-NNNN.json has the larger mtime (most recently generated).
  const newer = pickByMtime(existing, result, run);
  c.results[run.modelLabel] = newer;
  console.warn(
    `[merge] case ${c.id} has results from multiple runs for model ${run.modelLabel}; ` +
    `keeping ${newer === result ? run.runDir : "previous"}.`
  );
} else {
  c.results[run.modelLabel] = result;
}
```

(`pickByMtime` is a small helper that stats the source files via `fs.statSync(...).mtimeMs`. Today this branch never fires — every case appears in one run only — but the defensive code matches the spec's "pick the most-recently-generated run by `mtime`".)

- [ ] **Step 2.3: Replace per-model aggregation with one entry**

After the main loop finishes populating `c.results`, the existing code iterates `runs[]` to build the `models[]` array. Replace this with a per-`modelLabel` aggregation:

```ts
const labels = new Set(runs.map((r) => r.modelLabel));
const models: EvalModelMeta[] = [];
for (const label of labels) {
  let pass = 0, total = 0;
  for (const c of cases) {
    const r = c.results[label];
    if (!r) continue;
    total += 1;
    if (passOf(r) === true) pass += 1;
  }
  models.push({
    id: label,
    name: humaniseModelLabel(label),
    label,
    pass_count: pass,
    case_count: total,
  });
}
```

`pass_count` and `case_count` are now build-time fields on every model entry. The explorer reads them directly (Task 4 removes the now-redundant runtime aggregation).

- [ ] **Step 2.4: Regenerate `eval.json` and verify**

Run: `bun run eval/build-eval-json.ts` (the script has a top-level `main()` invocation at the bottom of the file, so this works as-is).

Expected: `apps/site/public/eval.json` rewritten. Check the shape:

```bash
jq '.models | length' apps/site/public/eval.json
# expect: 1
jq '.models[0]' apps/site/public/eval.json
# expect: { id: "sonnet", name: "Claude Sonnet 4.6", label: "sonnet", pass_count: <n>, case_count: 268 }
jq '.cases[0].results | keys' apps/site/public/eval.json
# expect: ["sonnet"]
jq '.cases[0].results.sonnet.from_run' apps/site/public/eval.json
# expect: "1k-orchestrated-200" (or similar run dir name)
jq -r '.cases[].results.sonnet.from_run' apps/site/public/eval.json | sort -u
# expect: 4 unique run-dir names (1k-final-patched-sonnet, 1k-orchestrated-200, 1k-orchestrated-batch2, batch3)
```

- [ ] **Step 2.5: Commit**

```bash
git add eval/build-eval-json.ts apps/site/public/eval.json
git commit -m "build(eval): merge sonnet runs into one model entry

Four runs (1k-final-patched-sonnet, 1k-orchestrated-200,
1k-orchestrated-batch2, batch3) collapse into one EvalModelMeta
keyed by 'sonnet'. Each case's results map re-keys from
'<runDir>:sonnet' to just 'sonnet', with the original run dir
preserved in result.from_run for traceability.

humaniseModelName(sub, runDir) replaced with humaniseModelLabel(label)
— drops the run-dir suffix from the human-readable name.

pass_count/case_count aggregate across runs at build time, so the
explorer doesn't need to recompute at runtime."
```

---

### Task 3: Drop the Run filter from the explorer

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`

- [ ] **Step 3.1: Remove the `Run` `FilterChipGroup` JSX block**

In [EvalExplorer.tsx](../../apps/site/src/islands/eval-explorer/EvalExplorer.tsx), find the `<FilterChipGroup legend="Run" ...>` block (search the file for `legend="Run"`) and delete it entirely, including the preceding comment block that explains the redundancy.

- [ ] **Step 3.2: Remove `models` from the `Filters` state**

In the state interface, remove `models: Set<string>`. In the default state, remove the `models: new Set()` initialization. In the `clearAll`/`reset` handler, remove the `models: new Set(models.map((m) => m.id))` reset (or replace it with a no-op so the rest of the function still typechecks).

- [ ] **Step 3.3: Update the filter pipeline**

Find the filter pipeline (around line 180-205) that currently does `Array.from(filters.models).map(...)`. Replace with a single resolution: every case's verdict comes from the one `result.sonnet`. The pipeline becomes:

```ts
const filtered = data.cases.filter((c) => {
  if (filters.categories.size > 0 && !filters.categories.has(c.category)) return false;
  if (filters.difficulties.size > 0 && !filters.difficulties.has(c.difficulty)) return false;
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase();
    if (!c.id.toLowerCase().includes(q) && !c.prompt.toLowerCase().includes(q)) return false;
  }
  if (filters.verdict !== "all") {
    const result = c.results.sonnet;
    const v = passOf(result);
    if (filters.verdict === "pass" && v !== true) return false;
    if (filters.verdict === "fail" && v !== false) return false;
    if (filters.verdict === "mixed" && v !== null) return false;
  }
  return true;
});
```

- [ ] **Step 3.4: Verify typecheck and dev server still render**

Run: `cd apps/site && bun run check`
Expected: no new errors.

Run: `cd apps/site && bun run dev` (in a separate shell, or leave the existing dev server running — Vite hot-reloads).
Visit `http://localhost:4321/eval/`.
Expected: the Run filter chip group is gone; CATEGORY and DIFFICULTY chips work; case list still renders.

- [ ] **Step 3.5: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx
git commit -m "feat(eval): drop the Run filter chip group

Now that all sonnet runs are one model entry, there's nothing to
filter on. The filter pipeline reads from result.sonnet directly.
Header and inline expansion changes follow in the next commits."
```

---

### Task 4: Drop runtime headline aggregation + add caption

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`
- Modify: `apps/site/src/styles/eval.css`

- [ ] **Step 4.1: Remove the `headline` `useMemo`**

In [EvalExplorer.tsx](../../apps/site/src/islands/eval-explorer/EvalExplorer.tsx) at line 213, the existing `headline` `useMemo` walks `data.cases` to recompute `pass_count`/`case_count` per model. After Task 2, these fields are populated at build time and live on `data.models[i]` directly. Delete the `useMemo` block (lines ~213-225).

At line 231, change `models={headline}` to `models={data.models}` so the `Header` reads build-time fields directly.

- [ ] **Step 4.2: Add the mechanical-pass caption to the `Header`**

In the `Header` component (around line 256-291), inside each `.eval-header-stat` model row, add a small caption below the percentage:

```tsx
<span class="eval-header-label">
  {m.name} <span class="eval-header-frac">({pass}/{total})</span>
</span>
<span class="eval-header-caption">mechanical-pass · judge layer pending</span>
```

- [ ] **Step 4.3: Style the caption**

In `apps/site/src/styles/eval.css`, append:

```css
.eval-header-caption {
  font-size: 11px;
  color: var(--ink-muted);
  font-family: var(--font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  display: block;
  margin-top: 4px;
}
```

- [ ] **Step 4.4: Smoke-test the collapsed header**

Visit `http://localhost:4321/eval/`.
Expected: one stat row reading e.g. `87% Claude Sonnet 4.6 (234/268)` with `mechanical-pass · judge layer pending` underneath. Total `268 cases` block unchanged.

- [ ] **Step 4.5: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx apps/site/src/styles/eval.css
git commit -m "feat(eval): single Sonnet header row + mechanical-pass caption

Removes the headline useMemo that recomputed pass_count/case_count
at runtime — those fields are now stamped at build time by
build-eval-json. Header reads data.models directly.

Adds the 'mechanical-pass · judge layer pending' caption so readers
don't mistake the percentage for a judge verdict (no judge data on
any case today; spec calls this the no-op-until-judge state)."
```

---

### Task 5: Convert case rows to anchors + drop inline expansion

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`

- [ ] **Step 5.1: Identify the row-rendering JSX**

Search for the case-row rendering (where each `EvalCase` becomes a clickable element, currently triggering inline expansion via state). Note the file's row component name (likely `CaseRow` or inline JSX).

- [ ] **Step 5.2: Replace the row render with an `<a href>`**

Each row becomes:
```tsx
<a class="eval-case-row" href={`/eval/${c.id}/`}>
  <span class="eval-case-id">{c.id}</span>
  <span class="eval-case-cat">{c.category}</span>
  <span class="eval-case-diff">{c.difficulty}</span>
  <span class="eval-case-prompt">{c.prompt}</span>
  <span class="eval-case-verdict-pill" data-verdict={passOf(c.results.sonnet) === true ? "pass" : passOf(c.results.sonnet) === false ? "fail" : "mixed"}></span>
  <span class="eval-case-arrow" aria-hidden="true">↗</span>
</a>
```

- [ ] **Step 5.3: Delete the inline expansion machinery**

Remove the state hook tracking which case is expanded — at line 67: `const [expandedId, setExpandedId] = useState<string | null>(null);`. Remove the prop chain that threads it through:
- Lines 149-150: drop `expandedId={expandedId}` and `setExpandedId={setExpandedId}` from the `<Loaded>` element.
- Lines 161-162 + 167-168: remove `expandedId` and `setExpandedId` from `Loaded`'s parameter destructure and prop type.
- Lines 247-248: drop `expandedId={expandedId}` and `setExpandedId={setExpandedId}` from the `<CaseList>` element.
- Lines 453-454 + 459-460: remove `expandedId` and `setExpandedId` from `CaseList`'s parameter destructure and prop type.

Remove the JSX block that conditionally renders the per-case answer + trace inline (the `cases[i]?.id === expandedId ? ... : ...` ternary at line 469 disappears once virtualization is removed in Step 5.4).

Remove the `<CaseExpanded>` (or equivalent) component if it has no other consumers — confirm with `grep -rn 'CaseExpanded' apps/site/src/`.

- [ ] **Step 5.4: Drop `useVirtualizer` and the `@tanstack/virtual-core` import**

Remove the import at line 21-28 and the virtualizer setup (the `useVirtualizer` call site near line 465 and the surrounding measurement logic). Replace the virtualized list render with a plain `<ul class="eval-case-list">{filtered.map((c) => <CaseRow key={c.id} c={c} />)}</ul>`. 268 cases render fine without virtualization.

Before removing the dependency, confirm no other consumer:
```bash
grep -rn '@tanstack/virtual-core\|useVirtualizer' apps/site/src/
# expect: only EvalExplorer.tsx hits, all of which we're removing in this step
```

Then drop `@tanstack/virtual-core` from `apps/site/package.json` dependencies. Run `bun install` to refresh the lockfile.

- [ ] **Step 5.5: Verify typecheck passes and the dev server shows anchor rows**

Run: `cd apps/site && bun run check`
Expected: no new errors.

Visit `http://localhost:4321/eval/`. Click a case row.
Expected: navigation to `/eval/q-NNNN/` (will 404 — pages don't exist yet, that's fine for this chunk). The inline expansion is gone.

- [ ] **Step 5.6: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx apps/site/package.json apps/site/bun.lock
git commit -m "feat(eval): rows become anchors, inline expansion + virtualizer dropped

Each case row is now <a href='/eval/<id>/'>. The inline expand-to-
show-answer behavior is removed entirely (the per-case page in the
next chunk is the new home for that content). Virtualization
(useVirtualizer + @tanstack/virtual-core) was needed for the inline-
expansion case-by-case render; with rows as flat anchors, 268
elements render fine without it.

Anchors will 404 until eval/[id].astro lands in the next chunk —
this is intentional for chunk-by-chunk landability."
```

---

### Chunk 1 verification

After all five tasks land, run:

```bash
cd apps/site && bun run check    # typecheck — no new errors
cd apps/site && bun run dev      # visit /eval/ — header collapsed, no Run filter,
                                 # rows are anchors, click → 404 (expected)
```

Visit and confirm visually:
- Header shows one `Claude Sonnet 4.6` stat row with mechanical-pass caption.
- CATEGORY + DIFFICULTY filters still work.
- Search input still filters by case id and prompt.
- Verdict-tab (All / Pass / Fail / Mixed) still works.
- Each row is clickable, navigates to `/eval/q-NNNN/` (404).

If all of the above hold, chunk 1 is done.

---

## Chunk 2: Per-case detail page

This chunk lands the per-case page at `/eval/q-NNNN/` plus all the shared Astro components it needs. The five new components in this chunk are reused on `/try/` in Chunk 3, so they ship with shared CSS extracted up front. After this chunk: clicking a row on `/eval/` navigates to a fully-rendered detail page.

### Task 6: Build the paragraph-link helper with TDD

**Files:**
- Create: `apps/site/src/lib/eval-paragraph-link.ts`
- Create: `apps/site/src/lib/eval-paragraph-link.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `apps/site/src/lib/eval-paragraph-link.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { linkifyAnswer } from "./eval-paragraph-link";
import type { EvalCitation } from "./eval-types";

// Fixture: a tiny chapters map mimicking listChapters() output.
// Real listChapters returns ChapterMeta[]; the helper only needs the
// fields it touches. Use a minimal stub.
const fakeListChapters = (workSlug: string) => {
  if (workSlug === "mirza-ghalib-diwan-e-ghalib-74ed4c") {
    return [{ chapter_number: 115, chapter_slug: "koi-ummeed-bar-nahin-aati" }];
  }
  return [];
};

describe("linkifyAnswer", () => {
  test("replaces a p-XXXXXX token with an anchor when a matching citation exists", () => {
    const answer = "The opening matla is paragraph p-92c600 in the translation.";
    const citations: EvalCitation[] = [{
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
      chapter_number: 115,
      paragraph_id: "p-92c600",
    }];
    const out = linkifyAnswer(answer, citations, fakeListChapters);
    expect(out).toContain('<a href="/works/mirza-ghalib-diwan-e-ghalib-74ed4c/koi-ummeed-bar-nahin-aati/translation/#p-92c600">p-92c600</a>');
  });

  test("leaves a p-XXXXXX token as plain text when no matching citation", () => {
    const answer = "Hallucinated reference: p-deadbe.";
    const out = linkifyAnswer(answer, [], fakeListChapters);
    expect(out).toContain("p-deadbe");
    expect(out).not.toContain("<a ");
  });

  test("handles multi-citation answers — each token resolves to its own work", () => {
    const answer = "See p-aaa111 and p-bbb222 for the comparison.";
    const citations: EvalCitation[] = [
      { work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c", chapter_number: 115, paragraph_id: "p-aaa111" },
      { work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c", chapter_number: 115, paragraph_id: "p-bbb222" },
    ];
    const out = linkifyAnswer(answer, citations, fakeListChapters);
    expect(out).toContain("#p-aaa111");
    expect(out).toContain("#p-bbb222");
  });

  test("falls back to plain text when chapter_slug can't be resolved", () => {
    const citations: EvalCitation[] = [{
      work_slug: "no-such-work", chapter_number: 1, paragraph_id: "p-foo",
    }];
    const out = linkifyAnswer("Reference: p-foo.", citations, fakeListChapters);
    expect(out).toContain("p-foo");
    expect(out).not.toContain("<a ");
  });
});
```

- [ ] **Step 6.2: Run the test — confirm it fails**

Run: `cd apps/site && bun test src/lib/eval-paragraph-link.test.ts`
Expected: FAIL — `linkifyAnswer is not a function` (or "Cannot find module ./eval-paragraph-link").

- [ ] **Step 6.3: Implement the helper**

Create `apps/site/src/lib/eval-paragraph-link.ts`:

```ts
/**
 * Walk an answer string, replace `p-XXXXXX` tokens with anchors when
 * a matching citation resolves to a real chapter URL, and return the
 * resulting HTML. Tokens with no matching citation render as plain text
 * (and emit a build-time warning, advisory only — does NOT fail the
 * build, since legitimate paraphrases sometimes cite ids outside the
 * formal `result.citations[]` set).
 *
 * The chapter URL is `/works/<work_slug>/<chapter_slug>/translation/#p-XXXXXX`.
 * Variant is hard-coded to `translation` — the canonical English variant
 * matches the existing default in pages/works/[slug]/[chapter]/[variant].astro.
 *
 * `listChaptersFn` is dependency-injected so this helper is unit-testable
 * without booting Astro / loading the whole corpus. In Astro callsites,
 * pass `listChapters` from `lib/corpus.ts` directly.
 */
import type { EvalCitation } from "./eval-types";

interface ChapterStub { chapter_number: number; chapter_slug: string; }
type ListChaptersFn = (workSlug: string) => ReadonlyArray<ChapterStub>;

const TOKEN_RE = /\bp-[0-9a-f]{6}\b/gi;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function linkifyAnswer(
  answer: string,
  citations: ReadonlyArray<EvalCitation>,
  listChaptersFn: ListChaptersFn,
): string {
  // Index citations by paragraph_id for O(1) lookup per token.
  const byPid = new Map<string, EvalCitation>();
  for (const c of citations) {
    if (c.paragraph_id) byPid.set(c.paragraph_id, c);
  }

  return answer.replace(TOKEN_RE, (token) => {
    const cite = byPid.get(token);
    if (!cite || cite.chapter_number === undefined) return escapeHtml(token);
    const chapters = listChaptersFn(cite.work_slug);
    const ch = chapters.find((c) => c.chapter_number === cite.chapter_number);
    if (!ch) {
      // Citation pointed at a chapter that doesn't exist in the manifest.
      // Build-time warning, render as plain text.
      console.warn(
        `[eval-paragraph-link] no chapter for ${cite.work_slug} ch.${cite.chapter_number} (token ${token})`,
      );
      return escapeHtml(token);
    }
    const href = `/works/${cite.work_slug}/${ch.chapter_slug}/translation/#${token}`;
    return `<a href="${href}">${token}</a>`;
  });
}
```

- [ ] **Step 6.4: Run the test — confirm it passes**

Run: `cd apps/site && bun test src/lib/eval-paragraph-link.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 6.5: Commit**

```bash
git add apps/site/src/lib/eval-paragraph-link.ts apps/site/src/lib/eval-paragraph-link.test.ts
git commit -m "feat(site): linkifyAnswer helper for case page paragraph links

Walks an answer string, replaces p-XXXXXX tokens with anchors that
deep-link to the chapter page (variant=translation) when a matching
citation in result.citations[] resolves to a real chapter via
listChapters(). Tokens without a matching citation render as plain
text and emit a build-time warning (advisory, non-fatal).

Dependency-injects listChapters so the helper is unit-testable
without booting Astro. Four tests cover the happy path, the no-
citation fallback, multi-citation answers, and unresolvable chapters."
```

---

### Task 7: Shared Astro components — caveat + report

**Files:**
- Create: `apps/site/src/components/NonDeterminismCaveat.astro`
- Create: `apps/site/src/components/ReportThis.astro`

- [ ] **Step 7.1: Create `NonDeterminismCaveat.astro`**

```astro
---
/**
 * Shared 3-sentence caveat block. Used on /try/ and /eval/[id]/.
 * No props. The wording is deliberate — see docs/designs/eval-redesign.md
 * §"Why your answer might differ".
 */
---

<aside class="non-determinism-caveat">
  <h3>Why your answer might differ</h3>
  <p>
    AI answers vary in wording — your model's phrasing won't be byte-identical
    to what you see here. But Falsafa routes through deterministic tool calls
    (no vector DB, no learned retrieval), so the <em>paragraph_ids</em> the
    model lands on should match what's recorded. If you see different
    paragraph_ids cited, that's a real signal worth investigating —
    please report it.
  </p>
</aside>

<style>
  .non-determinism-caveat {
    border-top: 1px solid var(--rule);
    padding-top: var(--s-6);
    margin-top: var(--s-12);
    max-width: 60ch;
  }
  .non-determinism-caveat h3 {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    font-weight: 600;
    margin: 0 0 var(--s-3);
  }
  .non-determinism-caveat p {
    font-family: var(--font-body);
    line-height: var(--lh-body);
    color: var(--ink-muted);
    margin: 0;
  }
</style>
```

- [ ] **Step 7.2: Create `ReportThis.astro`**

```astro
---
/**
 * GitHub issue + email buttons. Optional case context pre-fills both.
 * Used on /try/ (no caseId) and /eval/[id]/ (with caseId).
 */
interface Props {
  caseId?: string;
  caseUrl?: string;
  recordedAnswer?: string;
}
const { caseId, caseUrl, recordedAnswer } = Astro.props as Props;

const REPO = "adoistic/falsafa";

function buildIssueUrl(): string {
  const title = caseId ? `Falsafa eval case ${caseId}` : "Falsafa — issue report";
  const lines = [
    "What's the issue?",
    "",
    "(describe what you observed and what you expected)",
    "",
  ];
  if (caseUrl) lines.push(`Case page: ${caseUrl}`);
  if (caseId) lines.push(`Case id: ${caseId}`);
  if (recordedAnswer) {
    const truncated = recordedAnswer.length > 1000
      ? recordedAnswer.slice(0, 1000) + "…"
      : recordedAnswer;
    lines.push("", "Recorded answer:", "```", truncated, "```");
  }
  const body = lines.join("\n");
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function buildEmailUrl(): string {
  const subject = caseId ? `Falsafa eval ${caseId}` : "Falsafa — issue";
  const body = caseUrl
    ? `Case: ${caseUrl}\n\nWhat I noticed:\n`
    : "What I noticed:\n";
  return `mailto:adnan@thothica.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const issueUrl = buildIssueUrl();
const emailUrl = buildEmailUrl();
---

<section class="report-this">
  <h3>Spot a problem?</h3>
  <p>Help us find issues — report it and we'll investigate.</p>
  <div class="report-this-actions">
    <a class="report-this-btn primary" href={issueUrl} target="_blank" rel="noopener">
      Open issue on GitHub
    </a>
    <a class="report-this-btn" href={emailUrl}>
      Email Adnan
    </a>
  </div>
</section>

<style>
  .report-this {
    border-top: 1px solid var(--rule);
    padding-top: var(--s-6);
    margin-top: var(--s-12);
  }
  .report-this h3 {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    font-weight: 600;
    margin: 0 0 var(--s-2);
  }
  .report-this p {
    color: var(--ink-muted);
    margin: 0 0 var(--s-4);
  }
  .report-this-actions {
    display: flex;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .report-this-btn {
    display: inline-block;
    padding: var(--s-2) var(--s-4);
    border: 1px solid var(--rule);
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--ink);
    text-decoration: none;
  }
  .report-this-btn.primary {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
</style>
```

- [ ] **Step 7.3: Build smoke-check**

Run: `cd apps/site && bun run check`
Expected: no new errors. (Astro components don't have unit tests; visual verification happens once they're mounted.)

- [ ] **Step 7.4: Commit**

```bash
git add apps/site/src/components/NonDeterminismCaveat.astro apps/site/src/components/ReportThis.astro
git commit -m "feat(site): shared NonDeterminismCaveat + ReportThis components

Both used on /try/ and /eval/[id]/ in upcoming commits.
NonDeterminismCaveat is a static 3-sentence block — no props.
ReportThis takes optional caseId/caseUrl/recordedAnswer; without
them it's a generic 'report a problem' pair of buttons; with them
the GitHub URL and mailto: pre-fill the issue body with case
context."
```

---

### Task 8: Shared `ToolCallTrace.astro` + extracted CSS

**Files:**
- Create: `apps/site/src/components/ToolCallTrace.astro`
- Create: `apps/site/src/styles/tool-trace.css`

- [ ] **Step 8.1: Create `tool-trace.css`**

Create `apps/site/src/styles/tool-trace.css` with the styles needed for tool-call cards. Mirror the visual treatment used by the BYOK island today (extract from `apps/site/src/styles/byok.css` — find the `.byok-tool-call` / `.byok-trace` classes or equivalent). Re-export under generic class names:

```css
/* Shared between the BYOK island's live trace and the per-case page's
   pre-recorded trace. Class names are generic so neither side has to
   import island-specific CSS. */

.tool-call-trace {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  margin: var(--s-6) 0;
}

.tool-call-card {
  border: 1px solid var(--rule);
  padding: var(--s-4);
  font-family: var(--font-sans);
}

.tool-call-name {
  font-weight: 600;
  font-size: 13px;
  text-transform: lowercase;
  letter-spacing: 0.02em;
  color: var(--accent);
  margin: 0 0 var(--s-2);
  font-family: var(--font-mono, "SF Mono", Menlo, monospace);
}

.tool-call-args {
  font-family: var(--font-mono, "SF Mono", Menlo, monospace);
  font-size: 12px;
  background: var(--paper-soft, var(--paper));
  padding: var(--s-2) var(--s-3);
  margin: 0 0 var(--s-3);
  white-space: pre-wrap;
  overflow-x: auto;
}

.tool-call-result {
  font-size: 13px;
  line-height: var(--lh-body);
  color: var(--ink-muted);
  margin: 0;
}
```

If exact `--paper-soft` / `--font-mono` tokens don't exist in `tokens.css`, fall back to the closest existing tokens (e.g. `var(--paper)`, system monospace stack).

- [ ] **Step 8.2: Create `ToolCallTrace.astro`**

```astro
---
import type { EvalToolCall } from "../lib/eval-types";
import "../styles/tool-trace.css";

interface Props { calls: EvalToolCall[]; }
const { calls } = Astro.props as Props;
---

{calls.length > 0 && (
  <ol class="tool-call-trace" aria-label="Tool calls the model made">
    {calls.map((call) => (
      <li class="tool-call-card">
        <p class="tool-call-name">{call.name}</p>
        <pre class="tool-call-args">{JSON.stringify(call.args, null, 2)}</pre>
        {call.result_summary && <p class="tool-call-result">{call.result_summary}</p>}
      </li>
    ))}
  </ol>
)}
```

- [ ] **Step 8.3: Update the BYOK island to use the same CSS classes**

In [apps/site/src/islands/byok/ByokDemo.tsx](../../apps/site/src/islands/byok/ByokDemo.tsx) (or whatever sub-component renders the live trace — likely `apps/site/src/islands/byok/ui/Trace.tsx` or similar; grep `tool-call` / `byok-tool` to find it), rename the classes to match `tool-call-trace` / `tool-call-card` / `tool-call-name` / `tool-call-args` / `tool-call-result`. Import the new shared CSS:

```ts
import "../../styles/tool-trace.css";
```

Drop the BYOK-specific CSS that's been replaced. If the BYOK trace has live-streaming-only markup (e.g. a spinner while a call is in flight), keep those classes BYOK-specific — only rename what's structurally identical.

- [ ] **Step 8.4: Smoke-test the BYOK island still renders correctly**

Visit `http://localhost:4321/try/`. Expected: provider grid, model dropdown, and (after a real or mocked run) tool-call trace with the new CSS. Visual treatment should be identical to before — the rename is mechanical.

- [ ] **Step 8.5: Commit**

```bash
git add apps/site/src/components/ToolCallTrace.astro apps/site/src/styles/tool-trace.css apps/site/src/islands/byok/
git commit -m "feat(site): shared ToolCallTrace component + CSS extraction

ToolCallTrace.astro renders pre-recorded EvalToolCall[] as cards.
The BYOK island's live trace and the per-case page's pre-recorded
trace now share styles/tool-trace.css so they don't visually drift.

The BYOK trace component is updated to use the new generic class
names (.tool-call-trace, .tool-call-card, .tool-call-name,
.tool-call-args, .tool-call-result). BYOK-specific styling for
live-streaming states (in-flight spinner, etc.) is preserved
under island-specific classes."
```

---

### Task 9: `RunItYourself.astro` — primary CTA + collapsible CLI

**Files:**
- Create: `apps/site/src/components/RunItYourself.astro`

- [ ] **Step 9.1: Create the component**

```astro
---
import type { EvalToolCall } from "../lib/eval-types";

interface Props {
  prompt: string;
  toolCalls: EvalToolCall[];
}
const { prompt, toolCalls } = Astro.props as Props;
const tryUrl = `/try/?prompt=${encodeURIComponent(prompt)}`;

// Build the replayable mcp-cli.ts commands. JSON.stringify the args
// inside single quotes for shell — small risk of single-quote-in-string
// edge cases, handle those by escaping.
function shellEscapeJson(args: unknown): string {
  const json = JSON.stringify(args);
  // Replace single quotes with the standard end-quote / escaped-quote /
  // start-quote sequence; bash and zsh both handle this.
  return `'${json.replace(/'/g, `'\\''`)}'`;
}
---

<section class="run-it-yourself">
  <h3>Run it yourself</h3>
  <p>
    See how a different model handles the same question, or replay the
    exact tool calls from your terminal.
  </p>
  <a class="run-cta" href={tryUrl}>
    Run on /try with this prompt →
  </a>

  {toolCalls.length > 0 && (
    <details class="run-cli">
      <summary>Or run from the command line</summary>
      <p class="run-cli-help">
        From a clone of <code>github.com/adoistic/falsafa</code>:
      </p>
      <pre class="run-cli-block"><code>{toolCalls.map((c) =>
        `bun run apps/mcp/eval/mcp-cli.ts ${c.name} ${shellEscapeJson(c.args)}`
      ).join("\n")}</code></pre>
    </details>
  )}
</section>

<style>
  .run-it-yourself {
    border-top: 1px solid var(--rule);
    padding-top: var(--s-6);
    margin-top: var(--s-12);
  }
  .run-it-yourself h3 {
    font-family: var(--font-display);
    font-size: var(--fs-h3);
    font-weight: 600;
    margin: 0 0 var(--s-2);
  }
  .run-it-yourself p {
    color: var(--ink-muted);
    margin: 0 0 var(--s-4);
  }
  .run-cta {
    display: inline-block;
    padding: var(--s-3) var(--s-5);
    background: var(--accent);
    color: var(--paper);
    text-decoration: none;
    font-family: var(--font-sans);
    font-weight: 500;
  }
  .run-cli {
    margin-top: var(--s-5);
  }
  .run-cli summary {
    font-family: var(--font-sans);
    font-size: 14px;
    cursor: pointer;
    color: var(--accent);
  }
  .run-cli-help {
    margin: var(--s-3) 0 var(--s-2);
  }
  .run-cli-block {
    background: var(--paper-soft, var(--paper));
    border: 1px solid var(--rule);
    padding: var(--s-3) var(--s-4);
    font-family: var(--font-mono, "SF Mono", Menlo, monospace);
    font-size: 12px;
    overflow-x: auto;
    white-space: pre;
  }
</style>
```

- [ ] **Step 9.2: Build smoke-check**

Run: `cd apps/site && bun run check`
Expected: no new errors.

- [ ] **Step 9.3: Commit**

```bash
git add apps/site/src/components/RunItYourself.astro
git commit -m "feat(site): RunItYourself component for case page

Primary CTA links to /try/?prompt=<encoded>; collapsible 'Or run
from the command line' block prints replayable mcp-cli.ts
invocations, one per recorded tool call. Shell-escapes the
JSON args so single-quote-in-string edge cases don't break."
```

---

### Task 10: Per-case detail page

**Files:**
- Create: `apps/site/src/pages/eval/[id].astro`

- [ ] **Step 10.1: Scaffold `getStaticPaths`**

```astro
---
import Base from "../../layouts/Base.astro";
import NonDeterminismCaveat from "../../components/NonDeterminismCaveat.astro";
import ReportThis from "../../components/ReportThis.astro";
import ToolCallTrace from "../../components/ToolCallTrace.astro";
import RunItYourself from "../../components/RunItYourself.astro";
import { listChapters } from "../../lib/corpus";
import { linkifyAnswer } from "../../lib/eval-paragraph-link";
import { passOf } from "../../lib/eval-types";
import type { EvalJson, EvalCase } from "../../lib/eval-types";
import type { GetStaticPaths } from "astro";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

const EVAL_JSON_PATH = resolve(process.cwd(), "public", "eval.json");

export const getStaticPaths = (() => {
  const data = JSON.parse(readFileSync(EVAL_JSON_PATH, "utf-8")) as EvalJson;
  return data.cases.map((c) => ({
    params: { id: c.id },
    props: { case: c },
  }));
}) satisfies GetStaticPaths;

const { case: c } = Astro.props as { case: EvalCase };
const result = c.results.sonnet;
const verdict = passOf(result);
const verdictText = verdict === true ? "Pass" : verdict === false ? "Fail" : "Mixed";
const verdictGlyph = verdict === true ? "✓" : verdict === false ? "×" : "—";

// Linkify p-XXXXXX tokens, then markdown-render.
const linkified = result ? linkifyAnswer(result.answer, result.citations, listChapters) : "";
const answerHtml = marked.parse(linkified, { async: false }) as string;

const caseUrl = `https://falsafa.ai/eval/${c.id}/`;
const sourceUrl = result
  ? `https://github.com/adoistic/falsafa/tree/main/apps/mcp/eval/runs/${result.from_run}/sonnet/${c.id}.json`
  : null;
---
```

- [ ] **Step 10.2: Render the page body**

Below the frontmatter, append:

```astro
<Base
  title={`${c.id} · Eval`}
  description={`Falsafa eval case ${c.id}: ${c.prompt.slice(0, 140)}…`}
>
  <article class="eval-case-page" data-pagefind-body>
    <nav class="eval-case-breadcrumb" aria-label="Breadcrumb">
      <a href="/eval/">← Eval</a>
      <span class="sep">/</span>
      <span>{c.id}</span>
      <span class={`verdict-pill verdict-${verdict === true ? "pass" : verdict === false ? "fail" : "mixed"}`}>
        {verdictGlyph} {verdictText}
      </span>
    </nav>

    <header class="eval-case-header">
      <p class="kicker">{c.category} · {c.difficulty}</p>
      <h1>{c.prompt}</h1>
      {c.rationale && <p class="rationale">Why this is in the suite: {c.rationale}</p>}
      {c.expected_works.length > 0 && (
        <div class="expected-works">
          <span class="expected-works-label">Expected works:</span>
          {c.expected_works.map((slug) => (
            <a class="expected-works-chip" href={`/works/${slug}/`}>{slug}</a>
          ))}
        </div>
      )}
    </header>

    {result ? (
      <>
        <section class="eval-case-trace">
          <h2>Tool calls</h2>
          <ToolCallTrace calls={result.tool_calls} />
        </section>

        <section class="eval-case-answer">
          <h2>Answer</h2>
          <div class="answer-body" set:html={answerHtml} />
        </section>

        {result.judge && (
          <section class="eval-case-judge">
            <h2>Judge verdict</h2>
            <ul class="judge-badges">
              <li class={result.judge.factual_correct ? "ok" : "no"}>factual_correct</li>
              <li class={result.judge.citation_backed ? "ok" : "no"}>citation_backed</li>
              <li class={result.judge.hallucinated ? "no" : "ok"}>{result.judge.hallucinated ? "hallucinated" : "not hallucinated"}</li>
            </ul>
            <p class="judge-naturalness">Naturalness: {result.judge.naturalness_1to5}/5</p>
            <blockquote class="judge-reasoning">{result.judge.reasoning}</blockquote>
            <p class="judge-model"><small>Judged by {result.judge.judge_model}</small></p>
          </section>
        )}

        <RunItYourself prompt={c.prompt} toolCalls={result.tool_calls} />

        <NonDeterminismCaveat />
        <ReportThis caseId={c.id} caseUrl={caseUrl} recordedAnswer={result.answer} />

        {sourceUrl && (
          <footer class="eval-case-meta">
            <p>From run <a href={sourceUrl}>{result.from_run}</a> · <code>{c.id}.json</code></p>
          </footer>
        )}
      </>
    ) : (
      <p class="eval-case-no-result">No recorded result for this case.</p>
    )}
  </article>
</Base>

<style>
  .eval-case-page {
    max-width: 70ch;
    margin: 0 auto;
    padding: var(--s-12) var(--s-6) var(--s-24);
    font-family: var(--font-body);
  }
  .eval-case-breadcrumb {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    font-family: var(--font-sans);
    font-size: 12px;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--s-8);
    color: var(--ink-muted);
  }
  .eval-case-breadcrumb a {
    color: var(--ink-muted);
  }
  .eval-case-breadcrumb .sep { color: var(--rule); }
  .verdict-pill {
    margin-left: auto;
    padding: 2px var(--s-3);
    border: 1px solid currentColor;
    font-weight: 600;
  }
  .verdict-pass { color: var(--accent-pass, var(--accent)); }
  .verdict-fail { color: var(--accent-fail, #b00); }
  .verdict-mixed { color: var(--ink-muted); }

  .eval-case-header { margin-bottom: var(--s-12); }
  .eval-case-header .kicker {
    font-family: var(--font-sans);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin: 0 0 var(--s-3);
  }
  .eval-case-header h1 {
    font-family: var(--font-display);
    font-size: var(--fs-h1);
    line-height: var(--lh-display);
    margin: 0 0 var(--s-4);
  }
  .rationale {
    color: var(--ink-muted);
    font-style: italic;
    margin: 0 0 var(--s-4);
  }
  .expected-works {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 13px;
  }
  .expected-works-label { color: var(--ink-muted); }
  .expected-works-chip {
    padding: 2px var(--s-3);
    border: 1px solid var(--rule);
    color: var(--ink);
    text-decoration: none;
  }

  .eval-case-trace,
  .eval-case-answer,
  .eval-case-judge { margin-bottom: var(--s-10); }
  .eval-case-trace h2,
  .eval-case-answer h2,
  .eval-case-judge h2 {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    margin: 0 0 var(--s-4);
  }
  .answer-body {
    line-height: var(--lh-body);
  }
  .answer-body a {
    color: var(--accent);
    border-bottom: 1px solid currentColor;
  }

  .judge-badges {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--s-3);
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .judge-badges li {
    padding: 2px var(--s-3);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .judge-badges .ok { background: #e8f3ea; color: #2a6f3c; }
  .judge-badges .no { background: #f7e3e3; color: #8a2222; }
  .judge-naturalness { color: var(--ink-muted); margin: 0 0 var(--s-3); }
  .judge-reasoning {
    border-left: 2px solid var(--rule);
    padding-left: var(--s-4);
    margin: 0 0 var(--s-3);
    color: var(--ink-muted);
  }

  .eval-case-meta {
    margin-top: var(--s-12);
    padding-top: var(--s-6);
    border-top: 1px solid var(--rule);
    font-size: 12px;
    color: var(--ink-muted);
    font-family: var(--font-sans);
  }
  .eval-case-no-result {
    padding: var(--s-12);
    text-align: center;
    color: var(--ink-muted);
  }
</style>
```

- [ ] **Step 10.3: Smoke-test page rendering**

Run: `cd apps/site && bun run dev` (Vite picks up the new file).
Visit `http://localhost:4321/eval/q-0002/`.

Expected: full page renders. Breadcrumb at top, prompt as h1, "expected works" chip linking to `/works/mirza-ghalib-diwan-e-ghalib-74ed4c/`, tool calls listed, answer rendered with `p-92c600` as a clickable anchor, no judge block (no judge data), Run It Yourself CTA, caveat block, report buttons, run metadata footer.

Click the `p-92c600` anchor.
Expected: navigates to `/works/mirza-ghalib-diwan-e-ghalib-74ed4c/<chapter-115-slug>/translation/#p-92c600`. The page loads and (if the anchor exists in the rendered chapter HTML) scrolls to the cited paragraph.

- [ ] **Step 10.4: Build-time check — every case page builds**

Run: `cd apps/site && bun run build`
Expected: succeeds. The build log mentions "Generated /eval/q-NNNN/" 268 times. No errors.

If a `[eval-paragraph-link]` warning fires, note it — that's the helper telling us a citation pointed at a chapter that doesn't exist in the manifest. Investigate but do not fail the build.

- [ ] **Step 10.5: Commit**

```bash
git add apps/site/src/pages/eval/[id].astro
git commit -m "feat(site): per-case detail page at /eval/q-NNNN/

Pre-rendered via getStaticPaths over every case in eval.json.
Pure HTML — no Preact island. Layout follows the spec:
breadcrumb + verdict pill, prompt as h1, rationale + expected
works, tool-call trace, markdown answer with linkified
paragraph_ids, judge verdict (no-op until judge data lands),
RunItYourself CTA, NonDeterminismCaveat, ReportThis, and a
run-metadata footer linking to the source q-NNNN.json on GitHub.

Anchor links from the case row on /eval/ now resolve. Pagefind
indexes the page body via data-pagefind-body."
```

---

### Chunk 2 verification

```bash
cd apps/site && bun run check        # typecheck — clean
cd apps/site && bun run dev          # /eval/q-0002/ renders end-to-end
cd apps/site && bun test src/lib/    # paragraph-link tests pass
cd apps/site && bun run build        # all 268 pages pre-render
cd apps/site && bun run search:build # Pagefind picks up case bodies
```

Visit and confirm:
- 5 random `/eval/q-NNNN/` URLs render correctly.
- A search for "ummeed bar nahin" via `/eval/`'s search dialog (or the homepage Pagefind dialog) returns the q-0002 case page.
- The `Run on /try with this prompt →` button on a case page opens `/try/?prompt=...` with the URL param visible in the address bar.

---

## Chunk 3: /try/ enhancements + restructure

This chunk wires the BYOK island to the `?prompt=` URL param, adds the JSON-download flow, and restructures `/try/` into the two-card layout from the spec. After this chunk: clicking the case-page CTA prefills `/try/`'s textarea; running a prompt and clicking download produces an `EvalCaseResult`-shaped JSON; `/try/` shows install + BYOK side-by-side with shared caveat + report blocks.

### Task 11: BYOK download builder with TDD

**Files:**
- Create: `apps/site/src/lib/byok-download.ts`
- Create: `apps/site/src/lib/byok-download.test.ts`

- [ ] **Step 11.1: Write the failing test**

Create `apps/site/src/lib/byok-download.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildByokDownloadPayload, mapToolCallsToEval } from "./byok-download";
import type { ToolCall } from "../islands/byok/types";

describe("mapToolCallsToEval", () => {
  test("converts a single live ToolCall into EvalToolCall", () => {
    const tc: ToolCall = {
      id: "tc-1",
      name: "search_corpus",
      argsBuffer: '{"query":"ummeed"}',
      result: "Found chapter 115 of Diwan-E-Ghalib.",
      startedAt: 1000,
      endedAt: 1500,
    };
    expect(mapToolCallsToEval([tc])).toEqual([{
      name: "search_corpus",
      args: { query: "ummeed" },
      result_summary: "Found chapter 115 of Diwan-E-Ghalib.",
    }]);
  });

  test("treats a null result as undefined result_summary", () => {
    const tc: ToolCall = {
      id: "tc-2", name: "list_works", argsBuffer: "{}", result: null,
      startedAt: 0, endedAt: null,
    };
    expect(mapToolCallsToEval([tc])[0]?.result_summary).toBeUndefined();
  });

  test("skips a malformed argsBuffer rather than throwing", () => {
    const tc: ToolCall = {
      id: "tc-3", name: "broken", argsBuffer: "{not json", result: "x",
      startedAt: 0, endedAt: 1,
    };
    const out = mapToolCallsToEval([tc]);
    // args becomes the raw string for forensic value; doesn't throw.
    expect(out[0]?.args).toBe("{not json");
  });
});

describe("buildByokDownloadPayload", () => {
  test("produces a ByokDownloadPayload-shaped object", () => {
    const payload = buildByokDownloadPayload({
      prompt: "What is dharma?",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      answer: "Dharma is …",
      toolCalls: [],
      citations: [],
      durationMs: 1200,
    });
    expect(payload.schema_version).toBe("falsafa-byok/v1");
    expect(payload.prompt).toBe("What is dharma?");
    expect(payload.result.from_run).toBe("live-byok");
    expect(payload.result.duration_ms).toBe(1200);
    expect(typeof payload.generated_at).toBe("string");
    // ISO 8601 sanity check
    expect(payload.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 11.2: Run the test — confirm it fails**

Run: `cd apps/site && bun test src/lib/byok-download.test.ts`
Expected: FAIL — `Cannot find module './byok-download'`.

- [ ] **Step 11.3: Implement the builder**

Create `apps/site/src/lib/byok-download.ts`:

```ts
/**
 * Build a downloadable JSON payload from a completed BYOK run.
 *
 * Shape mirrors EvalCaseResult so a downloaded file is structurally
 * comparable to recorded eval cases. The provider/model/prompt that
 * EvalCaseResult doesn't carry (those live on EvalCase) wrap the
 * result in a ByokDownloadPayload envelope.
 */
import type { EvalCitation, EvalToolCall, ByokDownloadPayload } from "./eval-types";
import type { ToolCall } from "../islands/byok/types";

export function mapToolCallsToEval(toolCalls: ReadonlyArray<ToolCall>): EvalToolCall[] {
  return toolCalls.map((tc) => {
    let args: unknown;
    try {
      args = JSON.parse(tc.argsBuffer);
    } catch {
      // Live stream may end with a malformed buffer (rare). Keep raw
      // string for forensic value rather than throwing.
      args = tc.argsBuffer;
    }
    return {
      name: tc.name,
      args,
      result_summary: tc.result ?? undefined,
    };
  });
}

interface BuildInput {
  prompt: string;
  provider: ByokDownloadPayload["provider"];
  model: string;
  answer: string;
  toolCalls: ReadonlyArray<ToolCall>;
  citations: ReadonlyArray<EvalCitation>;
  durationMs: number;
}

export function buildByokDownloadPayload(input: BuildInput): ByokDownloadPayload {
  return {
    schema_version: "falsafa-byok/v1",
    generated_at: new Date().toISOString(),
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    result: {
      answer: input.answer,
      tool_calls: mapToolCallsToEval(input.toolCalls),
      citations: [...input.citations],
      duration_ms: input.durationMs,
      from_run: "live-byok",
    },
  };
}
```

- [ ] **Step 11.4: Run the test — confirm it passes**

Run: `cd apps/site && bun test src/lib/byok-download.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 11.5: Commit**

```bash
git add apps/site/src/lib/byok-download.ts apps/site/src/lib/byok-download.test.ts
git commit -m "feat(site): byok-download payload builder

mapToolCallsToEval converts the BYOK island's streaming ToolCall
shape into the recorded EvalToolCall shape (JSON.parse the args
buffer, null result → undefined). Tolerant of malformed buffers
(falls back to the raw string rather than throwing).

buildByokDownloadPayload wraps the run state in a
ByokDownloadPayload envelope with schema_version 'falsafa-byok/v1'
and result.from_run = 'live-byok'. The result body is structurally
identical to a recorded EvalCaseResult so external runs are
directly diffable."
```

---

### Task 12: Wire `?prompt=` URL param + Download button on the BYOK island

**Files:**
- Modify: `apps/site/src/islands/byok/ByokDemo.tsx`

- [ ] **Step 12.1: Read `?prompt=` on mount**

In [ByokDemo.tsx](../../apps/site/src/islands/byok/ByokDemo.tsx), find the existing `useEffect` that initializes state on mount (or add one if absent). Add a one-time URL-param read:

```ts
useEffect(() => {
  if (typeof window === "undefined") return;  // SSR guard, defensive
  const params = new URLSearchParams(window.location.search);
  const promptParam = params.get("prompt");
  if (promptParam) {
    dispatch({ type: "SET_PROMPT", value: promptParam });
    // Scroll the textarea into view but don't auto-submit.
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>("[data-byok-prompt]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }
}, []); // run once on mount
```

(`SET_PROMPT` action — if the existing reducer doesn't have one, find the dispatch that updates the prompt textarea and reuse it. The `data-byok-prompt` attribute may need to be added to the `<textarea>` — single-line addition.)

- [ ] **Step 12.2: Add a `[Download run as JSON]` button**

After a run completes (the existing UI renders an `<answer>` block when `state.runStatus === "complete"`), append:

```tsx
{state.runStatus === "complete" && (
  <button
    type="button"
    class="byok-download-btn"
    onClick={() => downloadCurrentRun(state)}
  >
    Download run as JSON
  </button>
)}
```

Implement `downloadCurrentRun`:

```ts
import { buildByokDownloadPayload } from "../../lib/byok-download";

function downloadCurrentRun(state: ByokState): void {
  if (!state.completedAnswer) return;
  const payload = buildByokDownloadPayload({
    prompt: state.prompt,
    provider: state.provider,
    model: state.model,
    answer: state.completedAnswer,
    toolCalls: state.toolCalls,
    citations: state.citations ?? [],
    durationMs: state.lastRunDurationMs ?? 0,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `falsafa-byok-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

(The exact field names — `state.completedAnswer`, `state.lastRunDurationMs`, etc. — must match what the reducer actually stores. If the field names differ, adapt to whatever the reducer exposes.)

- [ ] **Step 12.3: Style the button**

In `apps/site/src/styles/byok.css` (or wherever the BYOK styles live), append:

```css
.byok-download-btn {
  display: inline-block;
  margin-top: var(--s-4);
  padding: var(--s-2) var(--s-4);
  background: transparent;
  border: 1px solid var(--rule);
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.byok-download-btn:hover { background: var(--paper-soft, var(--paper)); }
```

- [ ] **Step 12.4: Smoke-test the round-trip**

Run: `cd apps/site && bun run dev`.
Visit `http://localhost:4321/try/?prompt=test%20question`.
Expected: textarea is prefilled with `test question`. The textarea is scrolled into view.

If you have an API key handy, run a real prompt → click `[Download run as JSON]` → open the downloaded file. Verify shape:
```bash
cat ~/Downloads/falsafa-byok-*.json | jq .schema_version
# expect: "falsafa-byok/v1"
cat ~/Downloads/falsafa-byok-*.json | jq .result.from_run
# expect: "live-byok"
cat ~/Downloads/falsafa-byok-*.json | jq '.result.tool_calls | length'
# expect: a positive integer
```

If you don't have an API key, just verify the prefill works.

- [ ] **Step 12.5: Commit**

```bash
git add apps/site/src/islands/byok/ByokDemo.tsx apps/site/src/styles/byok.css
git commit -m "feat(byok): read ?prompt= URL param + download run as JSON

The /try/ page now reads ?prompt= on mount and prefills the
textarea (does not auto-submit). The case-page 'Run on /try with
this prompt' CTA lands here.

After a run completes, a [Download run as JSON] button appears
next to the answer. The downloaded file is shaped exactly like
a recorded EvalCaseResult wrapped in a ByokDownloadPayload
envelope, so users can diff their run against ours directly."
```

---

### Task 13: Build the `<InstallCard>` component

**Files:**
- Create: `apps/site/src/components/InstallCard.astro`

- [ ] **Step 13.1: Create the component with tabs**

```astro
---
/**
 * Install card on /try/. Tab strip with one snippet per surface.
 * Tab switching is a tiny inline script; SSR shows the first tab
 * (Claude Desktop) before JS hydrates so noscript readers still
 * see at least one config.
 */
---

<aside class="install-card">
  <header>
    <h2>Install in your daily LLM</h2>
    <p>One command. Zero API keys, zero state.</p>
  </header>

  <div class="install-tabs" role="tablist" data-install-tabs>
    <button class="install-tab is-active" role="tab" aria-selected="true" data-target="claude-desktop">Claude Desktop</button>
    <button class="install-tab" role="tab" aria-selected="false" data-target="claude-code">Claude Code</button>
    <button class="install-tab" role="tab" aria-selected="false" data-target="cursor">Cursor</button>
    <button class="install-tab" role="tab" aria-selected="false" data-target="codex">Codex</button>
  </div>

  <div class="install-panels">
    <div class="install-panel" id="claude-desktop">
      <p class="install-step">Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:</p>
      <pre class="install-snippet"><code>{`{
  "mcpServers": {
    "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
  }
}`}</code></pre>
    </div>

    <div class="install-panel" id="claude-code" hidden>
      <p class="install-step">In a terminal:</p>
      <pre class="install-snippet"><code>claude mcp add falsafa npx -y @falsafa/mcp</code></pre>
    </div>

    <div class="install-panel" id="cursor" hidden>
      <p class="install-step">In a terminal:</p>
      <pre class="install-snippet"><code>npx -y @falsafa/mcp</code></pre>
      <p class="install-help">Then point Cursor's MCP settings at that command.</p>
    </div>

    <div class="install-panel" id="codex" hidden>
      <p class="install-step">In a terminal:</p>
      <pre class="install-snippet"><code>npx -y @falsafa/mcp</code></pre>
      <p class="install-help">Codex picks up stdio MCPs automatically once the binary is on PATH.</p>
    </div>
  </div>

  <p class="install-coming-soon">
    <span>Coming soon:</span>
    <span class="install-pill">Custom GPT</span>
    <span class="install-pill">Gemini Gem</span>
    <span class="install-pill">Claude Skill marketplace</span>
  </p>
</aside>

<script is:inline>
  (function () {
    const root = document.querySelector("[data-install-tabs]");
    if (!root) return;
    const tabs = root.querySelectorAll(".install-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-target");
        tabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        document.querySelectorAll(".install-panel").forEach((p) => {
          p.toggleAttribute("hidden", p.id !== target);
        });
      });
    });
  })();
</script>

<style>
  .install-card {
    border: 1px solid var(--rule);
    padding: var(--s-6);
  }
  .install-card header h2 {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    margin: 0 0 var(--s-2);
  }
  .install-card header p {
    color: var(--ink-muted);
    margin: 0 0 var(--s-6);
  }
  .install-tabs {
    display: flex;
    gap: var(--s-2);
    border-bottom: 1px solid var(--rule);
    margin-bottom: var(--s-4);
    flex-wrap: wrap;
  }
  .install-tab {
    background: transparent;
    border: none;
    padding: var(--s-2) var(--s-3);
    font-family: var(--font-sans);
    font-size: 13px;
    cursor: pointer;
    color: var(--ink-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .install-tab.is-active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .install-step {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--ink-muted);
    margin: 0 0 var(--s-2);
  }
  .install-snippet {
    background: var(--paper-soft, var(--paper));
    border: 1px solid var(--rule);
    padding: var(--s-3);
    font-family: var(--font-mono, "SF Mono", Menlo, monospace);
    font-size: 12px;
    margin: 0 0 var(--s-3);
    overflow-x: auto;
  }
  .install-help {
    font-size: 13px;
    color: var(--ink-muted);
    margin: 0;
  }
  .install-coming-soon {
    margin-top: var(--s-6);
    padding-top: var(--s-4);
    border-top: 1px solid var(--rule);
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--ink-muted);
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .install-pill {
    padding: 2px var(--s-2);
    border: 1px solid var(--rule);
  }
</style>
```

- [ ] **Step 13.2: Smoke-test the tab switcher**

(Component is mounted on `/try/` in Task 14; verification happens there.)
For now: `cd apps/site && bun run check` — typecheck clean.

- [ ] **Step 13.3: Commit**

```bash
git add apps/site/src/components/InstallCard.astro
git commit -m "feat(site): InstallCard component for /try/

Tab strip with one config snippet per surface (Claude Desktop /
Claude Code / Cursor / Codex). Inline tab-switch script keeps the
component zero-bundle. Below the tabs, a 'Coming soon' pill row
names the three forthcoming surfaces (Custom GPT, Gemini Gem,
Claude Skill marketplace) per the launch plan."
```

---

### Task 14: Restructure `/try/` into the two-card layout

**Files:**
- Modify: `apps/site/src/pages/try/index.astro`

- [ ] **Step 14.1: Replace the page body**

Replace the existing body of `/try/` (lines 52-79) with the new two-card layout:

```astro
  <article class="try-page">
    <header class="try-header">
      <p class="kicker">Try</p>
      <h1>Run Falsafa on your terms</h1>
      <p class="lede">
        Install the MCP into your daily LLM, or paste an API key to try it
        live in the browser. The same librarian tools, the same corpus.
      </p>
    </header>

    <div class="try-hero">
      <InstallCard />

      <div class="try-byok-card">
        <header class="try-byok-card-head">
          <h2>Try it now (BYOK)</h2>
          <p>Bring your own API key. Stays in the browser.</p>
        </header>
        <ByokDemo client:only="preact" chips={CHIPS} />
      </div>
    </div>

    <details class="try-clone">
      <summary>Or clone & develop locally</summary>
      <pre><code>{`git clone https://github.com/adoistic/falsafa
cd falsafa && bun install
cd apps/site && bun run dev          # reading site
cd apps/mcp  && bun run dev          # MCP server (stdio)`}</code></pre>
      <p>See the <a href="https://github.com/adoistic/falsafa#readme">README</a> for the full eval / convert / image-gen scripts.</p>
    </details>

    <NonDeterminismCaveat />
    <ReportThis />
  </article>
```

Add the imports at the top of the frontmatter:
```astro
---
import Base from "../../layouts/Base.astro";
import ByokDemo from "../../islands/byok/ByokDemo";
import InstallCard from "../../components/InstallCard.astro";
import NonDeterminismCaveat from "../../components/NonDeterminismCaveat.astro";
import ReportThis from "../../components/ReportThis.astro";

// existing CHIPS const stays
---
```

- [ ] **Step 14.2: Add the layout CSS**

Append to `/try/`'s `<style>` block (or the `try.css` file if it exists):

```css
.try-hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--s-6);
  margin-bottom: var(--s-12);
}

@media (min-width: 768px) {
  .try-hero {
    grid-template-columns: 1fr 1fr;
    gap: var(--s-8);
  }
}

.try-byok-card {
  border: 1px solid var(--rule);
  padding: var(--s-6);
}
.try-byok-card-head h2 {
  font-family: var(--font-display);
  font-size: var(--fs-h2);
  margin: 0 0 var(--s-2);
}
.try-byok-card-head p {
  color: var(--ink-muted);
  margin: 0 0 var(--s-6);
}

.try-clone {
  margin-top: var(--s-6);
  padding: var(--s-4) var(--s-6);
  border: 1px dashed var(--rule);
}
.try-clone summary {
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--accent);
}
.try-clone pre {
  background: var(--paper-soft, var(--paper));
  border: 1px solid var(--rule);
  padding: var(--s-3) var(--s-4);
  font-family: var(--font-mono, "SF Mono", Menlo, monospace);
  font-size: 12px;
  overflow-x: auto;
  margin: var(--s-3) 0;
}
```

- [ ] **Step 14.3: Smoke-test the new /try/ page**

Run: `cd apps/site && bun run dev`.
Visit `http://localhost:4321/try/`.

Expected:
- Header with "Run Falsafa on your terms" h1.
- Two cards side-by-side at desktop width (≥768px): Install on the left, BYOK on the right.
- At mobile width, cards stack (install on top, BYOK below).
- Tab strip on the install card cycles through Claude Desktop / Code / Cursor / Codex; only one panel visible at a time.
- "Coming soon" pill row visible at the bottom of the install card.
- Below the two cards: a `<details>` "Or clone & develop locally" with three shell lines.
- Below that: the non-determinism caveat and the report-this buttons.
- Visit `/try/?prompt=test%20prompt` — the BYOK textarea is prefilled.

- [ ] **Step 14.4: Commit**

```bash
git add apps/site/src/pages/try/index.astro
git commit -m "feat(try): two-card hero with install + BYOK at equal weight

Restructures /try/ per the eval-redesign spec:
- InstallCard (left) and BYOK demo (right) at equal weight.
- 'Or clone & develop locally' details block beneath.
- NonDeterminismCaveat + ReportThis at the bottom.
- Mobile breakpoint stacks the cards.

Header h1 reframes the page from 'BYOK live demo' to 'use Falsafa
however suits you' — install in your daily LLM, run in the browser
with a key, or fork the repo. All three at first paint."
```

---

### Chunk 3 verification

```bash
cd apps/site && bun run check        # typecheck — clean
cd apps/site && bun run dev          # /try/ shows two-card layout
cd apps/site && bun test             # all unit tests green
cd apps/site && bun run build        # full site builds, including
                                     # all 268 /eval/q-NNNN/ pages
cd apps/site && bun run search:build # Pagefind picks up case bodies
```

End-to-end smoke test:
1. Visit `/eval/`. Click any case row. Confirm navigation to `/eval/q-NNNN/`.
2. On the case page, click "Run on /try with this prompt →". Confirm `/try/` opens with the prompt prefilled.
3. (Optional, requires API key) Run the prompt on `/try/`. Click `[Download run as JSON]`. Open the downloaded file. Confirm shape matches `ByokDownloadPayload`.
4. On `/try/`, switch tabs on the install card. Confirm panels switch.
5. Open the GitHub issue button on a case page. Confirm the URL pre-fills the issue body with the case id, URL, and recorded answer (truncated).

If all five hold, the implementation is done.

---

## Out of scope for this plan (future follow-ups)

- **Diff view:** "Your run" vs "Recorded run" side-by-side, given a downloaded JSON.
- **Eval pool browse:** the 1000-question pool (of which 268 are recorded) — the case-page link from `/eval/` only covers recorded cases.
- **Remote MCP backend:** Custom GPT / Gemini Gem / Claude Skill marketplace are "Coming soon" labels only; the backend lives behind the `/office-hours` → `/plan-eng-review` gate documented in `TODOS.md`.
- **Multi-language UI:** English only at launch.

