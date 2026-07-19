# Works Browse Page Redesign — Design Spec

**Date:** 2026-06-29 · **Author:** Adnan · **Status:** approved, pending spec review

## Goal

Replace the `/works/` browse page with a filterable, searchable catalog that exposes the **entire** corpus (now 2,017 works) and scales to many more filters once the ontology lands. The current page hides ~70% of works and offers no on-page filtering or search.

## Context / current state

- Page: `apps/site/src/pages/works/index.astro` → renders `components/WorkCardGrid.astro`; data from `lib/corpus.ts` `manifest()` (reads `corpus/manifest.json` at build time).
- **Bug already fixed** (commit on this branch): the page grouped by a hardcoded 7-era allowlist and silently dropped the other 5 eras (1,405 works, incl. ~all Greek/Latin and all Poetry). Fixed to list all eras + append any unlisted era. This redesign supersedes that era-grouped layout entirely.
- Available per-work metadata in the manifest: `slug, title, author, author_slug, era, era_slug, genre, genre_slug, language, language_slug, language_direction, difficulty, published_year, total_logical_chapters, description, thothica_role`.
- Filter cardinalities: era 12, language 9, genre 33, difficulty 4 (+null).
- Search: Pagefind is already integrated as a global ⌘K full-text modal (`components/SearchDialog.astro`). It stays as-is and is **out of scope** here.
- Stack: Astro static + Preact islands (`src/islands/*.tsx`); scoped CSS; design tokens in `src/styles/tokens.css`; light/dark/sepia themes.

## Decisions (approved)

1. **Layout B — left facet sidebar + results.** Two columns in the existing 1240px container: a left facet sidebar (~240px, `position: sticky` under the header) and a results column.
2. **Prominent search bar** spanning the top of the results column (title + author, instant client-side substring filter).
3. **NO cover images on this page.** Text-only cards. Cover images are reserved for the featured work on the home page. (This removes all image-loading/perf concerns.)
4. **Active-filter chips** row above results ("Greek ✕", "Poetry ✕", … "Clear all") + a live **"showing N of 2,017"** count.
5. **Facets:** Era, Language, Genre, Difficulty. Each value shows a **live count** reflecting the current filter set (faceted-search behaviour). Multi-select **within** a facet = OR; **across** facets = AND. Long facets (Genre, 33) get a "show more" expander.
6. **Sort** control: chronological (default), title A–Z, author A–Z.
7. **Mobile:** sidebar collapses into a sticky "Filters" button that opens an off-canvas drawer with the same facets; search stays at top; grid drops to 1–2 columns; chips remain visible.
8. **URL-encoded filter state** (query params) so filtered views are shareable and back/forward works.

## Architecture

A single Preact island owns all interactivity; the Astro page is a thin shell.

- **`apps/site/src/lib/works-filter.ts`** — pure, dependency-free logic + types. No DOM. Unit-tested.
  - `type BrowseWork = { slug; title; author; author_slug; era; genre; language; difficulty; published_year; total_logical_chapters }` (slim record — no description/covers).
  - `type FilterState = { q: string; era: string[]; language: string[]; genre: string[]; difficulty: string[]; sort: "chrono"|"title"|"author" }`.
  - `filterWorks(works, state): BrowseWork[]` — applies search (case-insensitive substring on title+author) + AND-across/OR-within facets.
  - `facetCounts(works, state, dimension): Map<value, count>` — counts per value of `dimension` against all OTHER active facets + the search term (so counts reflect what a click would yield).
  - `sortWorks(works, sort): BrowseWork[]` — chrono = `published_year` asc with nulls last, tiebreak by era chronological index then title; title/author = locale A–Z.
  - `parseFilterState(searchParams): FilterState` and `serializeFilterState(state): string` — URL <-> state, round-trippable, empty dims omitted.
- **`apps/site/src/islands/WorksBrowser.tsx`** — Preact island. Props: `works: BrowseWork[]` (whole corpus) + facet definitions. Holds `FilterState`; on mount reads `location.search` via `parseFilterState`; on change updates state, writes URL via `history.replaceState(serializeFilterState(...))`, and listens to `popstate`. Renders: sidebar facet groups (checkbox + label + count), search input, sort `<select>`, active-filter chips, result count, results grid of text cards, empty state, and the mobile drawer + "Filters" button.
- **`apps/site/src/pages/works/index.astro`** — builds the slim `BrowseWork[]` from `manifest()`, derives the facet value lists, and renders `<WorksBrowser client:load works={...} />`. Removes the era-grouping code and the cover pre-resolution loop.

## Components / behaviour detail

- **Text card:** title (display serif), author (italic), a muted meta line "Era · Language · Genre · N chapters". Whole card is an `<a href="/works/<slug>/">`. Reuses tokens; matches site type scale. Responsive grid `repeat(auto-fit, minmax(240px, 1fr))`.
- **Sidebar:** sticky, `top` = header height, own `max-height: calc(100vh - header)` with internal `overflow:auto` for long facet lists. Each group: heading + list of `<label><input type=checkbox> value <span class=count>(n)</span></label>`. Difficulty shows "Unrated" for null.
- **Counts:** dynamic (computed by `facetCounts`); a value showing `(0)` under the current filters is disabled/greyed, not hidden (so the taxonomy stays legible).
- **Empty state:** "No works match these filters." + a "Clear all" button.
- **Performance:** text-only, so all 2,017 cards can render and filter in-memory with no virtualization needed. If a future profile shows jank, add a simple `+ show more` cap at N — noted, not built now.

## Accessibility

- Facets are real `<input type="checkbox">` with associated `<label>`; search input has a visible/`aria` label; sort is a labelled `<select>`.
- Mobile drawer: focus-trapped while open, closes on Esc and on backdrop click, "Filters" button has `aria-expanded`.
- Result count uses `aria-live="polite"` so filtering is announced.

## Testing

- `apps/site/src/lib/works-filter.test.ts` (bun test, run from the file's dir per the repo's EMFILE convention): unit tests for `filterWorks` (AND/OR semantics, search), `facetCounts` (reflects other facets), `sortWorks` (nulls-last chrono, tiebreaks), and `parseFilterState`/`serializeFilterState` round-trip.
- Manual browser verification of the rendered page (desktop sticky sidebar, mobile drawer, URL sharing, all 2,017 visible with no filters) before deploy.

## Out of scope

- Ontology-derived facets (Theme, Concept, Figure, …) — added later once the ontology run produces them; the sidebar is built to accept new groups with no layout change.
- Full-text in-text search — stays in the existing ⌘K Pagefind modal.
- Cover images anywhere on this page (home-page featured work keeps its image).
- Author pages / hover-cards (separate future work).

## Deployment

After implementation + browser verification, deploy via `DEPLOY.md` (`bun run deploy` — build + Pagefind index + rclone to R2). This also carries the already-committed era-allowlist bug fix.
