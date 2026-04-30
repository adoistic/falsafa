/**
 * EvalExplorer — Preact island for /eval.
 *
 * Loads /eval-index.json once on mount. Renders a header with headline
 * pass rates, a filter bar (category, difficulty, pass/fail, free-text
 * search), and a flat list of cases. Each row is an anchor to the
 * per-case page at /eval/<id>/.
 *
 * Filter state is mirrored to the URL hash so a filtered view is
 * shareable. No router, no router-shaped abstraction; just window.location.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { Fragment } from "preact";
import type { JSX } from "preact";
import type {
  EvalCase,
  EvalJson,
  EvalModelMeta,
} from "./types";
import { passOf } from "./types";
import { armOfModelId, isAbMode } from "../../lib/eval-arms";

interface Props {
  /**
   * Where to fetch the static eval data from. Defaults to /eval-index.json,
   * the slim per-case index (id/category/difficulty/prompt/expected_works
   * plus from_run/mechanical_pass/has_judge per result). The full eval.json
   * with answer bodies + tool traces is build-time-only — per-case pages
   * read it from disk, the explorer never fetches it.
   */
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
  passFilter: "all" | "pass" | "fail" | "unjudged";
  /**
   * Tier filter — "all" (both tiers), "named" (legacy 1k pool only) or
   * "hidden" (discovery pool only). Distinct from the verdict filter above
   * so reviewers can isolate the discovery score from citation precision.
   */
  tierFilter: "all" | "named" | "hidden";
  query: string;
}

const EMPTY_FILTERS: FilterState = {
  categories: new Set(),
  difficulties: new Set(),
  passFilter: "all",
  tierFilter: "all",
  query: "",
};

export default function EvalExplorer({ src = "/eval-index.json" }: Props): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromHash());

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
    />
  );
}

/* ── Loaded view ─────────────────────────────────────────────────────── */

function Loaded({
  data,
  filters,
  setFilters,
}: {
  data: EvalJson;
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
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

  // Filter pipeline. Verdict comes from the single recorded result per case
  // (data.models[0]) — currently grok-4.1-fast on the live site, was sonnet
  // pre-redesign. Code is data-driven; the model id isn't hardcoded.
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
      if (filters.tierFilter !== "all") {
        // Treat tier-missing cases as "named" (legacy artifacts predate the split).
        const tier = c.tier ?? "named";
        if (tier !== filters.tierFilter) return false;
      }
      if (q && !c.prompt.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) {
        return false;
      }
      if (filters.passFilter !== "all") {
        // Pull the verdict from whichever model is present in the data
        // (currently a single model, but the key is data-driven so we
        // can swap models without touching this code). Falls back to
        // null when the model id isn't there or the result is missing.
        const primaryModelId = data.models[0]?.id;
        const result = primaryModelId ? c.results[primaryModelId] : undefined;
        const v = passOf(result);
        if (filters.passFilter === "pass" && v !== true) return false;
        if (filters.passFilter === "fail" && v !== false) return false;
        if (filters.passFilter === "unjudged" && v !== null) return false;
      }
      return true;
    });
  }, [data, filters]);

  return (
    <div class="eval-explorer">
      <Header
        totalCases={data.cases.length}
        models={data.models}
        generatedAt={data.generated_at}
      />
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        categories={allCategories}
        difficulties={allDifficulties}
        filteredCount={filteredCases.length}
        totalCount={data.cases.length}
      />
      <CaseList cases={filteredCases} primaryModelId={data.models[0]?.id} />
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
  return (
    <header class="eval-header">
      <div class="eval-header-stat">
        <span class="eval-header-num">{totalCases.toLocaleString()}</span>
        <span class="eval-header-label">cases</span>
      </div>
      {models.map((m) => {
        // When both tiers are present, show two pills under one model name —
        // the LABEL is the test (DISCOVERY / CITATION) so they don't read as
        // two separate models. The model name is shown once as a row caption.
        const hidden = (m.case_count_hidden ?? 0) > 0;
        const named = (m.case_count_named ?? 0) > 0;
        if (hidden && named) {
          const totalH = m.case_count_hidden ?? 0;
          const passH = m.pass_count_hidden ?? 0;
          const pctH = totalH > 0 ? Math.round((passH / totalH) * 100) : null;
          const totalN = m.case_count_named ?? 0;
          const passN = m.pass_count_named ?? 0;
          const pctN = totalN > 0 ? Math.round((passN / totalN) * 100) : null;
          return (
            <Fragment key={m.id}>
              <div class="eval-header-stat eval-header-stat--hidden">
                <span class="eval-header-num">
                  {pctH === null ? "—" : `${pctH}%`}
                </span>
                <span class="eval-header-label">
                  Discovery <span class="eval-header-frac">({passH}/{totalH})</span>
                </span>
                <span class="eval-header-caption">work hidden · {m.name}</span>
              </div>
              <div class="eval-header-stat eval-header-stat--named">
                <span class="eval-header-num">
                  {pctN === null ? "—" : `${pctN}%`}
                </span>
                <span class="eval-header-label">
                  Citation <span class="eval-header-frac">({passN}/{totalN})</span>
                </span>
                <span class="eval-header-caption">work named · {m.name}</span>
              </div>
            </Fragment>
          );
        }
        const total = m.case_count ?? 0;
        const pass = m.pass_count ?? 0;
        const pct = total > 0 ? Math.round((pass / total) * 100) : null;
        // Single-tier mode: lead with the test name, mention the model in caption.
        const testName = hidden ? "Discovery" : "Citation";
        const caption = hidden
          ? `work hidden · ${m.name}`
          : `${m.name} · deterministic citation check`;
        return (
          <div class="eval-header-stat" key={m.id}>
            <span class="eval-header-num">
              {pct === null ? "—" : `${pct}%`}
            </span>
            <span class="eval-header-label">
              {testName} <span class="eval-header-frac">({pass}/{total})</span>
            </span>
            <span class="eval-header-caption">{caption}</span>
          </div>
        );
      })}
      <div class="eval-header-meta">
        Generated {formatTimestamp(generatedAt)}
      </div>
      {/* Cost / token row — only when at least one model has usage data.
          Older runs predate token tracking; gracefully omitted then. */}
      {models.some((m) => (m.cases_with_usage ?? 0) > 0) && (
        <div class="eval-header-costs">
          {models
            .filter((m) => (m.cases_with_usage ?? 0) > 0)
            .map((m) => (
              <CostRow key={m.id} model={m} />
            ))}
        </div>
      )}
    </header>
  );
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

function CostRow({ model: m }: { model: EvalModelMeta }): JSX.Element {
  const tot = m.total_tokens ?? 0;
  const prompt = m.total_prompt_tokens ?? 0;
  const completion = m.total_completion_tokens ?? 0;
  const cost = m.total_cost_usd ?? null;
  const apiCalls = m.total_api_calls ?? 0;
  const cases = m.cases_with_usage ?? 1;
  const avgCost = cost !== null ? cost / cases : null;
  const avgTokens = tot / cases;
  const avgCalls = apiCalls / cases;
  // Per-tier averages (when both tiers have usage data)
  const avgCostN =
    m.total_cost_usd_named !== undefined && (m.cases_with_usage_named ?? 0) > 0
      ? m.total_cost_usd_named / m.cases_with_usage_named!
      : null;
  const avgCostH =
    m.total_cost_usd_hidden !== undefined && (m.cases_with_usage_hidden ?? 0) > 0
      ? m.total_cost_usd_hidden / m.cases_with_usage_hidden!
      : null;
  const tierBreakdown = avgCostN !== null && avgCostH !== null;
  return (
    <>
      <div class="eval-header-cost-row">
        <span class="eval-header-cost-model">{m.name}</span>
        {cost !== null && (
          <span class="eval-header-cost-stat">
            <strong>${cost.toFixed(2)}</strong>
            <span class="eval-header-cost-label"> total spend</span>
          </span>
        )}
        <span class="eval-header-cost-stat">
          <strong>{fmtTokens(tot)}</strong>
          <span class="eval-header-cost-label"> tokens ({fmtTokens(prompt)} in / {fmtTokens(completion)} out)</span>
        </span>
        <span class="eval-header-cost-stat">
          <strong>{apiCalls.toLocaleString()}</strong>
          <span class="eval-header-cost-label"> API calls</span>
        </span>
        {avgCost !== null && (
          <span class="eval-header-cost-stat">
            <strong>${avgCost.toFixed(4)}</strong>
            <span class="eval-header-cost-label"> avg/q · {fmtTokens(avgTokens)} tok · {avgCalls.toFixed(1)} calls</span>
          </span>
        )}
      </div>
      {tierBreakdown && (
        <div class="eval-header-cost-row eval-header-cost-row--tier">
          <span class="eval-header-cost-model">↳ per tier</span>
          <span class="eval-header-cost-stat">
            <strong>${avgCostH!.toFixed(4)}</strong>
            <span class="eval-header-cost-label"> avg/q discovery</span>
          </span>
          <span class="eval-header-cost-stat">
            <strong>${avgCostN!.toFixed(4)}</strong>
            <span class="eval-header-cost-label"> avg/q citation</span>
          </span>
          <span class="eval-header-cost-stat">
            <strong>{(avgCostH! / avgCostN!).toFixed(1)}×</strong>
            <span class="eval-header-cost-label"> discovery / citation cost ratio</span>
          </span>
        </div>
      )}
    </>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/* ── Filter bar ──────────────────────────────────────────────────────── */

function FilterBar({
  filters,
  setFilters,
  categories,
  difficulties,
  filteredCount,
  totalCount,
}: {
  filters: FilterState;
  setFilters: (f: FilterState | ((prev: FilterState) => FilterState)) => void;
  categories: string[];
  difficulties: string[];
  filteredCount: number;
  totalCount: number;
}): JSX.Element {
  function toggle(key: "categories" | "difficulties", value: string) {
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
      passFilter: "all",
      tierFilter: "all",
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
          {(["all", "pass", "fail", "unjudged"] as const).map((opt) => (
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
        <div class="eval-filter-pass" role="radiogroup" aria-label="Tier">
          {(["all", "hidden", "named"] as const).map((opt) => (
            <button
              type="button"
              key={opt}
              role="radio"
              aria-checked={filters.tierFilter === opt}
              class={
                "eval-pill " +
                (filters.tierFilter === opt ? "is-active" : "")
              }
              onClick={() =>
                setFilters((p) => ({ ...p, tierFilter: opt }))
              }
              title={
                opt === "hidden"
                  ? "Discovery pool — work hidden"
                  : opt === "named"
                  ? "Legacy 1k pool — work named"
                  : "Both tiers"
              }
            >
              {opt === "hidden" ? "discovery" : opt === "named" ? "citation" : "all tiers"}
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

/* ── Case list (flat anchors) ────────────────────────────────────────── */

function CaseList({
  cases,
  primaryModelId,
}: {
  cases: EvalCase[];
  primaryModelId: string | undefined;
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
          <CaseRow c={c} primaryModelId={primaryModelId} />
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
    passRaw === "pass" || passRaw === "fail" || passRaw === "unjudged"
      ? passRaw
      : "all";
  const tierRaw = get("tier");
  const tierFilter: FilterState["tierFilter"] =
    tierRaw === "named" || tierRaw === "hidden" ? tierRaw : "all";
  return {
    categories: split(get("cat")),
    difficulties: split(get("diff")),
    passFilter,
    tierFilter,
    query: get("q"),
  };
}

function writeFiltersToHash(f: FilterState, _data: EvalJson): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (f.categories.size > 0) params.set("cat", [...f.categories].join(","));
  if (f.difficulties.size > 0) params.set("diff", [...f.difficulties].join(","));
  if (f.passFilter !== "all") params.set("pass", f.passFilter);
  if (f.tierFilter !== "all") params.set("tier", f.tierFilter);
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

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
