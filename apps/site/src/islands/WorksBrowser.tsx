/**
 * WorksBrowser — Preact island for /works/.
 *
 * Owns all filter/sort/search interactivity. Receives the full corpus as
 * props (static, passed from the Astro page at build time). Delegates all
 * filtering logic to works-filter.ts; this file is UI only.
 *
 * State is mirrored to the URL via history.replaceState so filtered views
 * are shareable and the browser back/forward buttons restore filters.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  FACET_DIMENSIONS,
  ERA_ORDER,
  emptyState,
  filterWorks,
  facetCounts,
  sortWorks,
  parseFilterState,
  serializeFilterState,
} from "../lib/works-filter";
import type { BrowseWork, FacetDim, FilterState } from "../lib/works-filter";

interface Props {
  works: BrowseWork[];
}

const DIM_LABELS: Record<FacetDim, string> = {
  era: "Era",
  language: "Language",
  genre: "Genre",
  difficulty: "Difficulty",
};

const GENRE_COLLAPSE_AT = 10;

/** Sort values for a facet dimension. Era uses ERA_ORDER; others sort by
 *  descending count, then alphabetically. */
function sortedValues(
  dim: FacetDim,
  counts: Map<string, number>,
  allValues: string[]
): string[] {
  if (dim === "era") {
    const inOrder = ERA_ORDER.filter((v) => allValues.includes(v));
    const extra = allValues.filter((v) => !ERA_ORDER.includes(v)).sort();
    return [...inOrder, ...extra];
  }
  return allValues.slice().sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });
}

/** Collect all unique values for each dimension from the full corpus. */
function allValuesFor(dim: FacetDim, works: BrowseWork[]): string[] {
  const seen = new Set<string>();
  for (const w of works) seen.add(w[dim]);
  return [...seen];
}

/** Display label for a facet value (empty difficulty string → "Unrated"). */
function displayValue(dim: FacetDim, val: string): string {
  if (dim === "difficulty" && val === "") return "Unrated";
  return val;
}

export default function WorksBrowser({ works }: Props): JSX.Element {
  const [state, setState] = useState<FilterState>(emptyState);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [genreExpanded, setGenreExpanded] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);

  // On mount: sync state from URL.
  useEffect(() => {
    setState(parseFilterState(new URLSearchParams(location.search)));

    const onPopState = () => {
      setState(parseFilterState(new URLSearchParams(location.search)));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // On any state change: write URL.
  useEffect(() => {
    const qs = serializeFilterState(state);
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }, [state]);

  // Close drawer on Esc.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Focus panel when drawer opens.
  useEffect(() => {
    if (drawerOpen && drawerPanelRef.current) {
      drawerPanelRef.current.focus();
    }
  }, [drawerOpen]);

  // Derived state.
  const visible = sortWorks(filterWorks(works, state), state.sort);
  const counts: Record<FacetDim, Map<string, number>> = {
    era: facetCounts(works, state, "era"),
    language: facetCounts(works, state, "language"),
    genre: facetCounts(works, state, "genre"),
    difficulty: facetCounts(works, state, "difficulty"),
  };
  const allValues: Record<FacetDim, string[]> = {
    era: allValuesFor("era", works),
    language: allValuesFor("language", works),
    genre: allValuesFor("genre", works),
    difficulty: allValuesFor("difficulty", works),
  };

  const hasActiveFilters =
    state.q !== "" ||
    FACET_DIMENSIONS.some((d) => state[d].length > 0);

  // Helpers.
  const toggle = (dim: FacetDim, value: string) => () =>
    setState((s) => {
      const has = s[dim].includes(value);
      return {
        ...s,
        [dim]: has ? s[dim].filter((v) => v !== value) : [...s[dim], value],
      };
    });

  const clearAll = () => setState((s) => ({ ...emptyState(), sort: s.sort }));

  const removeChip = (dim: FacetDim, value: string) => () =>
    setState((s) => ({ ...s, [dim]: s[dim].filter((v) => v !== value) }));

  // Render the facet groups (shared between sidebar and drawer).
  const facetsContent = (
    <div class="facets-inner">
      {FACET_DIMENSIONS.map((dim) => {
        const dimCounts = counts[dim];
        const values = sortedValues(dim, dimCounts, allValues[dim]);
        const isGenre = dim === "genre";
        const displayValues =
          isGenre && !genreExpanded ? values.slice(0, GENRE_COLLAPSE_AT) : values;

        return (
          <fieldset key={dim} class="facet-group">
            <legend class="facet-legend">{DIM_LABELS[dim]}</legend>
            <ul class="facet-list">
              {displayValues.map((val) => {
                const count = dimCounts.get(val) ?? 0;
                const checked = state[dim].includes(val);
                const disabled = count === 0 && !checked;
                const id = `facet-${dim}-${val.replace(/\s+/g, "-")}`;
                return (
                  <li key={val} class={disabled ? "facet-item facet-item--zero" : "facet-item"}>
                    <label class="facet-label" for={id}>
                      <input
                        type="checkbox"
                        id={id}
                        checked={checked}
                        disabled={disabled}
                        onChange={toggle(dim, val)}
                        class="facet-checkbox"
                      />
                      <span class="facet-value">{displayValue(dim, val)}</span>
                      <span class="facet-count">({count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {isGenre && values.length > GENRE_COLLAPSE_AT && (
              <button
                type="button"
                class="show-more-btn"
                onClick={() => setGenreExpanded((v) => !v)}
              >
                {genreExpanded ? "Show less" : `Show ${values.length - GENRE_COLLAPSE_AT} more`}
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );

  return (
    <div class="browse">
      {/* ── Mobile drawer backdrop ──────────────────────────────────────── */}
      {drawerOpen && (
        <div
          class="drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <div
            class="drawer-panel"
            ref={drawerPanelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
          >
            <div class="drawer-header">
              <span class="drawer-title">Filters</span>
              <button
                type="button"
                class="drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>
            {facetsContent}
          </div>
        </div>
      )}

      {/* ── Sticky left sidebar (desktop only) ─────────────────────────── */}
      <aside class="facets-sidebar" aria-label="Filter works">
        {facetsContent}
      </aside>

      {/* ── Results column ──────────────────────────────────────────────── */}
      <div class="results">
        {/* Top controls row */}
        <div class="controls-row">
          <input
            type="search"
            class="search-input"
            placeholder="Search by title or author"
            aria-label="Search works"
            value={state.q}
            onInput={(e) =>
              setState((s) => ({
                ...s,
                q: (e.target as HTMLInputElement).value,
              }))
            }
          />
          <select
            class="sort-select"
            aria-label="Sort"
            value={state.sort}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                sort: (e.target as HTMLSelectElement).value as FilterState["sort"],
              }))
            }
          >
            <option value="chrono">Chronological</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
          </select>
          {/* Mobile filters button */}
          <button
            type="button"
            class="filters-btn"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            Filters
          </button>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div class="chips-row" aria-live="polite" aria-label="Active filters">
            {FACET_DIMENSIONS.flatMap((dim) =>
              state[dim].map((val) => (
                <button
                  key={`${dim}:${val}`}
                  type="button"
                  class="chip"
                  onClick={removeChip(dim, val)}
                  aria-label={`Remove filter ${displayValue(dim, val)}`}
                >
                  {displayValue(dim, val)} ✕
                </button>
              ))
            )}
            <button type="button" class="chip chip--clear" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}

        {/* Result count */}
        <p class="result-count" aria-live="polite">
          Showing {visible.length} of {works.length}
        </p>

        {/* Card grid */}
        {visible.length > 0 ? (
          <div class="card-grid">
            {visible.map((w) => (
              <a key={w.slug} class="work-card" href={`/works/${w.slug}/`}>
                <h3 class="card-title">{w.title}</h3>
                <p class="card-byline">{w.author}</p>
                <p class="card-meta">
                  {[w.era, w.language, w.genre].join(" · ")} · {w.total_logical_chapters} ch
                </p>
              </a>
            ))}
          </div>
        ) : (
          <div class="empty-state">
            <p>No works match these filters.</p>
            <button type="button" class="chip chip--clear" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}
      </div>

      <style>{`
        .browse {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: var(--s-8);
          align-items: start;
        }

        /* ── Sidebar ─────────────────────────────────────────────── */
        .facets-sidebar {
          position: sticky;
          top: var(--s-20, 80px);
          align-self: start;
          max-height: calc(100vh - var(--s-24));
          overflow-y: auto;
          padding-right: var(--s-2);
        }

        .facet-group {
          border: none;
          margin: 0 0 var(--s-6);
          padding: 0;
        }

        .facet-legend {
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ink-muted);
          margin-bottom: var(--s-2);
          padding: 0;
        }

        .facet-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .facet-item {
          margin-bottom: var(--s-1);
        }

        .facet-item--zero {
          opacity: 0.4;
        }

        .facet-label {
          display: flex;
          align-items: center;
          gap: var(--s-2);
          cursor: pointer;
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          color: var(--ink);
          line-height: 1.4;
        }

        .facet-item--zero .facet-label {
          cursor: default;
          color: var(--ink-muted);
        }

        .facet-checkbox {
          flex-shrink: 0;
          accent-color: var(--accent);
        }

        .facet-value {
          flex: 1;
        }

        .facet-count {
          font-size: var(--fs-byline);
          color: var(--ink-muted);
          font-family: var(--font-sans);
        }

        .show-more-btn {
          background: none;
          border: none;
          padding: var(--s-1) 0;
          font-family: var(--font-sans);
          font-size: var(--fs-byline);
          color: var(--accent);
          cursor: pointer;
          text-decoration: underline;
        }

        .show-more-btn:hover {
          color: var(--accent-soft);
        }

        /* ── Results column ──────────────────────────────────────── */
        .results {
          min-width: 0;
        }

        .controls-row {
          display: flex;
          gap: var(--s-3);
          margin-bottom: var(--s-4);
          align-items: center;
        }

        .search-input {
          flex: 1;
          padding: var(--s-2) var(--s-3);
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          border-radius: 4px;
          outline: none;
        }

        .search-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
        }

        .sort-select {
          padding: var(--s-2) var(--s-3);
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
        }

        .filters-btn {
          display: none;
          padding: var(--s-2) var(--s-4);
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
        }

        /* ── Chips ───────────────────────────────────────────────── */
        .chips-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--s-2);
          margin-bottom: var(--s-3);
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: var(--s-1);
          padding: var(--s-1) var(--s-3);
          font-family: var(--font-sans);
          font-size: var(--fs-byline);
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          border-radius: 100px;
          cursor: pointer;
          transition: border-color 0.15s;
        }

        .chip:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        .chip--clear {
          background: var(--accent);
          color: var(--paper);
          border-color: var(--accent);
          font-weight: 600;
        }

        .chip--clear:hover {
          background: var(--accent-soft);
          border-color: var(--accent-soft);
          color: var(--paper);
        }

        /* ── Result count ────────────────────────────────────────── */
        .result-count {
          font-family: var(--font-sans);
          font-size: var(--fs-byline);
          color: var(--ink-muted);
          margin: 0 0 var(--s-4);
        }

        /* ── Card grid ───────────────────────────────────────────── */
        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: var(--s-4);
        }

        .work-card {
          display: block;
          padding: var(--s-4);
          border: 1px solid var(--rule);
          color: var(--ink);
          text-decoration: none;
          border-radius: 4px;
          transition: border-color 0.15s, transform 0.15s;
        }

        .work-card:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
        }

        .card-title {
          font-family: var(--font-display);
          font-size: var(--fs-h3);
          font-weight: 600;
          margin: 0 0 var(--s-1);
          line-height: 1.3;
          color: var(--ink);
        }

        .work-card:hover .card-title {
          color: var(--accent);
        }

        .card-byline {
          font-family: var(--font-display);
          font-style: italic;
          font-size: var(--fs-chrome);
          color: var(--ink-muted);
          margin: 0 0 var(--s-2);
        }

        .card-meta {
          font-family: var(--font-sans);
          font-size: var(--fs-byline);
          color: var(--ink-muted);
          margin: 0;
        }

        /* ── Empty state ─────────────────────────────────────────── */
        .empty-state {
          padding: var(--s-16) var(--s-8);
          text-align: center;
          color: var(--ink-muted);
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--s-4);
        }

        /* ── Mobile drawer backdrop ──────────────────────────────── */
        .drawer-backdrop {
          position: fixed;
          inset: 0;
          background: color-mix(in srgb, var(--ink) 40%, transparent);
          z-index: 100;
          display: flex;
          align-items: stretch;
        }

        .drawer-panel {
          width: min(320px, 85vw);
          background: var(--paper);
          overflow-y: auto;
          padding: var(--s-6);
          outline: none;
        }

        .drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--s-6);
        }

        .drawer-title {
          font-family: var(--font-sans);
          font-size: var(--fs-chrome);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--ink);
        }

        .drawer-close {
          background: none;
          border: none;
          font-size: var(--fs-chrome);
          color: var(--ink-muted);
          cursor: pointer;
          padding: var(--s-1);
          line-height: 1;
        }

        .drawer-close:hover {
          color: var(--ink);
        }

        /* ── Mobile breakpoint ───────────────────────────────────── */
        @media (max-width: 880px) {
          .browse {
            grid-template-columns: 1fr;
          }

          .facets-sidebar {
            display: none;
          }

          .filters-btn {
            display: block;
          }

          .card-grid {
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          }
        }

        @media (max-width: 480px) {
          .card-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
