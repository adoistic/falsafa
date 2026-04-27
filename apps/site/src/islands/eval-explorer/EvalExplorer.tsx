/**
 * EvalExplorer — Preact island for /eval.
 *
 * Loads /eval.json once on mount. Renders a header with headline pass
 * rates per model, a filter bar (category, difficulty, model, pass/fail,
 * free-text search), and a virtualized list of cases. Click a row to
 * expand a per-model panel: answer, tool-call trace, citations with
 * deep-links into the reading site, and the judge's verdict + reasoning.
 *
 * Filter state is mirrored to the URL hash so a filtered view is
 * shareable. No router, no router-shaped abstraction; just window.location.
 *
 * Virtualization uses @tanstack/virtual-core directly (the framework-
 * agnostic layer underneath @tanstack/react-virtual). The Preact-side
 * adapter is `useVirtualizer` below, ~30 lines. We import virtual-core
 * rather than react-virtual because that one pulls react/react-dom and
 * would require enabling Astro's preact compat at the config level —
 * out of scope for this slice.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import type {
  EvalCase,
  EvalCaseResult,
  EvalJson,
  EvalModelMeta,
} from "./types";
import { passOf } from "./types";

interface Props {
  /** Where to fetch the static eval.json from. Defaults to /eval.json. */
  src?: string;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "missing" } // 404 — pre-build state, render the helpful empty.
  | { kind: "error"; message: string }
  | { kind: "ready"; data: EvalJson };

interface FilterState {
  categories: Set<string>;
  difficulties: Set<string>;
  models: Set<string>; // model ids the user wants to see in the verdict pills
  passFilter: "all" | "pass" | "fail" | "mixed";
  query: string;
}

const EMPTY_FILTERS: FilterState = {
  categories: new Set(),
  difficulties: new Set(),
  models: new Set(),
  passFilter: "all",
  query: "",
};

export default function EvalExplorer({ src = "/eval.json" }: Props): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromHash());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setFetchState({ kind: "missing" });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled || !json) return;
        setFetchState({ kind: "ready", data: json as EvalJson });
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Default the model filter to "all models on" once data lands.
  useEffect(() => {
    if (fetchState.kind === "ready" && filters.models.size === 0) {
      setFilters((f) => ({
        ...f,
        models: new Set(fetchState.data.models.map((m) => m.id)),
      }));
    }
  }, [fetchState.kind]);

  // Mirror filters to the URL hash so a filtered view is shareable.
  useEffect(() => {
    if (fetchState.kind !== "ready") return;
    writeFiltersToHash(filters, fetchState.data);
  }, [filters, fetchState.kind]);

  if (fetchState.kind === "loading") {
    return (
      <div class="eval-explorer eval-state">
        <div class="eval-spinner" aria-hidden="true" />
        <p>Loading eval data…</p>
      </div>
    );
  }

  if (fetchState.kind === "missing") {
    return (
      <div class="eval-explorer eval-state">
        <p class="eval-state-title">Eval data not yet generated.</p>
        <p class="eval-state-help">
          Run <code>bun run eval/build-eval-json.ts</code> from the repo root to
          produce <code>apps/site/public/eval.json</code>, then reload this
          page.
        </p>
      </div>
    );
  }

  if (fetchState.kind === "error") {
    return (
      <div class="eval-explorer eval-state">
        <p class="eval-state-title">Couldn't load eval data.</p>
        <p class="eval-state-help">{fetchState.message}</p>
      </div>
    );
  }

  return (
    <Loaded
      data={fetchState.data}
      filters={filters}
      setFilters={setFilters}
      expandedId={expandedId}
      setExpandedId={setExpandedId}
    />
  );
}

/* ── Loaded view ─────────────────────────────────────────────────────── */

function Loaded({
  data,
  filters,
  setFilters,
  expandedId,
  setExpandedId,
}: {
  data: EvalJson;
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}): JSX.Element {
  // Catalogues for the filter chips.
  const allCategories = useMemo(
    () => Array.from(new Set(data.cases.map((c) => c.category))).sort(),
    [data],
  );
  const allDifficulties = useMemo(
    () => Array.from(new Set(data.cases.map((c) => c.difficulty))).sort(),
    [data],
  );

  // Filter pipeline. Pass/fail derived from the union of selected models.
  const filteredCases = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return data.cases.filter((c) => {
      if (filters.categories.size > 0 && !filters.categories.has(c.category)) {
        return false;
      }
      if (
        filters.difficulties.size > 0 &&
        !filters.difficulties.has(c.difficulty)
      ) {
        return false;
      }
      if (q && !c.prompt.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) {
        return false;
      }
      if (filters.passFilter !== "all") {
        const verdicts = Array.from(filters.models)
          .map((mid) => passOf(c.results[mid]))
          .filter((v): v is boolean => v !== null);
        if (verdicts.length === 0) return filters.passFilter === "all";
        const allPass = verdicts.every((v) => v);
        const allFail = verdicts.every((v) => !v);
        if (filters.passFilter === "pass" && !allPass) return false;
        if (filters.passFilter === "fail" && !allFail) return false;
        if (filters.passFilter === "mixed" && (allPass || allFail)) return false;
      }
      return true;
    });
  }, [data, filters]);

  // Headline pass rates per model (over the *unfiltered* full set so the
  // numbers stay stable while the user fiddles with filters).
  const headline = useMemo(() => {
    return data.models.map((m) => {
      let pass = 0;
      let total = 0;
      for (const c of data.cases) {
        const v = passOf(c.results[m.id]);
        if (v === null) continue;
        total++;
        if (v) pass++;
      }
      return { ...m, pass_count: pass, case_count: total };
    });
  }, [data]);

  return (
    <div class="eval-explorer">
      <Header
        totalCases={data.cases.length}
        models={headline}
        generatedAt={data.generated_at}
      />
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        categories={allCategories}
        difficulties={allDifficulties}
        models={data.models}
        filteredCount={filteredCases.length}
        totalCount={data.cases.length}
      />
      <CaseList
        cases={filteredCases}
        models={data.models}
        activeModelIds={filters.models}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
      />
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────────────── */

function Header({
  totalCases,
  models,
  generatedAt,
}: {
  totalCases: number;
  models: Array<EvalModelMeta>;
  generatedAt: string;
}): JSX.Element {
  return (
    <header class="eval-header">
      <div class="eval-header-stat">
        <span class="eval-header-num">{totalCases.toLocaleString()}</span>
        <span class="eval-header-label">cases</span>
      </div>
      {models.map((m) => {
        const total = m.case_count ?? 0;
        const pass = m.pass_count ?? 0;
        const pct = total > 0 ? Math.round((pass / total) * 100) : null;
        return (
          <div class="eval-header-stat" key={m.id}>
            <span class="eval-header-num">
              {pct === null ? "—" : `${pct}%`}
            </span>
            <span class="eval-header-label">
              {m.name} <span class="eval-header-frac">({pass}/{total})</span>
            </span>
          </div>
        );
      })}
      <div class="eval-header-meta">
        Generated {formatTimestamp(generatedAt)}
      </div>
    </header>
  );
}

/* ── Filter bar ──────────────────────────────────────────────────────── */

function FilterBar({
  filters,
  setFilters,
  categories,
  difficulties,
  models,
  filteredCount,
  totalCount,
}: {
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  categories: string[];
  difficulties: string[];
  models: EvalModelMeta[];
  filteredCount: number;
  totalCount: number;
}): JSX.Element {
  function toggle(key: "categories" | "difficulties" | "models", value: string) {
    setFilters((prev) => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }

  function clearAll() {
    setFilters((prev) => ({
      ...prev,
      categories: new Set(),
      difficulties: new Set(),
      models: new Set(models.map((m) => m.id)),
      passFilter: "all",
      query: "",
    }));
  }

  return (
    <section class="eval-filters" aria-label="Filter cases">
      <div class="eval-filter-row">
        <label class="eval-filter-search">
          <span class="eval-filter-label">Search</span>
          <input
            type="search"
            value={filters.query}
            placeholder="prompt or case id…"
            onInput={(e) =>
              setFilters((p) => ({
                ...p,
                query: (e.currentTarget as HTMLInputElement).value,
              }))
            }
            class="eval-filter-input"
          />
        </label>
        <div class="eval-filter-pass" role="radiogroup" aria-label="Verdict">
          {(["all", "pass", "fail", "mixed"] as const).map((opt) => (
            <button
              type="button"
              key={opt}
              role="radio"
              aria-checked={filters.passFilter === opt}
              class={
                "eval-pill " +
                (filters.passFilter === opt ? "is-active" : "")
              }
              onClick={() =>
                setFilters((p) => ({ ...p, passFilter: opt }))
              }
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <FilterChipGroup
        legend="Category"
        items={categories}
        selected={filters.categories}
        onToggle={(v) => toggle("categories", v)}
      />
      <FilterChipGroup
        legend="Difficulty"
        items={difficulties}
        selected={filters.difficulties}
        onToggle={(v) => toggle("difficulties", v)}
      />
      <FilterChipGroup
        legend="Model"
        items={models.map((m) => m.id)}
        labels={Object.fromEntries(models.map((m) => [m.id, m.name]))}
        selected={filters.models}
        onToggle={(v) => toggle("models", v)}
      />

      <div class="eval-filter-summary">
        <span>
          Showing <strong>{filteredCount.toLocaleString()}</strong> of{" "}
          {totalCount.toLocaleString()} cases
        </span>
        <button type="button" class="eval-filter-clear" onClick={clearAll}>
          Reset filters
        </button>
      </div>
    </section>
  );
}

function FilterChipGroup({
  legend,
  items,
  labels,
  selected,
  onToggle,
}: {
  legend: string;
  items: string[];
  labels?: Record<string, string>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}): JSX.Element {
  return (
    <fieldset class="eval-chip-group">
      <legend class="eval-filter-label">{legend}</legend>
      <div class="eval-chip-row">
        {items.map((item) => {
          const active = selected.has(item);
          return (
            <button
              type="button"
              key={item}
              class={"eval-chip " + (active ? "is-active" : "")}
              aria-pressed={active}
              onClick={() => onToggle(item)}
            >
              {labels?.[item] ?? item}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ── Case list (virtualized) ─────────────────────────────────────────── */

const ROW_HEIGHT = 64;
const EXPANDED_EXTRA = 0; // dynamic size; the virtualizer measures the row.

function CaseList({
  cases,
  models,
  activeModelIds,
  expandedId,
  setExpandedId,
}: {
  cases: EvalCase[];
  models: EvalModelMeta[];
  activeModelIds: Set<string>;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}): JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const visibleModels = models.filter((m) => activeModelIds.has(m.id));

  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) =>
      cases[i]?.id === expandedId ? ROW_HEIGHT + 360 + EXPANDED_EXTRA : ROW_HEIGHT,
    overscan: 6,
    getItemKey: (i) => cases[i]?.id ?? i,
  });

  // When the expanded row changes, re-measure so the virtualizer recomputes
  // the total scroll height. Without this the page below the expanded row
  // can briefly clip.
  useEffect(() => {
    virtualizer.measure();
  }, [expandedId, activeModelIds.size, virtualizer]);

  if (cases.length === 0) {
    return (
      <div class="eval-empty">
        No cases match these filters. Try clearing one.
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();

  return (
    <div class="eval-list-wrap" ref={parentRef}>
      <div
        class="eval-list-inner"
        style={{ height: `${total}px`, position: "relative" }}
      >
        {items.map((item) => {
          const c = cases[item.index];
          if (!c) return null;
          const isExpanded = expandedId === c.id;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              <CaseRow
                c={c}
                models={visibleModels}
                expanded={isExpanded}
                onToggle={() => setExpandedId(isExpanded ? null : c.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CaseRow({
  c,
  models,
  expanded,
  onToggle,
}: {
  c: EvalCase;
  models: EvalModelMeta[];
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <article class={"eval-case " + (expanded ? "is-expanded" : "")}>
      <button
        type="button"
        class="eval-case-summary"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <div class="eval-case-meta">
          <span class="eval-case-id">{c.id}</span>
          <span class="eval-case-cat">{c.category}</span>
          <span class={"eval-case-diff diff-" + slugify(c.difficulty)}>
            {c.difficulty}
          </span>
        </div>
        <div class="eval-case-prompt">{c.prompt}</div>
        <div class="eval-case-verdicts" aria-label="Per-model verdicts">
          {models.map((m) => {
            const v = passOf(c.results[m.id]);
            const cls =
              v === null ? "verdict-na" : v ? "verdict-pass" : "verdict-fail";
            const glyph = v === null ? "·" : v ? "✓" : "✗";
            return (
              <span class={"eval-verdict " + cls} title={`${m.name}: ${v === null ? "no run" : v ? "pass" : "fail"}`} key={m.id}>
                <span class="eval-verdict-label">{m.label}</span>
                <span class="eval-verdict-glyph" aria-hidden="true">{glyph}</span>
              </span>
            );
          })}
        </div>
      </button>
      {expanded && <CasePanel c={c} models={models} />}
    </article>
  );
}

function CasePanel({
  c,
  models,
}: {
  c: EvalCase;
  models: EvalModelMeta[];
}): JSX.Element {
  return (
    <div class="eval-case-panel">
      <div class="eval-case-question">
        <p class="eval-case-question-label">Prompt</p>
        <p class="eval-case-question-body">{c.prompt}</p>
        {c.rationale && (
          <p class="eval-case-rationale">
            <em>Why this case:</em> {c.rationale}
          </p>
        )}
        {c.expected_works.length > 0 && (
          <p class="eval-case-expected">
            <span class="eval-case-expected-label">Expected works:</span>{" "}
            {c.expected_works.map((slug, i) => (
              <span key={slug}>
                {i > 0 && ", "}
                <a href={`/works/${slug}/`} class="eval-link-mono">{slug}</a>
              </span>
            ))}
          </p>
        )}
      </div>
      <div class="eval-case-models">
        {models.map((m) => {
          const r = c.results[m.id];
          if (!r) {
            return (
              <section class="eval-model-card eval-model-card-empty" key={m.id}>
                <header class="eval-model-head">
                  <span class="eval-model-name">{m.name}</span>
                  <span class="eval-model-na">No run</span>
                </header>
              </section>
            );
          }
          return <ModelCard m={m} r={r} key={m.id} />;
        })}
      </div>
    </div>
  );
}

function ModelCard({
  m,
  r,
}: {
  m: EvalModelMeta;
  r: EvalCaseResult;
}): JSX.Element {
  const v = passOf(r);
  const verdictClass =
    v === null ? "verdict-na" : v ? "verdict-pass" : "verdict-fail";
  return (
    <section class="eval-model-card">
      <header class="eval-model-head">
        <span class="eval-model-name">{m.name}</span>
        <span class={"eval-verdict " + verdictClass}>
          {v === null ? "no judge" : v ? "✓ pass" : "✗ fail"}
        </span>
        {r.duration_ms > 0 && (
          <span class="eval-model-dur">{(r.duration_ms / 1000).toFixed(1)}s</span>
        )}
      </header>

      <details class="eval-section" open>
        <summary>Answer</summary>
        <pre class="eval-answer">{r.answer}</pre>
      </details>

      {r.tool_calls.length > 0 && (
        <details class="eval-section">
          <summary>Tool calls ({r.tool_calls.length})</summary>
          <ol class="eval-tool-trace">
            {r.tool_calls.map((tc, i) => (
              <li key={i}>
                <code class="eval-tool-name">{tc.name}</code>
                <code class="eval-tool-args">{stringifyArgs(tc.args)}</code>
                {tc.result_summary && (
                  <span class="eval-tool-summary">{tc.result_summary}</span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      {r.citations.length > 0 && (
        <details class="eval-section">
          <summary>Citations ({r.citations.length})</summary>
          <ul class="eval-citation-list">
            {r.citations.map((cit, i) => (
              <li key={i}>
                <a
                  href={citationLink(cit)}
                  class="eval-link-mono"
                  target="_blank"
                  rel="noopener"
                >
                  {cit.work_slug}
                  {cit.chapter_number != null && ` · ch. ${cit.chapter_number}`}
                  {cit.paragraph_id && ` · ${cit.paragraph_id}`}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.judge && (
        <details class="eval-section eval-judge" open>
          <summary>
            Judge ({r.judge.judge_model}) ·{" "}
            <span class={verdictClass}>
              factual:{r.judge.factual_correct ? "y" : "n"} · cite:
              {r.judge.citation_backed ? "y" : "n"} · halluc:
              {r.judge.hallucinated ? "y" : "n"} · prose:
              {r.judge.naturalness_1to5}/5
            </span>
          </summary>
          <p class="eval-judge-reasoning">{r.judge.reasoning}</p>
        </details>
      )}
    </section>
  );
}

/* ── Hash sync ───────────────────────────────────────────────────────── */

function readFiltersFromHash(): FilterState {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return EMPTY_FILTERS;
  const params = new URLSearchParams(hash);
  const get = (k: string) => params.get(k) ?? "";
  const split = (s: string) =>
    new Set(s.split(",").map((x) => x.trim()).filter(Boolean));
  const passRaw = get("pass");
  const passFilter: FilterState["passFilter"] =
    passRaw === "pass" || passRaw === "fail" || passRaw === "mixed"
      ? passRaw
      : "all";
  return {
    categories: split(get("cat")),
    difficulties: split(get("diff")),
    models: split(get("models")),
    passFilter,
    query: get("q"),
  };
}

function writeFiltersToHash(f: FilterState, data: EvalJson): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (f.categories.size > 0) params.set("cat", [...f.categories].join(","));
  if (f.difficulties.size > 0) params.set("diff", [...f.difficulties].join(","));
  // Only serialise model filter when it deviates from "all selected".
  if (f.models.size > 0 && f.models.size !== data.models.length) {
    params.set("models", [...f.models].join(","));
  }
  if (f.passFilter !== "all") params.set("pass", f.passFilter);
  if (f.query.trim()) params.set("q", f.query.trim());
  const next = params.toString();
  const target = next ? `#${next}` : "";
  // Avoid pushing empty history entries on every keystroke.
  if (window.location.hash !== target) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${target}`);
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function stringifyArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return String(args);
  }
}

function citationLink(c: { work_slug: string; chapter_number?: number; paragraph_id?: string }): string {
  let url = `/works/${c.work_slug}/`;
  if (c.chapter_number != null) url += `chapters/${c.chapter_number}/`;
  if (c.paragraph_id) url += `#${c.paragraph_id}`;
  return url;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/* ── Preact-side useVirtualizer adapter ──────────────────────────────── *
 *
 * @tanstack/react-virtual imports from "react" + "react-dom", which would
 * require enabling Astro's Preact compat alias. astro.config.mjs is out
 * of scope for this slice, so we wire the framework-agnostic core to
 * Preact hooks directly. Same Virtualizer instance, ~30 lines of glue.
 */

interface VirtualizerOpts {
  count: number;
  getScrollElement: () => HTMLElement | null;
  estimateSize: (index: number) => number;
  overscan?: number;
  getItemKey?: (index: number) => string | number;
}

function useVirtualizer(opts: VirtualizerOpts) {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  const instanceRef = useRef<Virtualizer<HTMLElement, Element> | null>(null);

  if (instanceRef.current === null) {
    instanceRef.current = new Virtualizer<HTMLElement, Element>({
      count: opts.count,
      getScrollElement: opts.getScrollElement,
      estimateSize: opts.estimateSize,
      overscan: opts.overscan ?? 4,
      getItemKey: opts.getItemKey,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: () => forceRender(),
    });
  } else {
    instanceRef.current.setOptions({
      ...instanceRef.current.options,
      count: opts.count,
      getScrollElement: opts.getScrollElement,
      estimateSize: opts.estimateSize,
      overscan: opts.overscan ?? 4,
      getItemKey: opts.getItemKey,
      onChange: () => forceRender(),
    });
  }

  // Mount lifecycle. The core exposes private-by-convention _didMount /
  // _willUpdate hooks that react-virtual calls inside layout effects.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    return inst._didMount();
  }, []);

  useEffect(() => {
    instanceRef.current?._willUpdate();
  });

  return instanceRef.current!;
}
