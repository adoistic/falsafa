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
