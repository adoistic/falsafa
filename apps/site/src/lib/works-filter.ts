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
