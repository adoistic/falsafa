# Eval A/B UI Redesign — Design

**Status:** Spec, awaiting implementation plan.
**Author:** Adnan + Claude (brainstorming session 2026-04-30).
**Goal:** Make the eval explorer legible as a side-by-side A/B comparison between
the baseline arm (no wiki) and the treatment arm (with wiki), end-to-end —
header, case list, and case detail.

## Why

The current `/eval/` UI was built around a single model. After splitting
`grok-baseline-nowiki-20260430` and `grok-treatment-wiki-20260430` into separate
model entries (commit `919df5c`), the header iterates `models.map()` and renders
two stacked sets of pills. Result: four equally-weighted pills in a row
(`61% DISCOVERY · 96% CITATION · 99% DISCOVERY · 100% CITATION`) with the only
distinguishing signal being a tiny `(baseline)` / `(wiki)` caption underneath.

The builder of this site couldn't tell at a glance which pill belonged to which
arm. That's a layout failure, not a styling failure: putting two arms as peer
items in a single horizontal pill row makes the comparison invisible.

The case list and case detail pages still show only the primary model
(`models[0]`), so the wiki arm's per-case verdicts and answers aren't visible
at all. The A/B story is silently buried.

## Non-Goals

- **Re-running the eval.** All data already exists; this is purely UI.
- **Changing the scoring metric.** Substring `mechanical_pass` (with NFKD
  diacritic fold) stays as the headline pass for the deadline. The graded
  3-state score is queued separately in `TODOS.md`.
- **Cross-model comparison surface.** This design covers a single model
  (Grok 4.1 Fast) split across two arms. Multi-model A/B (e.g. Grok-baseline
  vs Sonnet-baseline) is out of scope.
- **Delta column on the header.** v1 lets the eye compute baseline-vs-wiki
  diffs from adjacent numbers. Adding deltas overcomplicates the layout we
  want crisp.
- **Side-by-side answer prose on the case detail.** v1 uses tabs; users see
  both verdicts/costs in the always-visible delta strip and click a tab to
  read each arm's prose. Side-by-side prose is a v2 if needed.

## Architecture overview

Three files change. No data-model changes — `eval.json` and `eval-index.json`
already carry per-arm data via the `__baseline` / `__wiki` model-label suffix
introduced in `919df5c`.

### `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`

- **Header:** rebuild from `models.map()` rendering peer pills into a single
  `EvalHeader` component that detects 1-arm vs 2-arm modes and renders
  accordingly. 2-arm mode produces the two-column scoreboard described in
  Section 1 below. 1-arm mode falls back to the existing layout (preserves
  legacy single-model runs).
- **Case list:** `CaseRow` switches from one verdict pill to two
  (`B` / `W` labeled), pulling each arm's `mechanical_pass` from
  `c.results[modelLabel]`. New filter chip group above the existing
  tier/category filters.

### `apps/site/src/pages/eval/[id].astro`

- Add tab control at the top of the article body.
- Add the always-visible "delta strip" above the tab content.
- Tab content is the existing single-model layout, parameterised by which
  arm is active.

### `apps/site/src/styles/eval.css`

- New styles for the two-column header, tinted column backgrounds, the
  two-pill row layout, the filter chip group, and the tab control.

---

## Section 1 — Header (two-column scoreboard)

Two columns side-by-side, equal width. Left = `BASELINE`, right = `WIKI`.
Each column has the model name as a small caption at top, then three rows
stacked top-to-bottom:

```
                         BASELINE                   WIKI
                         xAI Grok 4.1 Fast          xAI Grok 4.1 Fast
DISCOVERY                61% (220/363)              99% (125/126)
CITATION                 96% (728/757)             100% (202/203)
SPEND                    $13.36                     $2.47
TOKENS                   71M (4,845 calls)          16M (1,539 calls)
```

A thin label column on the far left holds the row labels
(`DISCOVERY`, `CITATION`, `SPEND`, `TOKENS`). Big numbers are stacked
vertically inside each arm's column so the eye reads two distinct columns,
each row already aligned for visual comparison.

`1,120 CASES` stays as a left-side anchor box (same as today).
Generated-timestamp moves to the bottom-right corner of the header.

### Visual distinction

- **Vertical rule** between the two columns (subtle border) reinforces "two
  things being compared."
- **Soft column tint:** warm grey for baseline, faint blue for wiki.
  Concrete values:
    - Baseline tint: `--arm-baseline-bg = color-mix(in oklch, var(--ink) 4%, var(--bg))`
      (4% ink-on-bg overlay; reads as a soft warm grey on the existing parchment background).
    - Wiki tint: `--arm-wiki-bg = color-mix(in oklch, var(--accent) 6%, var(--bg))`
      (6% accent overlay; faint blue-tinted).
    - Border between columns: `--arm-divider = color-mix(in oklch, var(--ink) 12%, transparent)`
  Both variables defined in `eval.css` next to existing tokens. Tints are
  subtle enough not to fight body text but distinct enough that the reader
  instantly registers two columns.
- Active arm indicator on the case detail page (Section 3) uses the same
  tint vocabulary so the visual language carries through.

### Partial-run state

While the wiki run is still in progress (e.g. 329 / 1,120 done), the wiki
column shows numbers based on cases completed so far, with a small caption
under the column header: `partial · 329 / 1120 done`. When complete, the
caption disappears.

This means the wiki numbers can shift as more cases land — that's fine for
a builder/diagnostic UI. Once the run is complete the partial caption
disappears and the numbers are stable.

### Single-arm fallback

If `isAbMode(data.models)` returns `false` (the canonical predicate from
the "Resolved arm-label convention" section below), the header falls back
to the existing layout (one row of pills + cost row). This covers
baseline-only, wiki-only, and untagged single-model legacy runs.

---

## Section 2 — Case list (two pills + filter chips)

### Row layout

Same row structure as today, but the single verdict pill at the right end
becomes **two compact pills side-by-side**, each labeled `B` or `W`:

```
q-0405  hidden  thematic   medium   Which works in the corpus offer rules…    [✗ B] [✓ W]  ↗
q-0531  hidden  thematic   medium   Find every work that addresses theodicy…  [✗ B] [— W]  ↗
q-0001  named   citation   easy     Quote a couplet by Ghalib about wine…     [✓ B] [✓ W]  ↗
```

- Same colour semantics as today: `✓` green-ish, `✗` red-ish, `—` muted grey
  for "wiki not yet run for this case."
- The label `B` or `W` lives inside or beside each pill so the reader never
  has to remember left = baseline.
- Pills sit horizontally side-by-side, not stacked. Pill column widens to
  accommodate; row height is unchanged.

### Filter chip group

New chip group above today's tier / category filters, leftmost so it reads
first:

```
[ All ]  [ Flips → pass ]  [ Flips → fail ]  [ Both pass ]  [ Both fail ]  [ Pending wiki ]
```

- Default selection: `All`.
- Hash-syncs as `#diff=flips-pass`, `#diff=flips-fail`, etc., so URLs are
  shareable.
- Chip counts are appended live (`Flips → pass (12)`, `Flips → fail (3)`)
  so the magnitude of each comparison story is visible before a click.
- `Pending wiki` filters to cases where the wiki arm hasn't run yet —
  useful while the run is partial.

### Sort

Within the filtered set, default sort stays "by tier × category × id"
(today's order). When a comparison filter is active, secondary sort is by
category — so e.g. all the thematic flips group together, then multilingual.

### Filter chip truth table

For tuple `(baselinePass, wikiPass)` where each is `true` | `false` |
`pending`:

| baseline | wiki    | All | Flips→pass | Flips→fail | Both pass | Both fail | Pending wiki |
|----------|---------|:---:|:----------:|:----------:|:---------:|:---------:|:------------:|
| pass     | pass    | ✓   |            |            | ✓         |           |              |
| fail     | fail    | ✓   |            |            |           | ✓         |              |
| fail     | pass    | ✓   | ✓          |            |           |           |              |
| pass     | fail    | ✓   |            | ✓          |           |           |              |
| pass     | pending | ✓   |            |            |           |           | ✓            |
| fail     | pending | ✓   |            |            |           |           | ✓            |

`pending` cases never satisfy `Both pass`, `Both fail`, `Flips → pass`,
`Flips → fail`. They live in `All` and `Pending wiki`. Defensive case —
baseline pending — gets the same treatment.

### Edge cases

- **Wiki not yet run for this case:** wiki pill shows `— W` (grey dash).
  Filter membership per the truth table above.
- **Baseline missing for a case** (defensive — shouldn't happen): same
  treatment, but the cell shows `— B`.

---

## Section 3 — Case detail page (tabs + delta strip)

### Tab control

At the top of the article body, below the breadcrumb:

```
← Eval  /  q-0405                                          [Baseline] [Wiki]
```

`Baseline` and `Wiki` are tab buttons. Active tab is filled with the arm's
tint (matching Section 1's column tints); inactive is outlined. URL hash
syncs: `/eval/q-0405/#wiki` so refresh and share preserve the active arm.

Default tab on first visit: **Baseline** (the established arm).

### Delta strip — always visible, above the tab content

A two-row mini-table summarising both arms' verdicts, tool counts, costs,
and tokens at a glance. No tab-flipping required for the high-level
comparison:

```
Baseline:  ✗ fail   ·  11 tools  ·  $0.0124  ·  25K tok
Wiki:      ✓ pass   ·  14 tools  ·  $0.0091  ·  18K tok
```

Each row uses the arm's tint so the eye matches it to the corresponding tab
above. This is the one piece that lets the user "see both" without
clicking — the actual prose is one-arm-at-a-time, but the comparison signal
lives in the strip.

### Tab content

Same layout as today's single-model case page, parameterised by the active
arm:

- Tier kicker (`Discovery` / `Citation`)
- Prompt
- Expected works
- Cost & tokens section + collapsible per-step trace
- Answer prose (markdown rendered)
- Citations list
- Tool calls (collapsible)

### Edge cases

- **Wiki not yet run for this case:** only the `Baseline` tab renders (no
  `Wiki` button); delta strip second row reads `Wiki: pending — run not
  complete` in muted text.
- **`#wiki` hash but no wiki data for this case:** silently fall back to
  the `Baseline` tab (the only tab rendered), update the URL hash to drop
  the fragment so refresh stays consistent. No error message — partial-run
  state is not a user error.
- **Single-model legacy case** (no arm tags in data): one tab labelled with
  the run name, delta strip suppressed.

---

## Data flow

No backend changes. The build pipeline already populates two model entries
in `eval-index.json`'s `models[]` array and per-case `c.results[modelLabel]`
in `eval.json`, indexed by `${sub}__${arm}` (e.g. `grok-4.1-fast__baseline`,
`grok-4.1-fast__wiki`).

The UI components consume this data:

- **Header:** reads `data.models[]`. Detects 2-arm mode by checking that at
  least one model has the `(baseline)` arm-suffix and at least one has
  `(wiki)`. Pulls per-tier and per-cost fields directly from each model
  entry — no recomputation.
- **Case list:** `CaseRow` reads `c.results[baselineLabel]` and
  `c.results[wikiLabel]` independently, runs `passOf()` on each, and
  renders two pills. Filter chips compute (baseline-pass, wiki-pass) tuples
  and filter by them.
- **Case detail:** `[id].astro` reads both arms' results into the page's
  view-model. Active tab decides which arm's content renders. Delta strip
  reads both regardless of active tab.

## Resolved arm-label convention

The build's existing `armTagFromRunDir(runDir)` (in
`eval/build-eval-json.ts`) returns `"baseline"`, `"wiki"`, or `null`. The
UI consumes these strings via `humaniseModelLabel()`'s split, e.g.
`"grok-4.1-fast__baseline"` → `"xAI Grok 4.1 Fast (baseline)"`.

For the UI's purposes — **single canonical helper used by header, case
list, and case detail**:

```ts
type Arm = "baseline" | "wiki";

/** Extract arm tag from a model id like "grok-4.1-fast__baseline". */
function armOfModelId(modelId: string): Arm | null {
  if (modelId.endsWith("__baseline")) return "baseline";
  if (modelId.endsWith("__wiki")) return "wiki";
  return null;
}

/** True when `data.models` contains both arms — drives 2-arm UI mode. */
function isAbMode(models: { id: string }[]): boolean {
  const arms = new Set(models.map((m) => armOfModelId(m.id)).filter(Boolean));
  return arms.has("baseline") && arms.has("wiki");
}
```

`isAbMode()` is the single canonical predicate. Every component (header
2-arm vs single-arm, case list two-pill vs one-pill, case detail tabs vs
no-tabs) calls `isAbMode(data.models)` — no other detection logic exists
in the UI.

Both helpers are pure functions and have unit tests in
`apps/site/src/lib/__tests__/eval-arms.test.ts` covering: untagged legacy,
baseline-only, wiki-only, both-arms, mixed-with-untagged, empty input.

## Out-of-scope follow-ups

- **Cost-delta surface:** a separate section showing "wiki saves $X / case
  on average" — useful for the paper, deferred to v2.
- **Per-category × per-arm matrix:** dense table of pass-rates and costs
  broken down by tier × category × arm. Currently lives in build logs only.
- **Side-by-side answer prose** on the case detail page: tabs are the v1
  story; if "memory burden" of flipping tabs becomes painful, revisit with
  side-by-side as a viewport-aware alternative.
- **Cross-model A/B:** comparing baseline-of-Grok against baseline-of-Sonnet
  is conceptually different (which model is best?) vs. baseline-vs-wiki
  (which tooling helps?). The data model supports it, but the UI design is
  separate.

## Testing

Manual smoke tests, since this is presentation-layer:

1. Build with full baseline (1,120) + partial wiki (e.g. 329). Confirm the
   header shows two columns, partial caption visible on wiki side.
2. Build after wiki finishes. Confirm partial caption disappears.
3. Filter chips: click `Flips → pass`, confirm only flip-to-pass cases
   render and the count matches. Same for the other chips.
4. Hash sync: load `/eval/#diff=flips-pass`, confirm chip is selected.
5. Case detail: load `/eval/q-0405/`, confirm tabs default to Baseline,
   delta strip visible, both arms' numbers correct. Click `Wiki` tab,
   confirm hash updates and content swaps.
6. Single-arm fallback: temporarily filter `data.models` to one arm in a
   dev build, confirm header degrades to today's layout cleanly. Covered
   in unit tests for `isAbMode()` (see "Resolved arm-label convention").
7. Visual: tints distinguishable in light mode; column rule visible without
   being heavy.

### Unit tests

`apps/site/src/lib/__tests__/eval-arms.test.ts` covers the two pure
helpers:

- `armOfModelId("grok-4.1-fast__baseline")` → `"baseline"`
- `armOfModelId("grok-4.1-fast__wiki")` → `"wiki"`
- `armOfModelId("grok-4.1-fast")` → `null`
- `armOfModelId("")` → `null`
- `isAbMode([])` → `false`
- `isAbMode([{id:"grok-4.1-fast"}])` → `false` (untagged single)
- `isAbMode([{id:"grok-4.1-fast__baseline"}])` → `false` (baseline only)
- `isAbMode([{id:"grok-4.1-fast__wiki"}])` → `false` (wiki only)
- `isAbMode([{id:"grok-4.1-fast__baseline"},{id:"grok-4.1-fast__wiki"}])` → `true`
- `isAbMode([{id:"grok-4.1-fast__baseline"},{id:"grok-4.1-fast__wiki"},{id:"sonnet-4.6"}])` → `true` (still A/B even with extra untagged)
