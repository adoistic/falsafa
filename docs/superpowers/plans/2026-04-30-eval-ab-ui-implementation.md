# Eval A/B UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/eval/` explorer legible as a side-by-side A/B comparison between the baseline arm (no wiki) and the wiki arm (with `read_wiki` + `read_wiki_full`), end-to-end — header, case list, and case detail.

**Architecture:** Two new pure-helper files + one new test file + edits to three existing UI files. Header becomes a two-column scoreboard when both arms exist; case list shows two pills per row plus a comparison filter chip group; case detail shows tabs (CSS `:target`, zero JS) plus an always-visible delta strip. Single-arm fallback preserves today's UI exactly — locked down by a regression test.

**Tech Stack:** Preact island + Astro static page (existing `/eval/`), `bun:test` for unit tests, plain CSS with `color-mix(in oklch, ...)` tints (already supported in evergreen browsers since 2024), CSS `:target` selector for tab swap (no JS, no new island).

**Spec:** `docs/superpowers/specs/2026-04-30-eval-ab-ui-design.md` (eng-review CLEAN; 6 decisions captured: D1–D6 in the GSTACK REVIEW REPORT at the bottom of the spec).

---

## Pre-flight: known gotchas

Before starting any task, the implementer should be aware of these:

1. **Hash-key collision.** Existing hash sync (`apps/site/src/islands/eval-explorer/EvalExplorer.tsx:635`) already writes `diff=` for the **difficulties** filter. The spec's proposed `#diff=flips-pass` would clash. **Use `compare=` instead** (`#compare=flips-pass`). Plan tasks reflect this rename.
2. **paragraph_id markers and citation_url.** `[id].astro` already runs `marked.parse + DOMPurify.sanitize + linkifyHtml` per result. With two arms it runs that pipeline twice per case — adds ~1.5s to total build. No code change needed; just budget for it.
3. **Test framework is `bun:test`.** Imports look like `import { describe, expect, test } from "bun:test"`. `apps/site/src/lib/byok-download.test.ts` is the closest existing template for new tests.
4. **The `_score-mechanical.json` precedence path** in `eval/build-eval-json.ts:559` overrides recomputation. None of the active runs (`grok-baseline-nowiki-20260430`, `grok-treatment-wiki-20260430`) ship score files, so this branch is irrelevant — but don't remove it.
5. **CSS variable scope.** Existing `eval.css` defines color tokens at `:root` and `.dark-theme` overrides. Add the three new arm tokens (`--arm-baseline-bg`, `--arm-wiki-bg`, `--arm-divider`) at `:root` so they cascade everywhere. Both light and dark mode work because `color-mix()` blends with the theme's `--bg` and `--ink`.
6. **`<a href="#wiki">` links create scroll-to-anchor browser behavior** for the tab buttons. Mitigation: place tab anchors inside a non-scrolling container near the top of the article, OR use `scroll-behavior: auto` on the body and `:has()` to suppress jumping. Simplest: anchor the tabs near the top so the jump is a no-op.

---

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `apps/site/src/lib/eval-arms.ts` | NEW | Pure helpers: `armOfModelId`, `isAbMode`, `armVerdicts`, `filterByCompare`. |
| `apps/site/src/lib/__tests__/eval-arms.test.ts` | NEW | Unit tests for the four helpers (~50 cases total). |
| `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts` | NEW | IRON RULE regression: locks down current UI when only one arm. |
| `apps/site/src/islands/eval-explorer/EvalExplorer.tsx` | MODIFIED | Header → two-column scoreboard; CaseRow → two pills; FilterBar → comparison chips; filter pipeline → uses `filterByCompare`. |
| `apps/site/src/pages/eval/[id].astro` | MODIFIED | Read both arms' results; render tabs + delta strip + dual content sections. |
| `apps/site/src/styles/eval.css` | MODIFIED | New styles: scoreboard, two-pill row, chip group, tabs (`:target`), delta strip. |

Six files total. Three new (two source + one test), three modified.

---

## Chunk 1: Pure helpers — `eval-arms.ts`

Foundation. Everything else imports from here. TDD strictly: tests first, implementation second.

### Task 1: `armOfModelId` helper

**Files:**
- Create: `apps/site/src/lib/eval-arms.ts`
- Test: `apps/site/src/lib/__tests__/eval-arms.test.ts`

- [ ] **Step 1: Create the test directory and write the failing test**

Create `apps/site/src/lib/__tests__/eval-arms.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { armOfModelId } from "../eval-arms";

describe("armOfModelId", () => {
  test("returns 'baseline' for ids ending in __baseline", () => {
    expect(armOfModelId("grok-4.1-fast__baseline")).toBe("baseline");
  });

  test("returns 'wiki' for ids ending in __wiki", () => {
    expect(armOfModelId("grok-4.1-fast__wiki")).toBe("wiki");
  });

  test("returns null for untagged model ids", () => {
    expect(armOfModelId("grok-4.1-fast")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(armOfModelId("")).toBeNull();
  });

  test("returns null for ids with __ but unknown arm tag", () => {
    expect(armOfModelId("grok-4.1-fast__experimental")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: FAIL with "Cannot find module '../eval-arms'" (or similar — the module doesn't exist yet).

- [ ] **Step 3: Create `eval-arms.ts` with the minimal implementation**

Create `apps/site/src/lib/eval-arms.ts`:

```ts
/**
 * Pure helpers for the eval explorer's A/B-comparison UI.
 *
 * The build pipeline (eval/build-eval-json.ts) tags model ids with
 * `__baseline` / `__wiki` suffixes when a runDir signals an A/B arm.
 * These helpers extract the tag and answer two questions consumers
 * care about: "which arm is this?" and "do we have both arms?".
 *
 * No DOM, no React, no fetching — pure logic, fully unit-testable.
 */

export type Arm = "baseline" | "wiki";

/** Extract the A/B arm tag from a model id, or null if untagged. */
export function armOfModelId(modelId: string): Arm | null {
  if (modelId.endsWith("__baseline")) return "baseline";
  if (modelId.endsWith("__wiki")) return "wiki";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/eval-arms.ts apps/site/src/lib/__tests__/eval-arms.test.ts
git commit -m "feat(eval-arms): armOfModelId helper + tests"
```

### Task 2: `isAbMode` helper

**Files:**
- Modify: `apps/site/src/lib/eval-arms.ts`
- Modify: `apps/site/src/lib/__tests__/eval-arms.test.ts`

- [ ] **Step 1: Add failing tests for `isAbMode`**

Append to `apps/site/src/lib/__tests__/eval-arms.test.ts`:

```ts
import { isAbMode } from "../eval-arms";

describe("isAbMode", () => {
  test("returns false for empty model list", () => {
    expect(isAbMode([])).toBe(false);
  });

  test("returns false when only baseline arm is present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast__baseline" }])).toBe(false);
  });

  test("returns false when only wiki arm is present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast__wiki" }])).toBe(false);
  });

  test("returns false when only untagged models are present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast" }, { id: "sonnet-4.6" }])).toBe(false);
  });

  test("returns true when both arms present", () => {
    expect(
      isAbMode([
        { id: "grok-4.1-fast__baseline" },
        { id: "grok-4.1-fast__wiki" },
      ]),
    ).toBe(true);
  });

  test("returns true when both arms present alongside untagged models", () => {
    expect(
      isAbMode([
        { id: "grok-4.1-fast__baseline" },
        { id: "grok-4.1-fast__wiki" },
        { id: "sonnet-4.6" },
      ]),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: FAIL — `isAbMode` is not exported.

- [ ] **Step 3: Add `isAbMode` to `eval-arms.ts`**

Append to `apps/site/src/lib/eval-arms.ts`:

```ts
/**
 * True when `data.models` contains both arms — drives 2-arm UI mode
 * everywhere (header layout, case-row pill count, case detail tabs).
 *
 * Single canonical predicate: every component checks this; no other
 * detection logic exists in the UI. See spec D3.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: PASS — 11 tests pass total (5 prior + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/eval-arms.ts apps/site/src/lib/__tests__/eval-arms.test.ts
git commit -m "feat(eval-arms): isAbMode predicate + tests"
```

### Task 3: `armVerdicts` helper

**Files:**
- Modify: `apps/site/src/lib/eval-arms.ts`
- Modify: `apps/site/src/lib/__tests__/eval-arms.test.ts`

This helper takes a case + the resolved arm-model-ids and returns the per-arm pass state. CaseRow, the filter pipeline, and the chip-count derivation all call it — DRYs the truth-table computation in one spot.

- [ ] **Step 1: Add failing tests for `armVerdicts`**

Append to `apps/site/src/lib/__tests__/eval-arms.test.ts`:

```ts
import { armVerdicts } from "../eval-arms";
import type { EvalCase } from "../eval-types";

function caseFixture(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "q-test",
    category: "thematic",
    difficulty: "medium",
    prompt: "test prompt",
    expected_works: [],
    results: {},
    ...overrides,
  };
}

describe("armVerdicts", () => {
  test("returns null for both arms when neither has results", () => {
    const c = caseFixture();
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: null, wiki: null });
  });

  test("returns baseline=true, wiki=null when only baseline passed", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "ok",
          tool_calls: [],
          citations: [],
          duration_ms: 0,
          from_run: "x",
          mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: true, wiki: null });
  });

  test("returns baseline=false, wiki=true on a flip-to-pass case", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "x", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "b", mechanical_pass: false,
        },
        "grok-4.1-fast__wiki": {
          answer: "y", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "w", mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: false, wiki: true });
  });

  test("returns both true when both arms passed", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "x", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "b", mechanical_pass: true,
        },
        "grok-4.1-fast__wiki": {
          answer: "y", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "w", mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: true, wiki: true });
  });

  test("returns null when arm-model-id is undefined", () => {
    const c = caseFixture();
    expect(armVerdicts(c, undefined, undefined))
      .toEqual({ baseline: null, wiki: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: FAIL — `armVerdicts` is not exported.

- [ ] **Step 3: Add `armVerdicts` to `eval-arms.ts`**

Append to `apps/site/src/lib/eval-arms.ts`:

```ts
import type { EvalCase } from "./eval-types";
import { passOf } from "./eval-types";

/**
 * Per-arm verdict pair for a single case. `null` means "this arm has
 * no result for this case" (i.e. pending — e.g. wiki run is partial).
 *
 * Used by:
 *   - CaseRow rendering (which pill to show per arm)
 *   - filterByCompare (truth-table membership)
 *   - chip-count derivation (live counts on each filter chip)
 *
 * Caller passes the resolved baseline/wiki model ids (typically derived
 * via models.find(m => armOfModelId(m.id) === "baseline") at the top
 * of the explorer); `undefined` means that arm isn't in the models list.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: PASS — 16 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/eval-arms.ts apps/site/src/lib/__tests__/eval-arms.test.ts
git commit -m "feat(eval-arms): armVerdicts helper + tests"
```

### Task 4: `filterByCompare` helper

**Files:**
- Modify: `apps/site/src/lib/eval-arms.ts`
- Modify: `apps/site/src/lib/__tests__/eval-arms.test.ts`

This is the truth-table-driven filter the comparison chip group uses. Pure function over `(verdicts, mode)` → boolean.

- [ ] **Step 1: Add failing tests for `filterByCompare`**

Append to `apps/site/src/lib/__tests__/eval-arms.test.ts`:

```ts
import { filterByCompare } from "../eval-arms";
import type { CompareMode } from "../eval-arms";

describe("filterByCompare", () => {
  // Each row: [baseline, wiki, mode, expected]
  const cases: Array<[boolean | null, boolean | null, CompareMode, boolean]> = [
    // mode=all — everything passes
    [true,  true,  "all", true],
    [false, false, "all", true],
    [true,  null,  "all", true],
    [null,  null,  "all", true],

    // mode=flips-pass — baseline=false, wiki=true
    [false, true,  "flips-pass", true],
    [true,  true,  "flips-pass", false],
    [false, false, "flips-pass", false],
    [false, null,  "flips-pass", false],
    [null,  true,  "flips-pass", false],

    // mode=flips-fail — baseline=true, wiki=false
    [true,  false, "flips-fail", true],
    [true,  true,  "flips-fail", false],
    [false, false, "flips-fail", false],
    [true,  null,  "flips-fail", false],

    // mode=both-pass — baseline=true AND wiki=true
    [true,  true,  "both-pass", true],
    [true,  false, "both-pass", false],
    [false, true,  "both-pass", false],
    [true,  null,  "both-pass", false],

    // mode=both-fail — baseline=false AND wiki=false
    [false, false, "both-fail", true],
    [true,  false, "both-fail", false],
    [false, true,  "both-fail", false],
    [false, null,  "both-fail", false],

    // mode=pending-wiki — wiki is null
    [true,  null,  "pending-wiki", true],
    [false, null,  "pending-wiki", true],
    [null,  null,  "pending-wiki", true],
    [true,  true,  "pending-wiki", false],
    [false, false, "pending-wiki", false],
  ];

  for (const [baseline, wiki, mode, expected] of cases) {
    test(`b=${baseline}, w=${wiki}, mode=${mode} -> ${expected}`, () => {
      expect(filterByCompare({ baseline, wiki }, mode)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: FAIL — `filterByCompare` and `CompareMode` are not exported.

- [ ] **Step 3: Add `filterByCompare` to `eval-arms.ts`**

Append to `apps/site/src/lib/eval-arms.ts`:

```ts
/**
 * The 6 selectable modes for the comparison filter chip group.
 * `all` is the default (no filter applied).
 */
export type CompareMode =
  | "all"
  | "flips-pass"
  | "flips-fail"
  | "both-pass"
  | "both-fail"
  | "pending-wiki";

/**
 * Truth table from the spec (Section 2). Returns true iff the case's
 * (baseline, wiki) verdicts are in the set selected by `mode`.
 *
 * `null` semantics: "pending" — that arm has no result for this case.
 * Pending cases NEVER satisfy flips/both modes, only `all` and `pending-wiki`.
 */
export function filterByCompare(
  v: { baseline: boolean | null; wiki: boolean | null },
  mode: CompareMode,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "flips-pass":
      return v.baseline === false && v.wiki === true;
    case "flips-fail":
      return v.baseline === true && v.wiki === false;
    case "both-pass":
      return v.baseline === true && v.wiki === true;
    case "both-fail":
      return v.baseline === false && v.wiki === false;
    case "pending-wiki":
      return v.wiki === null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && bun test src/lib/__tests__/eval-arms.test.ts`
Expected: PASS — all 16 + ~26 new tests pass (~42 total).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/eval-arms.ts apps/site/src/lib/__tests__/eval-arms.test.ts
git commit -m "feat(eval-arms): filterByCompare + truth-table tests (D5)"
```

---

## Chunk 2: IRON RULE regression test + Header redesign

Lock down today's behavior FIRST, then refactor the Header. Order matters: if the regression test runs after the refactor, it can't catch breakage.

### Task 5: Single-arm regression test (IRON RULE)

**Files:**
- Create: `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts`

This test renders `EvalExplorer` with a single-arm fixture and asserts today's UI structure is preserved. It MUST pass before any UI edit; it MUST keep passing after every UI edit. Per the eng review IRON RULE.

- [ ] **Step 1: Create the regression test**

Create `apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts`:

```ts
/**
 * IRON RULE regression test from /plan-eng-review 2026-04-30.
 *
 * The eval A/B UI redesign modifies an existing path: today the
 * EvalExplorer renders for a single model. After this PR, it renders
 * differently when two A/B arms are present — but it MUST render
 * identically to today when only one arm is present.
 *
 * This test fixes that contract. It does NOT assert exact pixels or
 * full DOM trees (too brittle); it asserts the structural invariants
 * that make the UI "look the same as today":
 *
 *   - One verdict pill per case row, not two.
 *   - Pass/fail/unjudged radiogroup in the FilterBar (today's chips).
 *   - No comparison-chip group (the new one).
 *   - No "delta strip" or two-column scoreboard.
 *
 * Render with @testing-library/preact for accurate Preact rendering.
 */
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import EvalExplorer from "../EvalExplorer";

// Single-arm fixture: today's shape pre-A/B (one model, no arm tag).
const SINGLE_ARM_FIXTURE = {
  version: "1",
  generated_at: "2026-04-30T00:00:00Z",
  models: [
    {
      id: "grok-4.1-fast",
      name: "xAI Grok 4.1 Fast",
      label: "grok",
      pass_count: 1,
      case_count: 1,
    },
  ],
  cases: [
    {
      id: "q-0001",
      category: "citation",
      difficulty: "easy",
      prompt: "Quote a couplet.",
      expected_works: ["mirza-ghalib-diwan-e-ghalib-74ed4c"],
      results: {
        "grok-4.1-fast": {
          answer: "Couplet…",
          tool_calls: [],
          citations: [],
          duration_ms: 100,
          from_run: "test",
          mechanical_pass: true,
        },
      },
    },
  ],
};

describe("EvalExplorer — single-arm regression (IRON RULE)", () => {
  test("renders single verdict pill per case (not two)", async () => {
    // Mock fetch so the explorer's useEffect resolves with the fixture.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(SINGLE_ARM_FIXTURE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const { findByText, container } = render(<EvalExplorer />);
      // Wait for fetch + render.
      await findByText("q-0001");
      // Assert: exactly one verdict pill, no B/W labels.
      const pills = container.querySelectorAll(".eval-case-verdict-pill");
      expect(pills.length).toBe(1);
      expect(container.textContent).not.toContain("[✗ B]");
      expect(container.textContent).not.toContain("[✓ W]");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("FilterBar shows pass/fail/unjudged chips, NOT comparison chips", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(SINGLE_ARM_FIXTURE), {
        status: 200,
      })) as typeof fetch;

    try {
      const { findByText, queryByText } = render(<EvalExplorer />);
      await findByText("q-0001");
      // Today's chips are present.
      expect(queryByText("pass")).not.toBeNull();
      expect(queryByText("fail")).not.toBeNull();
      expect(queryByText("unjudged")).not.toBeNull();
      // Comparison chips are NOT present.
      expect(queryByText("Flips → pass")).toBeNull();
      expect(queryByText("Both pass")).toBeNull();
      expect(queryByText("Pending wiki")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Header has NO two-column scoreboard, NO delta strip", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(SINGLE_ARM_FIXTURE), {
        status: 200,
      })) as typeof fetch;

    try {
      const { findByText, container } = render(<EvalExplorer />);
      await findByText("q-0001");
      expect(container.querySelector(".eval-scoreboard")).toBeNull();
      expect(container.querySelector(".eval-delta-strip")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: Verify the test framework is wired**

Check that `@testing-library/preact` is available:

```bash
cd apps/site && bun pm ls 2>/dev/null | grep "@testing-library"
```

If MISSING, install it (and its peer):

```bash
cd apps/site && bun add -d @testing-library/preact happy-dom
```

`happy-dom` is the lightweight DOM Bun ships with built-in support for
(no extra setup file needed). Confirm `bunfig.toml` at the repo root or
`apps/site/` has `[test] preload = ["./test-setup.ts"]` if any setup is
needed; if not present and tests run cleanly, no preload required.

Expected: dep list shows `@testing-library/preact` + `happy-dom`. Bun
auto-loads `happy-dom` when imported.

**Fallback if `@testing-library/preact` doesn't render under `bun:test`:**
Replace the three component-rendering tests with a structural smoke test
that imports `EvalExplorer` and asserts:
- The default-export is a function (not undefined).
- Calling it with the single-arm fixture returns a JSX tree where
  serialising via `preact-render-to-string` contains the substrings
  `eval-case-verdict-pill` (1 occurrence per case), `pass`, `fail`, and
  does NOT contain `eval-scoreboard` or `eval-delta-strip` or
  `eval-ab-pill--baseline`.

This is strictly weaker than the DOM-rendering test but still catches
the regressions the IRON RULE is protecting against. Ship the weaker
version only if the stronger one can't run.

- [ ] **Step 3: Run the regression test against TODAY's code**

Run: `cd apps/site && bun test src/islands/eval-explorer/__tests__/single-arm-regression.test.ts`
Expected: PASS (3 tests). If any fail, the assumptions about today's DOM are wrong — fix the assertions to match today's actual structure before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/islands/eval-explorer/__tests__/single-arm-regression.test.ts apps/site/package.json apps/site/bun.lockb
git commit -m "test(eval): single-arm regression lock (IRON RULE)"
```

---

## Chunk 3: Header redesign

### Task 6: EvalHeader — extract + add `isAbMode` branch

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:221-310` (the `Header` function and `CostRow` block)

The current `Header` iterates `models.map()` and renders peer pills. We rebuild it to detect A/B mode via `isAbMode()` and render the two-column scoreboard. Single-arm mode falls back to today's layout — the regression test from Task 5 keeps that honest.

- [ ] **Step 1: Read the current Header function fully**

```bash
sed -n '221,320p' apps/site/src/islands/eval-explorer/EvalExplorer.tsx
```

Note the structure: `eval-header > 1,120 CASES box + map(models) of pills + meta + cost row`.

- [ ] **Step 2: Add the imports + a small helper at the top of `EvalExplorer.tsx`**

Add to the imports near line 13–21:

```ts
import { armOfModelId, isAbMode } from "../../lib/eval-arms";
```

- [ ] **Step 3: Replace the `Header` function with the A/B-aware split**

Replace lines 221–294 with:

```tsx
function Header({
  totalCases,
  models,
  generatedAt,
}: {
  totalCases: number;
  models: Array<EvalModelMeta>;
  generatedAt: string;
}): JSX.Element {
  if (isAbMode(models)) {
    return <AbScoreboard totalCases={totalCases} models={models} generatedAt={generatedAt} />;
  }
  return <SingleArmHeader totalCases={totalCases} models={models} generatedAt={generatedAt} />;
}

// Today's layout, preserved verbatim. The IRON RULE regression test pins
// this against single-arm fixtures.
function SingleArmHeader({
  totalCases,
  models,
  generatedAt,
}: {
  totalCases: number;
  models: Array<EvalModelMeta>;
  generatedAt: string;
}): JSX.Element {
  // ...existing JSX moved here unchanged. (Copy the original 221–294 body.)
}

// 2-arm mode: two-column scoreboard. Spec §1.
function AbScoreboard({
  totalCases,
  models,
  generatedAt,
}: {
  totalCases: number;
  models: Array<EvalModelMeta>;
  generatedAt: string;
}): JSX.Element {
  const baseline = models.find((m) => armOfModelId(m.id) === "baseline");
  const wiki = models.find((m) => armOfModelId(m.id) === "wiki");
  if (!baseline || !wiki) {
    // Defensive: isAbMode said yes but both arms not findable. Fall back.
    return <SingleArmHeader totalCases={totalCases} models={models} generatedAt={generatedAt} />;
  }
  return (
    <header class="eval-header eval-scoreboard">
      <div class="eval-scoreboard-anchor">
        <span class="eval-scoreboard-num">{totalCases.toLocaleString()}</span>
        <span class="eval-scoreboard-label">cases</span>
      </div>
      <ArmColumn arm="baseline" model={baseline} totalPool={totalCases} />
      <ArmColumn arm="wiki" model={wiki} totalPool={totalCases} />
      <div class="eval-scoreboard-meta">Generated {formatTimestamp(generatedAt)}</div>
    </header>
  );
}

function ArmColumn({
  arm,
  model,
  totalPool,
}: {
  arm: "baseline" | "wiki";
  model: EvalModelMeta;
  totalPool: number;
}): JSX.Element {
  // totalPool is the full pool size (data.cases.length, passed in from
  // the parent). Don't hardcode 1,120 — pool size changes when
  // questions are added/removed, and a stale literal would silently
  // mislead the partial-caption math.
  const totalCases = model.case_count ?? 0;
  const partial = totalCases > 0 && totalCases < totalPool;
  const passN = model.pass_count_named ?? 0;
  const totalN = model.case_count_named ?? 0;
  const passH = model.pass_count_hidden ?? 0;
  const totalH = model.case_count_hidden ?? 0;
  const pctN = totalN > 0 ? Math.round((passN / totalN) * 100) : null;
  const pctH = totalH > 0 ? Math.round((passH / totalH) * 100) : null;
  const cost = model.total_cost_usd ?? 0;
  const tokens = model.total_tokens ?? 0;
  const apiCalls = model.total_api_calls ?? 0;
  return (
    <div class={`eval-scoreboard-col eval-scoreboard-col--${arm}`}>
      <div class="eval-scoreboard-col-header">
        <span class="eval-scoreboard-arm">{arm.toUpperCase()}</span>
        <span class="eval-scoreboard-model">{stripArmSuffix(model.name)}</span>
        {partial && (
          <span class="eval-scoreboard-partial">
            partial · {totalCases} / {totalPool} done
          </span>
        )}
      </div>
      <dl class="eval-scoreboard-rows">
        <div class="eval-scoreboard-row">
          <dt>DISCOVERY</dt>
          <dd>{pctH === null ? "—" : `${pctH}% (${passH}/${totalH})`}</dd>
        </div>
        <div class="eval-scoreboard-row">
          <dt>CITATION</dt>
          <dd>{pctN === null ? "—" : `${pctN}% (${passN}/${totalN})`}</dd>
        </div>
        <div class="eval-scoreboard-row">
          <dt>SPEND</dt>
          <dd>${cost.toFixed(2)}</dd>
        </div>
        <div class="eval-scoreboard-row">
          <dt>TOKENS</dt>
          <dd>{fmtTokens(tokens)} ({apiCalls.toLocaleString()} calls)</dd>
        </div>
      </dl>
    </div>
  );
}

function stripArmSuffix(name: string): string {
  // "xAI Grok 4.1 Fast (baseline)" → "xAI Grok 4.1 Fast"
  return name.replace(/\s+\((baseline|wiki)\)\s*$/, "");
}
```

- [ ] **Step 4: Move the original Header body into `SingleArmHeader`**

Copy lines 221–294's JSX (the existing return) into the placeholder body of `SingleArmHeader`. **Do not change any existing class names or DOM structure** — the regression test depends on byte-stable single-arm output.

- [ ] **Step 5: Run regression test + helper tests**

Run: `cd apps/site && bun test src/islands/eval-explorer/__tests__/single-arm-regression.test.ts src/lib/__tests__/eval-arms.test.ts`
Expected: PASS — both files pass. The regression test confirms `SingleArmHeader` is byte-equivalent to today's Header.

- [ ] **Step 6: Build the site and visually confirm A/B header in dev**

Run: `cd apps/site && bun run build && bun run preview`
Open `http://localhost:4321/eval/` and verify:
- Two columns visible (baseline + wiki)
- Tints distinguishable (baseline warm grey, wiki faint blue)
- Discovery / Citation / Spend / Tokens rows aligned
- Partial caption visible on wiki side (since wiki run is partial)

If the columns are unstyled or collapse, that's expected — CSS lands in Task 11. The DOM should render correctly.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx
git commit -m "feat(eval): A/B scoreboard header with single-arm fallback"
```

---

## Chunk 4: Case list — two pills + comparison chips

### Task 7: CaseRow — two pills in 2-arm mode

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:574-602` (CaseRow function)
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:140-217` (Loaded — pass arm ids down)

- [ ] **Step 1: Update `Loaded` to resolve arm-model-ids and pass them to CaseList**

In the `Loaded` function (around line 140–217), after the existing `useMemo`s, add:

```ts
const armIds = useMemo(() => {
  const baseline = data.models.find((m) => armOfModelId(m.id) === "baseline");
  const wiki = data.models.find((m) => armOfModelId(m.id) === "wiki");
  return { baselineId: baseline?.id, wikiId: wiki?.id };
}, [data]);
const abMode = useMemo(() => isAbMode(data.models), [data]);
```

Update the `<CaseList>` call to:

```tsx
<CaseList
  cases={filteredCases}
  primaryModelId={data.models[0]?.id}
  abMode={abMode}
  baselineId={armIds.baselineId}
  wikiId={armIds.wikiId}
/>
```

- [ ] **Step 2: Update `CaseList` and `CaseRow` signatures + render**

Replace `CaseList` and `CaseRow` (lines 548–602) with:

```tsx
function CaseList({
  cases,
  primaryModelId,
  abMode,
  baselineId,
  wikiId,
}: {
  cases: EvalCase[];
  primaryModelId: string | undefined;
  abMode: boolean;
  baselineId: string | undefined;
  wikiId: string | undefined;
}): JSX.Element {
  if (cases.length === 0) {
    return (
      <div class="eval-empty">
        No cases match these filters. Try clearing one.
      </div>
    );
  }

  return (
    <ul class="eval-case-list">
      {cases.map((c) => (
        <li key={c.id}>
          {abMode && baselineId && wikiId ? (
            <AbCaseRow c={c} baselineId={baselineId} wikiId={wikiId} />
          ) : (
            <CaseRow c={c} primaryModelId={primaryModelId} />
          )}
        </li>
      ))}
    </ul>
  );
}

function CaseRow({
  c,
  primaryModelId,
}: {
  c: EvalCase;
  primaryModelId: string | undefined;
}): JSX.Element {
  // Today's single-arm layout — UNCHANGED, regression-test pinned.
  const result = primaryModelId ? c.results[primaryModelId] : undefined;
  const v = passOf(result);
  const verdict = v === true ? "pass" : v === false ? "fail" : "unjudged";
  return (
    <a class="eval-case-row" href={`/eval/${c.id}/`}>
      <span class="eval-case-id">{c.id}</span>
      <span class={"eval-case-tier eval-case-tier--" + (c.tier ?? "named")}
            title={c.tier === "hidden" ? "Discovery — work hidden in prompt" : "Citation — work named in prompt"}>
        {c.tier === "hidden" ? "discovery" : "citation"}
      </span>
      <span class="eval-case-cat">{c.category}</span>
      <span class={"eval-case-diff diff-" + slugify(c.difficulty)}>
        {c.difficulty}
      </span>
      <span class="eval-case-prompt">{c.prompt}</span>
      <span class="eval-case-verdict-pill" data-verdict={verdict} role="img" aria-label={`Verdict: ${verdict}`}>
        <span class="sr-only">{verdict}</span>
      </span>
      <span class="eval-case-arrow" aria-hidden="true">↗</span>
    </a>
  );
}

function AbCaseRow({
  c,
  baselineId,
  wikiId,
}: {
  c: EvalCase;
  baselineId: string;
  wikiId: string;
}): JSX.Element {
  const v = armVerdicts(c, baselineId, wikiId);
  const bState = v.baseline === true ? "pass" : v.baseline === false ? "fail" : "pending";
  const wState = v.wiki === true ? "pass" : v.wiki === false ? "fail" : "pending";
  return (
    <a class="eval-case-row eval-case-row--ab" href={`/eval/${c.id}/`}>
      <span class="eval-case-id">{c.id}</span>
      <span class={"eval-case-tier eval-case-tier--" + (c.tier ?? "named")}
            title={c.tier === "hidden" ? "Discovery — work hidden in prompt" : "Citation — work named in prompt"}>
        {c.tier === "hidden" ? "discovery" : "citation"}
      </span>
      <span class="eval-case-cat">{c.category}</span>
      <span class={"eval-case-diff diff-" + slugify(c.difficulty)}>
        {c.difficulty}
      </span>
      <span class="eval-case-prompt">{c.prompt}</span>
      <span class="eval-case-pillpair">
        <span class={`eval-ab-pill eval-ab-pill--baseline eval-ab-pill--${bState}`}
              role="img" aria-label={`Baseline ${bState}`}>
          <span class="eval-ab-pill-label" aria-hidden="true">B</span>
          <span class="sr-only">{bState}</span>
        </span>
        <span class={`eval-ab-pill eval-ab-pill--wiki eval-ab-pill--${wState}`}
              role="img" aria-label={`Wiki ${wState}`}>
          <span class="eval-ab-pill-label" aria-hidden="true">W</span>
          <span class="sr-only">{wState}</span>
        </span>
      </span>
      <span class="eval-case-arrow" aria-hidden="true">↗</span>
    </a>
  );
}
```

Add the `armVerdicts` import to the top imports:

```ts
import { armOfModelId, isAbMode, armVerdicts } from "../../lib/eval-arms";
```

- [ ] **Step 3: Run regression + helper tests**

Run: `cd apps/site && bun test`
Expected: PASS — single-arm regression confirms `CaseRow` (today's path) still renders one pill; helper tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx
git commit -m "feat(eval): two-pill case row in A/B mode"
```

### Task 8: Comparison chip group + filter pipeline

**Files:**
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:40-59` (FilterState type + EMPTY_FILTERS)
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:163-197` (filteredCases pipeline)
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:382-540` (FilterBar)
- Modify: `apps/site/src/islands/eval-explorer/EvalExplorer.tsx:606-645` (hash sync)

- [ ] **Step 1: Extend `FilterState` to track `compareMode`**

Replace lines 40–59 with:

```ts
import type { CompareMode } from "../../lib/eval-arms";

interface FilterState {
  categories: Set<string>;
  difficulties: Set<string>;
  passFilter: "all" | "pass" | "fail" | "unjudged";
  /**
   * A/B comparison filter — only meaningful in 2-arm mode. Replaces
   * passFilter in the UI when both arms are present (per spec D3).
   */
  compareMode: CompareMode;
  tierFilter: "all" | "named" | "hidden";
  query: string;
}

const EMPTY_FILTERS: FilterState = {
  categories: new Set(),
  difficulties: new Set(),
  passFilter: "all",
  compareMode: "all",
  tierFilter: "all",
  query: "",
};
```

- [ ] **Step 2: Update the `filteredCases` pipeline to apply compareMode in 2-arm mode**

In `Loaded.filteredCases` (~line 163–197), wrap the existing pass-filter block with the abMode check, and add the compare branch:

```ts
const filteredCases = useMemo(() => {
  const q = filters.query.trim().toLowerCase();
  return data.cases.filter((c) => {
    if (filters.categories.size > 0 && !filters.categories.has(c.category)) return false;
    if (filters.difficulties.size > 0 && !filters.difficulties.has(c.difficulty)) return false;
    if (filters.tierFilter !== "all") {
      const tier = c.tier ?? "named";
      if (tier !== filters.tierFilter) return false;
    }
    if (q && !c.prompt.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false;

    if (abMode && armIds.baselineId && armIds.wikiId) {
      // 2-arm mode: comparison filter replaces pass/fail.
      if (filters.compareMode !== "all") {
        const v = armVerdicts(c, armIds.baselineId, armIds.wikiId);
        if (!filterByCompare(v, filters.compareMode)) return false;
      }
    } else if (filters.passFilter !== "all") {
      // Single-arm mode: today's pass/fail/unjudged filter.
      const primaryModelId = data.models[0]?.id;
      const result = primaryModelId ? c.results[primaryModelId] : undefined;
      const v = passOf(result);
      if (filters.passFilter === "pass" && v !== true) return false;
      if (filters.passFilter === "fail" && v !== false) return false;
      if (filters.passFilter === "unjudged" && v !== null) return false;
    }
    return true;
  });
}, [data, filters, abMode, armIds]);
```

Add `filterByCompare` import to the top of the file:

```ts
import { armOfModelId, isAbMode, armVerdicts, filterByCompare } from "../../lib/eval-arms";
```

- [ ] **Step 3: Add the comparison chip group to FilterBar; hide pass/fail in A/B mode**

Update the `FilterBar` function signature to accept `abMode` and the compare chip-count tuple:

```tsx
function FilterBar({
  filters,
  setFilters,
  categories,
  difficulties,
  filteredCount,
  totalCount,
  abMode,
  compareCounts,
}: {
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  categories: string[];
  difficulties: string[];
  filteredCount: number;
  totalCount: number;
  abMode: boolean;
  compareCounts: Record<CompareMode, number>;
}): JSX.Element {
  // ... existing toggle / clearAll
```

Replace the existing pass-filter `<div role="radiogroup" aria-label="Verdict">` block (around line 437–455) with:

```tsx
{abMode ? (
  <div class="eval-filter-pass eval-filter-compare" role="radiogroup" aria-label="Comparison">
    {(["all", "flips-pass", "flips-fail", "both-pass", "both-fail", "pending-wiki"] as const).map((opt) => {
      const labels: Record<CompareMode, string> = {
        all: "all",
        "flips-pass": "Flips → pass",
        "flips-fail": "Flips → fail",
        "both-pass": "Both pass",
        "both-fail": "Both fail",
        "pending-wiki": "Pending wiki",
      };
      const count = compareCounts[opt];
      return (
        <button
          type="button"
          key={opt}
          role="radio"
          aria-checked={filters.compareMode === opt}
          class={"eval-pill " + (filters.compareMode === opt ? "is-active" : "")}
          onClick={() => setFilters((p) => ({ ...p, compareMode: opt }))}
        >
          {labels[opt]} {opt !== "all" && <span class="eval-pill-count">({count})</span>}
        </button>
      );
    })}
  </div>
) : (
  <div class="eval-filter-pass" role="radiogroup" aria-label="Verdict">
    {/* ... existing pass/fail/unjudged chips, unchanged ... */}
  </div>
)}
```

- [ ] **Step 4: Compute `compareCounts` in `Loaded` and pass to FilterBar**

In `Loaded`, before the return, compute the per-chip live counts:

```ts
const compareCounts = useMemo(() => {
  const counts: Record<CompareMode, number> = {
    all: data.cases.length,
    "flips-pass": 0, "flips-fail": 0,
    "both-pass": 0, "both-fail": 0,
    "pending-wiki": 0,
  };
  if (!abMode || !armIds.baselineId || !armIds.wikiId) return counts;
  for (const c of data.cases) {
    const v = armVerdicts(c, armIds.baselineId, armIds.wikiId);
    if (filterByCompare(v, "flips-pass")) counts["flips-pass"]++;
    if (filterByCompare(v, "flips-fail")) counts["flips-fail"]++;
    if (filterByCompare(v, "both-pass")) counts["both-pass"]++;
    if (filterByCompare(v, "both-fail")) counts["both-fail"]++;
    if (filterByCompare(v, "pending-wiki")) counts["pending-wiki"]++;
  }
  return counts;
}, [data, abMode, armIds]);
```

Pass to `<FilterBar>`:

```tsx
<FilterBar
  filters={filters}
  setFilters={setFilters}
  categories={allCategories}
  difficulties={allDifficulties}
  filteredCount={filteredCases.length}
  totalCount={data.cases.length}
  abMode={abMode}
  compareCounts={compareCounts}
/>
```

- [ ] **Step 5: Update hash sync — `compare=` not `diff=`**

In `readFiltersFromHash` (around line 606–629), add:

```ts
const compareRaw = get("compare");
const validCompare: CompareMode[] = ["all", "flips-pass", "flips-fail", "both-pass", "both-fail", "pending-wiki"];
const compareMode: CompareMode =
  validCompare.includes(compareRaw as CompareMode) ? (compareRaw as CompareMode) : "all";
return {
  // ...existing fields
  compareMode,
};
```

In `writeFiltersToHash` (around line 631–645), add:

```ts
if (f.compareMode !== "all") params.set("compare", f.compareMode);
```

NOTE: the existing `params.set("diff", ...)` is for **difficulties** — leave it alone. We use `compare=` for the new comparison filter to avoid the collision.

- [ ] **Step 6: Run all tests and the manual smoke**

Run: `cd apps/site && bun test`
Expected: all pass.

Run: `cd apps/site && bun run build && bun run preview`
Open `/eval/` and:
- See comparison chip group (instead of pass/fail) when 2-arm data is present.
- Click `Flips → pass` chip — list filters; URL hash updates to `#compare=flips-pass`.
- Refresh — chip stays selected.
- Live counts on chips match the filtered list count.

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/islands/eval-explorer/EvalExplorer.tsx
git commit -m "feat(eval): comparison filter chip group + hash sync (D3, D5)"
```

---

## Chunk 5: Case detail — tabs + delta strip

### Task 9: `[id].astro` — read both arms' results

**Files:**
- Modify: `apps/site/src/pages/eval/[id].astro:35-92`

- [ ] **Step 1: Resolve baseline and wiki ids in `getStaticPaths`**

Replace lines 35–48 with:

```ts
export const getStaticPaths = (() => {
  const evalJsonPath = resolve(process.cwd(), "public", "eval.json");
  const data = JSON.parse(readFileSync(evalJsonPath, "utf-8")) as EvalJson;

  // Resolve A/B arm ids (or fall back to single-model legacy).
  const baselineModel = data.models.find((m) => m.id.endsWith("__baseline"));
  const wikiModel = data.models.find((m) => m.id.endsWith("__wiki"));
  const abMode = !!(baselineModel && wikiModel);
  const primaryModelId = data.models[0]?.id;

  return data.cases.map((c) => ({
    params: { id: c.id },
    props: {
      case: c,
      primaryModelId,
      baselineId: baselineModel?.id,
      wikiId: wikiModel?.id,
      abMode,
    },
  }));
}) satisfies GetStaticPaths;

const {
  case: c,
  primaryModelId,
  baselineId,
  wikiId,
  abMode,
} = Astro.props as {
  case: EvalCase;
  primaryModelId: string | undefined;
  baselineId: string | undefined;
  wikiId: string | undefined;
  abMode: boolean;
};
```

- [ ] **Step 2: Run the rendering pipeline twice (once per arm) when in A/B mode**

Replace lines 54–92 with:

```ts
function renderArm(modelId: string | undefined) {
  const r = modelId ? c.results[modelId] : undefined;
  if (!r) return null;
  const html = md.parse(r.answer);
  if (typeof html !== "string") {
    throw new Error("marked.parse returned non-string; check marked version compat");
  }
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "strong", "em", "del", "ins", "mark", "sub", "sup",
      "code", "pre", "kbd", "samp", "var",
      "blockquote",
      "ul", "ol", "li", "dl", "dt", "dd",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "a",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "align", "scope", "target", "rel"],
  });
  const linkified = linkifyHtml(sanitized, r.citations, listChapters);
  return { result: r, html: linkified, verdict: passOf(r) };
}

const baselineRender = abMode ? renderArm(baselineId) : null;
const wikiRender = abMode ? renderArm(wikiId) : null;
const singleRender = !abMode ? renderArm(primaryModelId) : null;

// For the page header: prefer baseline's verdict in A/B mode (default tab).
const verdict = abMode ? baselineRender?.verdict ?? null : singleRender?.verdict ?? null;
const verdictText = verdict === true ? "Pass" : verdict === false ? "Fail" : "Unjudged";
const verdictGlyph = verdict === true ? "✓" : verdict === false ? "×" : "—";

const sourceUrl = (() => {
  if (abMode) {
    const b = baselineRender?.result;
    if (b && baselineId) {
      return `https://github.com/adoistic/falsafa/tree/main/apps/mcp/eval/runs/${b.from_run}/${baselineId}/${c.id}.json`;
    }
    return null;
  }
  if (singleRender?.result && primaryModelId) {
    return `https://github.com/adoistic/falsafa/tree/main/apps/mcp/eval/runs/${singleRender.result.from_run}/${primaryModelId}/${c.id}.json`;
  }
  return null;
})();
```

- [ ] **Step 3: Build to confirm no errors**

Run: `cd apps/site && bun run build 2>&1 | tail -10`
Expected: build succeeds. Page renders both arms' content into static HTML.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/eval/[id].astro
git commit -m "feat(eval-case): dual-arm view-model in [id].astro"
```

### Task 10: Tabs (CSS `:target`) + delta strip + dual content sections

**Files:**
- Modify: `apps/site/src/pages/eval/[id].astro` (the `<article>` body)

- [ ] **Step 1: Render the tab control + delta strip + two content sections**

Find the `<article class="eval-case-page">` block (~line 145). Add tab control + delta strip + dual sections in A/B mode, with a fallback to today's single-arm content when not.

The tab structure uses plain `<a>` anchors and the corresponding content sections use `id="case-baseline"` / `id="case-wiki"`. CSS `:target` rules show/hide.

Replace the existing single-section render (where `answerHtml` is dropped into the article) with:

```astro
{abMode && baselineRender && wikiRender ? (
  <>
    <nav class="eval-case-tabs" role="tablist" aria-label="A/B arm">
      <a class="eval-case-tab eval-case-tab--baseline" id="tab-baseline"
         href={`#case-baseline`} role="tab" aria-controls="case-baseline">
        Baseline
      </a>
      <a class="eval-case-tab eval-case-tab--wiki" id="tab-wiki"
         href={`#case-wiki`} role="tab" aria-controls="case-wiki">
        Wiki
      </a>
    </nav>

    <div class="eval-delta-strip" aria-label="A/B summary">
      <DeltaRow arm="baseline" render={baselineRender} />
      <DeltaRow arm="wiki" render={wikiRender} />
    </div>

    <section id="case-baseline" class="eval-case-arm eval-case-arm--baseline" role="tabpanel" aria-labelledby="tab-baseline">
      <CaseArmContent c={c} render={baselineRender} arm="baseline" />
    </section>
    <section id="case-wiki" class="eval-case-arm eval-case-arm--wiki" role="tabpanel" aria-labelledby="tab-wiki">
      <CaseArmContent c={c} render={wikiRender} arm="wiki" />
    </section>
  </>
) : abMode && baselineRender && !wikiRender ? (
  <>
    <nav class="eval-case-tabs" role="tablist" aria-label="A/B arm">
      <a class="eval-case-tab eval-case-tab--baseline is-active" href="#case-baseline">Baseline</a>
    </nav>
    <div class="eval-delta-strip">
      <DeltaRow arm="baseline" render={baselineRender} />
      <div class="eval-delta-row eval-delta-row--pending">Wiki: pending — run not complete</div>
    </div>
    <section id="case-baseline" class="eval-case-arm eval-case-arm--baseline">
      <CaseArmContent c={c} render={baselineRender} arm="baseline" />
    </section>
  </>
) : singleRender ? (
  <CaseArmContent c={c} render={singleRender} arm={null} />
) : null}
```

- [ ] **Step 2: Add small Astro components for `DeltaRow` and `CaseArmContent`**

Inside the same `[id].astro` (top of frontmatter or as Astro components in the same file), define:

```astro
---
// Inline component scaffolding inside [id].astro (kept here to avoid
// pulling out a new file for two tiny renders that don't need reuse).
function fmtCost(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(4)}`;
}
function fmtTokens(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
---
```

`DeltaRow` and `CaseArmContent` should be small `.astro` files OR inline JSX-like blocks. For minimum diff, inline them directly in `[id].astro` as helper functions returning HTML strings, OR (cleaner) pull them into `apps/site/src/components/EvalCaseArm.astro` and `apps/site/src/components/EvalCaseDeltaRow.astro`.

Use the cleaner option — create:

`apps/site/src/components/EvalCaseDeltaRow.astro`:

```astro
---
import type { EvalCaseResult } from "../lib/eval-types";
import { passOf } from "../lib/eval-types";

const { arm, render } = Astro.props as {
  arm: "baseline" | "wiki";
  render: { result: EvalCaseResult; verdict: boolean | null } | null;
};
const r = render?.result;
const v = render?.verdict;
const tools = r?.tool_calls?.length ?? 0;
const cost = r?.usage?.cost_usd ?? null;
const tokens = r?.usage?.total_tokens;
function fmtCost(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(4)}`;
}
function fmtTokens(n: number | undefined) {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
---
<div class={`eval-delta-row eval-delta-row--${arm}`}>
  <span class="eval-delta-row-label">{arm === "baseline" ? "Baseline:" : "Wiki:"}</span>
  <span class={`eval-delta-row-verdict eval-delta-row-verdict--${v === true ? "pass" : v === false ? "fail" : "unjudged"}`}>
    {v === true ? "✓ pass" : v === false ? "✗ fail" : "— unjudged"}
  </span>
  <span class="eval-delta-row-tools">{tools} tools</span>
  <span class="eval-delta-row-cost">{fmtCost(cost)}</span>
  <span class="eval-delta-row-tokens">{fmtTokens(tokens)} tok</span>
</div>
```

`apps/site/src/components/EvalCaseArm.astro`:

Move the existing single-arm rendering body into this file, parameterised
by the `render` prop. Keep the existing structure so the visual layout
doesn't change inside a tab. Move all of the following sections from
`[id].astro` (in this exact order — they're already adjacent in today's
file at lines ~145–510):

1. **Tier kicker** (`<span class="eval-case-tier">discovery</span>` /
   `citation`).
2. **Prompt block** (`<h1>` + the prompt text and `<RunItYourself>`
   component).
3. **Expected works** chip row (the `expected_works` rendered as small
   chips with link to each work page).
4. **Cost & tokens section** (the `<details>` block summarising
   `result.usage` + the per-step trace table; existing component path is
   inline in `[id].astro`).
5. **Citations chip row** (`citationChips` mapped to chips — the
   reduce() at line ~99 of today's `[id].astro`).
6. **Answer HTML** (`<Fragment set:html={answerHtml} />` — the markdown-
   parsed + DOMPurify-sanitized + linkifyHtml output, sized for the
   container).
7. **Tool calls** (`<ToolCallTrace toolCalls={result.tool_calls} />`).
8. **Source URL footer** (`<a href={sourceUrl}>Source on GitHub</a>` +
   `<NonDeterminismCaveat />` + `<ReportThis />`).

Do NOT move the breadcrumb, verdict pill (top of page), or the page
`<Base>` shell — those stay in `[id].astro` as the page chrome that
wraps both arm sections.

Component props:

```ts
interface Props {
  c: EvalCase;
  render: { result: EvalCaseResult; html: string; verdict: boolean | null };
  arm: "baseline" | "wiki" | null;
}
```

`arm` is null in single-arm legacy mode (used to suppress arm-specific
styling when no A/B is in play).

- [ ] **Step 3: Build + smoke**

Run: `cd apps/site && bun run build && bun run preview`
- Open `/eval/q-0405/` (or any case present in both runs).
- Confirm: tabs visible, delta strip visible (both rows), default Baseline tab content shown.
- Click `Wiki` tab → URL becomes `/eval/q-0405/#case-wiki`, content swaps.
- Browser back → returns to baseline.
- Refresh on `#case-wiki` → wiki tab still active.

(CSS for the `:target` show/hide rule lands in Task 11. Until then, both sections may be visible simultaneously.)

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/eval/[id].astro apps/site/src/components/EvalCaseDeltaRow.astro apps/site/src/components/EvalCaseArm.astro
git commit -m "feat(eval-case): tabs + delta strip + dual-arm content sections"
```

---

## Chunk 6: Styles + final smoke

### Task 11: `eval.css` — all new styles

**Files:**
- Modify: `apps/site/src/styles/eval.css`

Add styles for: arm tints, two-column scoreboard, two-pill row, comparison chip group, tab control with `:target` rule, delta strip.

- [ ] **Step 1: Add the arm-tint custom-property tokens at `:root`**

Find the `:root` block in `eval.css` (near the top). Add:

```css
:root {
  /* ... existing tokens ... */

  /* A/B-arm tints (spec §1) */
  --arm-baseline-bg: color-mix(in oklch, var(--ink) 4%, var(--bg));
  --arm-wiki-bg: color-mix(in oklch, var(--accent) 6%, var(--bg));
  --arm-divider: color-mix(in oklch, var(--ink) 12%, transparent);
}
```

- [ ] **Step 2: Add scoreboard styles**

Append to `eval.css`:

```css
/* ── A/B scoreboard header ──────────────────────────────────────────── */
.eval-scoreboard {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 1rem;
  align-items: stretch;
  border-bottom: 1px solid var(--arm-divider);
  padding-bottom: 1rem;
}
.eval-scoreboard-anchor {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.eval-scoreboard-num { font-size: 2.5rem; font-weight: 600; line-height: 1; }
.eval-scoreboard-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
}
.eval-scoreboard-col {
  padding: 0.75rem 1rem;
  border-radius: 6px;
}
.eval-scoreboard-col--baseline { background: var(--arm-baseline-bg); }
.eval-scoreboard-col--wiki { background: var(--arm-wiki-bg); }
.eval-scoreboard-col-header { display: flex; flex-direction: column; gap: 0.125rem; margin-bottom: 0.75rem; }
.eval-scoreboard-arm {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.eval-scoreboard-model {
  font-size: 0.875rem;
  color: var(--ink-muted);
}
.eval-scoreboard-partial {
  font-size: 0.7rem;
  color: var(--ink-muted);
  font-style: italic;
}
.eval-scoreboard-rows { display: grid; gap: 0.375rem; margin: 0; }
.eval-scoreboard-row { display: grid; grid-template-columns: 5.5rem 1fr; align-items: baseline; }
.eval-scoreboard-row dt {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
  text-transform: uppercase;
}
.eval-scoreboard-row dd { margin: 0; font-variant-numeric: tabular-nums; }
.eval-scoreboard-meta {
  grid-column: 1 / -1;
  text-align: right;
  font-size: 0.75rem;
  color: var(--ink-muted);
}
```

- [ ] **Step 3: Add two-pill row styles**

```css
/* ── A/B case row pill pair ─────────────────────────────────────────── */
.eval-case-pillpair {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
}
.eval-ab-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}
.eval-ab-pill-label { font-weight: 700; opacity: 0.6; font-family: var(--mono, monospace); }
.eval-ab-pill--pass { background: color-mix(in oklch, var(--success, #2e7d32) 18%, var(--bg)); color: var(--success, #2e7d32); }
.eval-ab-pill--fail { background: color-mix(in oklch, var(--error, #c62828) 14%, var(--bg)); color: var(--error, #c62828); }
.eval-ab-pill--pending { background: color-mix(in oklch, var(--ink) 6%, var(--bg)); color: var(--ink-muted); }
```

- [ ] **Step 4: Add comparison-chip-group styles**

```css
/* ── Comparison filter chips ────────────────────────────────────────── */
.eval-filter-compare .eval-pill { letter-spacing: 0.02em; }
.eval-pill-count { color: var(--ink-muted); font-size: 0.85em; margin-left: 0.25rem; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Add tab + `:target` show/hide rule**

```css
/* ── Case-detail tabs (CSS :target tab swap, zero JS) ───────────────── */
.eval-case-tabs {
  display: inline-flex;
  gap: 0.25rem;
  margin-block: 0.5rem 1rem;
}
.eval-case-tab {
  padding: 0.375rem 0.875rem;
  border: 1px solid var(--arm-divider);
  border-radius: 999px;
  text-decoration: none;
  font-size: 0.875rem;
  color: var(--ink);
}
.eval-case-tab--baseline { background: transparent; }
.eval-case-tab--wiki { background: transparent; }

/* Two arm sections — by default, baseline shows, wiki hides. */
.eval-case-arm--baseline { display: block; }
.eval-case-arm--wiki { display: none; }

/* When #case-wiki is the URL fragment, swap visibility. */
.eval-case-arm--wiki:target { display: block; }
.eval-case-arm--wiki:target ~ .eval-case-arm--baseline,
body:has(#case-wiki:target) .eval-case-arm--baseline { display: none; }

/* Active-tab highlight (mirror :target). */
.eval-case-tab--baseline { background: var(--arm-baseline-bg); }
body:has(#case-wiki:target) .eval-case-tab--baseline { background: transparent; }
body:has(#case-wiki:target) .eval-case-tab--wiki { background: var(--arm-wiki-bg); }
```

- [ ] **Step 6: Add delta-strip styles**

```css
/* ── A/B delta strip on case detail ─────────────────────────────────── */
.eval-delta-strip {
  display: grid;
  gap: 0.25rem;
  border: 1px solid var(--arm-divider);
  border-radius: 6px;
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
}
.eval-delta-row {
  display: grid;
  grid-template-columns: 6rem auto auto auto auto;
  gap: 1rem;
  align-items: baseline;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.eval-delta-row--baseline { background: var(--arm-baseline-bg); padding: 0.25rem 0.5rem; border-radius: 4px; }
.eval-delta-row--wiki { background: var(--arm-wiki-bg); padding: 0.25rem 0.5rem; border-radius: 4px; }
.eval-delta-row--pending { color: var(--ink-muted); font-style: italic; padding: 0.25rem 0.5rem; }
.eval-delta-row-label { font-weight: 600; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.75rem; }
.eval-delta-row-verdict--pass { color: var(--success, #2e7d32); }
.eval-delta-row-verdict--fail { color: var(--error, #c62828); }
.eval-delta-row-verdict--unjudged { color: var(--ink-muted); }
```

- [ ] **Step 7: Build + visual smoke**

Run: `cd apps/site && bun run build && bun run preview`
Open `/eval/`:
- Two-column scoreboard renders with distinct tints.
- Vertical rule between columns visible (subtle).
- Discovery / Citation / Spend / Tokens rows aligned across both columns.
- Partial caption visible while wiki run is in progress.

Open `/eval/q-0405/`:
- Tab control visible (Baseline + Wiki).
- Delta strip below tabs, both rows tinted.
- Default tab is Baseline; clicking Wiki swaps content.

Run all tests: `cd apps/site && bun test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/styles/eval.css
git commit -m "style(eval): A/B scoreboard, pill pair, tabs (:target), delta strip"
```

---

## Chunk 7: End-to-end verification + push

### Task 12: Manual smoke checklist

Walk through every spec test point. Mark each as PASS/FAIL.

- [ ] **Step 1: Build with full baseline (1,120) + partial wiki (e.g. 329).**

```bash
cd /Users/siraj/falsafa
bun run eval/build-eval-json.ts
cd apps/site && bun run build && bun run preview
```

Expected: header shows two columns, partial caption visible on wiki side. **PASS / FAIL.**

- [ ] **Step 2: Filter chips smoke**

Open `/eval/`. Click `Flips → pass` chip. Confirm:
- Only flip-to-pass cases render.
- Chip count matches the filtered list count.
- URL becomes `#compare=flips-pass`.

Repeat for `Flips → fail`, `Both pass`, `Both fail`, `Pending wiki`. **PASS / FAIL.**

- [ ] **Step 3: Hash sync smoke**

Load `/eval/#compare=flips-pass` directly. Confirm chip is selected and list filtered. **PASS / FAIL.**

- [ ] **Step 4: Case detail smoke**

Open `/eval/q-0405/`. Confirm:
- Default tab = Baseline.
- Delta strip visible with both rows.
- Both arms' numbers correct.
- Click Wiki → URL = `#case-wiki`, content swaps.
- Refresh — Wiki tab still active.

**PASS / FAIL.**

- [ ] **Step 5: Hash fallback edge**

Open `/eval/q-NNNN/#case-wiki` for a case where wiki has no result. Confirm: silent fallback to Baseline tab, no error. **PASS / FAIL.**

- [ ] **Step 6: Single-arm regression smoke**

Run: `cd apps/site && bun test src/islands/eval-explorer/__tests__/single-arm-regression.test.ts`
Expected: PASS — all 3 regression assertions still hold.

- [ ] **Step 7: Visual / a11y smoke**

- Tints distinguishable in both light and dark mode.
- Column rule visible without being heavy.
- Verdict pills have `role="img"` + `aria-label`; `sr-only` text reads correctly in a screen reader.
- Tab links have `role="tab"` and `aria-controls`; sections have `role="tabpanel"`.

**PASS / FAIL.**

### Task 13: Push to GitHub + deploy verification

- [ ] **Step 1: Run final test pass**

```bash
cd apps/site && bun test
```

Expected: all green. Note total test count for the commit message.

- [ ] **Step 2: Build + deploy artifacts**

```bash
cd apps/site && bun run build
cd /Users/siraj/falsafa
git status --short
```

Expected: only the touched files are staged.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: push succeeds; deploy preview lights up on the next CDN refresh.

- [ ] **Step 4: Final smoke against the deployed site**

Open the deployed `/eval/` URL. Walk through Task 12 smoke once more. **PASS / FAIL.**

- [ ] **Step 5: Update `TODOS.md` (if anything new came up during implementation)**

If implementation surfaced a new TODO not covered in `TODOS.md`, append it to the appropriate section.

```bash
git add TODOS.md
git commit -m "docs(todos): capture implementation followups"
git push origin main
```

(Skip if no new TODOs.)

---

## Done criteria

- All 4 helpers in `eval-arms.ts` are tested and pass (~42 unit tests).
- Single-arm regression test passes throughout (IRON RULE).
- Both `/eval/` and `/eval/<id>/` render correctly in 2-arm and 1-arm modes.
- All 7 manual smoke steps PASS.
- Push to `main` succeeds; deploy preview reflects changes.
- `TODOS.md` ⚠ section reminding of the graded-score rework remains visible (NOT removed by this PR).
