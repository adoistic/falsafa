# Works Browse Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/works/` with a faceted, searchable, text-only catalog that shows all 2,017 works and scales to future ontology filters.

**Architecture:** A pure, unit-tested logic module (`works-filter.ts`) does all filtering/counting/sorting/URL state with no DOM. A Preact island (`WorksBrowser.tsx`) renders the sticky facet sidebar, search, sort, active-filter chips, result grid (text cards, no images) and a mobile drawer, delegating all logic to the module. The Astro page (`works/index.astro`) becomes a thin shell that builds the slim work list and mounts the island.

**Tech Stack:** Astro (static) + Preact islands (`.tsx`), TypeScript, bun test, scoped CSS using `src/styles/tokens.css` variables.

Full design: `docs/superpowers/specs/2026-06-29-works-browse-redesign-design.md`. Read it first.

## File structure

- Create `apps/site/src/lib/works-filter.ts` — types + pure functions: `filterWorks`, `facetCounts`, `sortWorks`, `parseFilterState`, `serializeFilterState`, `FACET_DIMENSIONS`, `ERA_ORDER`.
- Create `apps/site/src/lib/works-filter.test.ts` — bun tests for the above.
- Create `apps/site/src/islands/WorksBrowser.tsx` — the Preact island (UI only; imports the module).
- Modify `apps/site/src/pages/works/index.astro` — drop era-grouping + cover loop; build `BrowseWork[]`, derive facet values, mount the island.
- `apps/site/src/components/WorkCardGrid.astro` is left in place (still used elsewhere if any); the island renders its own text cards.

Conventions: bun test must be run from inside `apps/site` (root run fails with an EMFILE glob error). Styling uses CSS custom properties from `tokens.css` (`--ink`, `--ink-muted`, `--paper`, `--accent`, `--rule`, `--font-display`, `--font-sans`, `--s-*`, `--fs-*`). Sentence case everywhere.

---

### Task 1: Pure filter/sort/URL module (TDD)

**Files:**
- Create: `apps/site/src/lib/works-filter.ts`
- Test: `apps/site/src/lib/works-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/src/lib/works-filter.test.ts
import { describe, it, expect } from "bun:test";
import {
  filterWorks, facetCounts, sortWorks, parseFilterState, serializeFilterState,
  emptyState, type BrowseWork, type FilterState,
} from "./works-filter";

const W = (o: Partial<BrowseWork>): BrowseWork => ({
  slug: "s", title: "T", author: "A", author_slug: "a",
  era: "Imperial", genre: "Poetry", language: "Greek",
  difficulty: "Advanced", published_year: 100, total_logical_chapters: 1, ...o,
});
const works: BrowseWork[] = [
  W({ slug: "a", title: "Iliad", author: "Homer", era: "Classical", genre: "Poetry", language: "Greek", published_year: -750 }),
  W({ slug: "b", title: "Republic", author: "Plato", era: "Classical", genre: "Philosophy", language: "Greek", published_year: -380 }),
  W({ slug: "c", title: "Aeneid", author: "Virgil", era: "Imperial", genre: "Poetry", language: "Latin", published_year: -19 }),
  W({ slug: "d", title: "Sonnets", author: "Shakespeare", era: "16th Century", genre: "Poetry", language: "English", published_year: 1609 }),
  W({ slug: "e", title: "Untitled", author: "Anon", era: "Imperial", genre: "Poetry", language: "Latin", published_year: null }),
];

describe("filterWorks", () => {
  it("returns all works for empty state", () => {
    expect(filterWorks(works, emptyState()).length).toBe(5);
  });
  it("AND across dimensions, OR within a dimension", () => {
    const s = { ...emptyState(), language: ["Greek", "Latin"], genre: ["Poetry"] };
    expect(filterWorks(works, s).map((w) => w.slug).sort()).toEqual(["a", "c", "e"]);
  });
  it("search matches title or author, case-insensitive substring", () => {
    expect(filterWorks(works, { ...emptyState(), q: "plato" }).map((w) => w.slug)).toEqual(["b"]);
    expect(filterWorks(works, { ...emptyState(), q: "son" }).map((w) => w.slug)).toEqual(["d"]);
  });
});

describe("facetCounts", () => {
  it("counts a dimension against OTHER active facets + search, ignoring its own selection", () => {
    const s = { ...emptyState(), genre: ["Poetry"], language: ["Greek"] };
    // counts for `language` ignore the language selection but apply genre=Poetry
    const c = facetCounts(works, s, "language");
    expect(c.get("Greek")).toBe(1); // a
    expect(c.get("Latin")).toBe(2); // c, e
    expect(c.get("English")).toBe(1); // d
  });
});

describe("sortWorks", () => {
  it("chrono: ascending published_year, nulls last", () => {
    expect(sortWorks(works, "chrono").map((w) => w.slug)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("title: locale A-Z", () => {
    expect(sortWorks(works, "title").map((w) => w.title)[0]).toBe("Aeneid");
  });
  it("author: locale A-Z", () => {
    expect(sortWorks(works, "author").map((w) => w.author)[0]).toBe("Anon");
  });
});

describe("URL state round-trip", () => {
  it("serialize then parse is identity for non-empty dims", () => {
    const s: FilterState = { q: "war", era: ["Imperial"], language: ["Greek", "Latin"], genre: [], difficulty: [], sort: "title" };
    const parsed = parseFilterState(new URLSearchParams(serializeFilterState(s)));
    expect(parsed).toEqual(s);
  });
  it("empty state serializes to empty string and parses back to empty", () => {
    expect(serializeFilterState(emptyState())).toBe("");
    expect(parseFilterState(new URLSearchParams(""))).toEqual(emptyState());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/site && bun test src/lib/works-filter.test.ts`
Expected: FAIL — `Cannot find module "./works-filter"`.

- [ ] **Step 3: Implement the module**

```ts
// apps/site/src/lib/works-filter.ts
export type SortKey = "chrono" | "title" | "author";
export type FacetDim = "era" | "language" | "genre" | "difficulty";

export interface BrowseWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
  era: string;
  genre: string;
  language: string;
  difficulty: string; // "" / "Unrated" when null in manifest
  published_year: number | null;
  total_logical_chapters: number;
}

export interface FilterState {
  q: string;
  era: string[];
  language: string[];
  genre: string[];
  difficulty: string[];
  sort: SortKey;
}

export const FACET_DIMENSIONS: FacetDim[] = ["era", "language", "genre", "difficulty"];

// Chronological era ordering for the chrono sort tiebreak + sidebar order.
export const ERA_ORDER = [
  "Ancient", "Classical", "Hellenistic", "Imperial", "Late Antiquity",
  "Renaissance", "Medieval", "16th Century", "Enlightenment", "18th Century",
  "19th Century", "20th Century", "Unknown",
];

export function emptyState(): FilterState {
  return { q: "", era: [], language: [], genre: [], difficulty: [], sort: "chrono" };
}

function matchesSearch(w: BrowseWork, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return w.title.toLowerCase().includes(needle) || w.author.toLowerCase().includes(needle);
}

// AND across dimensions, OR within a dimension. `skip` excludes one dimension
// (used by facetCounts so a facet's own selection doesn't constrain its counts).
function matchesFacets(w: BrowseWork, s: FilterState, skip?: FacetDim): boolean {
  for (const dim of FACET_DIMENSIONS) {
    if (dim === skip) continue;
    const sel = s[dim];
    if (sel.length && !sel.includes(w[dim])) return false;
  }
  return true;
}

export function filterWorks(works: BrowseWork[], s: FilterState): BrowseWork[] {
  return works.filter((w) => matchesSearch(w, s.q) && matchesFacets(w, s));
}

export function facetCounts(works: BrowseWork[], s: FilterState, dim: FacetDim): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of works) {
    if (!matchesSearch(w, s.q) || !matchesFacets(w, s, dim)) continue;
    counts.set(w[dim], (counts.get(w[dim]) ?? 0) + 1);
  }
  return counts;
}

export function sortWorks(works: BrowseWork[], sort: SortKey): BrowseWork[] {
  const out = works.slice();
  if (sort === "title") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "author") return out.sort((a, b) => a.author.localeCompare(b.author));
  const eraIdx = (e: string) => { const i = ERA_ORDER.indexOf(e); return i === -1 ? ERA_ORDER.length : i; };
  return out.sort((a, b) => {
    const ay = a.published_year, by = b.published_year;
    if (ay !== null && by !== null && ay !== by) return ay - by;
    if (ay === null && by !== null) return 1;
    if (ay !== null && by === null) return -1;
    const d = eraIdx(a.era) - eraIdx(b.era);
    return d !== 0 ? d : a.title.localeCompare(b.title);
  });
}

export function parseFilterState(p: URLSearchParams): FilterState {
  const list = (k: string) => { const v = p.get(k); return v ? v.split(",").filter(Boolean) : []; };
  const sort = p.get("sort");
  return {
    q: p.get("q") ?? "",
    era: list("era"), language: list("lang"), genre: list("genre"), difficulty: list("diff"),
    sort: sort === "title" || sort === "author" ? sort : "chrono",
  };
}

export function serializeFilterState(s: FilterState): string {
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.era.length) p.set("era", s.era.join(","));
  if (s.language.length) p.set("lang", s.language.join(","));
  if (s.genre.length) p.set("genre", s.genre.join(","));
  if (s.difficulty.length) p.set("diff", s.difficulty.join(","));
  if (s.sort !== "chrono") p.set("sort", s.sort);
  return p.toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/site && bun test src/lib/works-filter.test.ts`
Expected: PASS (all describe blocks green). The `serializeFilterState` query-string key order must match `parseFilterState` — they do, since parse is order-independent.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/works-filter.ts apps/site/src/lib/works-filter.test.ts
git commit -m "feat(site): pure works-filter module (filter/facet-counts/sort/url) + tests"
```

---

### Task 2: WorksBrowser Preact island

**Files:**
- Create: `apps/site/src/islands/WorksBrowser.tsx`

Look first at an existing island in `apps/site/src/islands/` for the Preact import style (`preact`, `preact/hooks`) and at `components/WorkCardGrid.astro` for the card markup/classes to mirror, and `styles/tokens.css` for variables.

- [ ] **Step 1: Implement the island**

Component contract:
- Props: `{ works: BrowseWork[] }` (the full corpus, passed from the page).
- State: `FilterState` via `useState`, initialised from `parseFilterState(new URLSearchParams(location.search))` (guard for SSR: only read `location` inside `useEffect`/lazily — initialise to `emptyState()` then sync in a mount `useEffect`).
- On any state change: call `serializeFilterState`, write `history.replaceState(null, "", qs ? "?" + qs : location.pathname)`. Add a `popstate` listener that re-parses and sets state.
- Derived per render: `const visible = sortWorks(filterWorks(works, state), state.sort);` and, for each facet dim, `facetCounts(works, state, dim)`.

Render structure (all sentence case, tokens for colour/spacing):
- Wrapper `div.browse` with CSS grid: `grid-template-columns: 240px 1fr; gap: var(--s-8);`.
- `<aside class="facets">` — `position: sticky; top: <header offset, e.g. var(--s-20)>; align-self: start; max-height: calc(100vh - var(--s-24)); overflow:auto;`. Hidden on mobile (`@media (max-width: 880px) { display:none }`). For each dim in `FACET_DIMENSIONS`: a `<fieldset>` with a `<legend>` (sentence-case label: Era/Language/Genre/Difficulty) and, for each value (ordered: era by `ERA_ORDER`, others by descending count then alpha), a `<label><input type="checkbox" checked={state[dim].includes(value)} onChange={toggle(dim,value)} /> {value} <span class="count">({count})</span></label>`. A value whose count is 0 under current filters renders disabled + greyed (not hidden). Difficulty value for empty string shows as "Unrated". Genre (33 values) starts collapsed to top 10 with a "show more"/"show less" toggle (`useState` boolean).
- Results column `<div class="results">`:
  - Top row: a search `<input type="search" placeholder="search by title or author" aria-label="Search works" value={state.q} onInput=…>` (full width) and a `<select aria-label="Sort">` with options chrono/title/author. On mobile, a "Filters" `<button aria-expanded=…>` appears here to open the drawer.
  - Active-filter chips: for every selected facet value across dims, a `<button class="chip">{value} ✕</button>` that removes it; plus a "Clear all" button when any filter or `q` is set. `aria-live` region.
  - Count line: `<p aria-live="polite">showing {visible.length} of {works.length}</p>`.
  - Grid `<div class="card-grid">` (`display:grid; grid-template-columns: repeat(auto-fit, minmax(240px,1fr)); gap: var(--s-4)`): for each work an `<a class="work-card" href={"/works/" + w.slug + "/"}>` containing `<h3>{w.title}</h3><p class="byline">{w.author}</p><p class="meta">{[w.era, w.language, w.genre].join(" · ")} · {w.total_logical_chapters} ch</p>`. No images.
  - Empty state when `visible.length === 0`: `<p>No works match these filters.</p>` + a "Clear all" button.
- Mobile drawer: when open, a normal-flow overlay (`<div class="drawer-backdrop">` with the facets panel inside; do NOT use `position: fixed` — use a flex overlay container with min-height). Close on Esc (keydown listener), on backdrop click, and on a close button; focus the panel on open; `aria-expanded` on the trigger.

Helpers inside the component:
```tsx
const toggle = (dim: FacetDim, value: string) => () =>
  setState((s) => {
    const has = s[dim].includes(value);
    return { ...s, [dim]: has ? s[dim].filter((v) => v !== value) : [...s[dim], value] };
  });
const clearAll = () => setState((s) => ({ ...emptyState(), sort: s.sort }));
```

Scoped styles: include a `<style>` (or inline) block using token vars only; ensure light/dark/sepia work (use `--ink`, `--ink-muted`, `--paper`, `--rule`, `--accent`). Card hover uses `--accent`. `.count` uses `--ink-muted`, `font-size: var(--fs-byline)`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/site && bunx tsc --noEmit` (or the repo's typecheck script if present)
Expected: no type errors in `WorksBrowser.tsx` / `works-filter.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/islands/WorksBrowser.tsx
git commit -m "feat(site): WorksBrowser island — facet sidebar, search, sort, chips, mobile drawer"
```

---

### Task 3: Rewrite the works page to mount the island

**Files:**
- Modify: `apps/site/src/pages/works/index.astro`

- [ ] **Step 1: Replace the frontmatter data prep + body**

Frontmatter: keep `manifest()`; remove the `byEra`/`eraOrder`/`sortedEras` grouping and the `coversByWork` loop. Build the slim list:

```astro
---
import Base from "../../layouts/Base.astro";
import WorksBrowser from "../../islands/WorksBrowser.tsx";
import { manifest } from "../../lib/corpus";
import type { BrowseWork } from "../../lib/works-filter";

const m = manifest();
const works: BrowseWork[] = m.works.map((w) => ({
  slug: w.slug, title: w.title, author: w.author, author_slug: w.author_slug,
  era: w.era ?? "Unknown", genre: w.genre ?? "Other", language: w.language ?? "Unknown",
  difficulty: w.difficulty ?? "", published_year: w.published_year ?? null,
  total_logical_chapters: w.total_logical_chapters ?? 0,
}));
---
```

Body: header (kicker, H1 "Works", lede), then mount the island hydrated:

```astro
<Base title="Works" description={`Browse all ${m.counts.works} works in the Falsafa catalog.`}>
  <div class="container">
    <header class="page-head">
      <p class="kicker">The library</p>
      <h1>Works</h1>
      <p class="lede">Browse all {m.counts.works} works — filter by era, language, genre and difficulty, or search by title and author.</p>
    </header>
    <WorksBrowser client:load works={works} />
  </div>
</Base>
```

(Keep the existing `.container`/`.page-head`/`.kicker`/`.lede` styles or copy the relevant ones from the old file.)

- [ ] **Step 2: Build to verify it compiles + renders all works**

Run: `cd apps/site && bun run build` (or `bunx astro build`)
Expected: build succeeds; `dist/works/index.html` exists. Grep the built output for a previously-hidden work to confirm the corpus is present:
`grep -l "matthew-prior-poems" dist/works/index.html` (the island serialises `works`, so all slugs appear in the page payload).

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/works/index.astro
git commit -m "feat(site): works page mounts WorksBrowser island; drops era grouping"
```

---

### Task 4: Browser verification + deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Verify in a browser preview** (use the preview tools, not Bash)
  - Start the dev server; open `/works/`.
  - Confirm: the page shows "showing 2017 of 2017"; Greek/Latin/Poetry works are visible; the sidebar facets list Era/Language/Genre/Difficulty with counts.
  - Select Language → Greek + Genre → Poetry; confirm the grid narrows, counts update, chips appear, and the count line updates.
  - Confirm the URL gains `?lang=Greek&genre=Poetry`; reload and confirm the filter persists; back button clears it.
  - Resize to mobile width; confirm the sidebar collapses to a "Filters" button that opens the drawer; apply a filter from it.
  - Toggle dark/sepia themes; confirm readability.
  - Take a screenshot for the user.

- [ ] **Step 2: Deploy**

Run the canonical deploy per `DEPLOY.md` (`bun run deploy` — build + Pagefind index + rclone to R2). This also ships the already-committed era-allowlist bug fix. Confirm `df` free space stays > 400 MB during the build (machine disk is tight).

- [ ] **Step 3: Verify live**
  - Load `https://falsafa.ai/works/`; confirm 2,017 works + filters work.
  - Re-query the MCP `list_works genre=Poetry`; confirm ECPA + Shakespeare now appear (a fresh MCP session may be needed if the old manifest is cached).

---

## Self-review

- **Spec coverage:** layout B + sticky sidebar (Task 2), prominent search + sort + chips + count (Task 2), text-only cards / no images (Task 2 card markup), facets with dynamic counts + OR-within/AND-across (Tasks 1–2), mobile drawer (Task 2), URL state (Tasks 1–2), pure tested module (Task 1), thin Astro shell (Task 3), build/verify/deploy + live MCP check (Task 4). All covered.
- **Placeholders:** none — full code for the module + tests; island specified by contract + key helpers + exact card markup (standard Preact UI the implementer completes against existing island/tokens patterns).
- **Type consistency:** `BrowseWork`/`FilterState`/`FacetDim`/`SortKey`/`emptyState`/`FACET_DIMENSIONS`/`ERA_ORDER` are defined in Task 1 and used identically in Tasks 2–3.
