/**
 * Atlas tools for the /try BYOK demo — the ontology layer, in the browser.
 *
 * The Atlas is the graph `scripts/atlas/synthesize.ts` builds out of the
 * ontology harvest: named entities (figures, places, ideas, groups, objects,
 * events, animals) with the works that mention them, per-work chapter
 * rosters, thematic rows, and a citation graph with stances. It is published
 * as plain JSON under corpus/graph/atlas/, which the site serves at
 * /corpus/graph/atlas/* via the public/corpus symlink — same-origin for
 * /try, exactly like the corpus markdown. So these tools need no backend:
 * they fetch the same generated files the Astro /atlas/* pages read at build
 * time (apps/site/src/lib/atlas-graph.ts is the fs-based sibling of this
 * file), and apps/mcp/src/atlas.ts is the Node port for installed clients.
 *
 * COVERAGE IS THE POINT OF THIS FILE'S DESIGN. The Atlas is mid-run: at the
 * time of writing 357 of 2,018 works have been through extraction. A model
 * that treats "not in the Atlas" as "not in the corpus" will confidently tell
 * users a text doesn't exist. So every tool response carries a live
 * `atlas_coverage` block read from meta.json — never a hardcoded number — and
 * every one of them repeats the guard: absence from the Atlas means
 * not-yet-processed, and search_corpus covers the whole corpus regardless.
 */

import { urlForCitation } from "../../lib/citation-url";

const DEFAULT_ATLAS_BASE = "/corpus/graph/atlas/";

/**
 * Minimal fetch signature. NOT `typeof globalThis.fetch`: Bun's lib types hang
 * extra statics (`preconnect`) off that type, which a wrapper closure can't
 * satisfy — and wrapping is mandatory here (see the constructor comment).
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ─────────────────────────────────────────────────────────────────────────
// File shapes (subsets of apps/site/src/lib/atlas-graph.ts)
// ─────────────────────────────────────────────────────────────────────────

interface QuoteRef {
  p: string;
  text: string;
  chapter: string;
  variant: string;
}

interface EntityIndexRow {
  slug: string;
  kind: string;
  figure_kind?: string;
  name: string;
  surfaces?: string[];
  works: number;
  mentions: number;
  evidence: number;
  page?: boolean;
}

interface EntityWorkMention {
  work: string;
  title: string;
  author?: string;
  era?: string;
  language?: string;
  count: number;
  description?: string;
  quotes?: QuoteRef[];
}

interface EntityDetailFile {
  slug: string;
  kind: string;
  figure_kind?: string;
  name: string;
  surfaces?: string[];
  works: EntityWorkMention[];
  mentions: number;
  evidence: number;
}

interface CitationEdge {
  from: string;
  cited_work: string;
  cited_author?: string;
  stance: string;
  count: number;
  to_work?: string | null;
  quotes?: QuoteRef[];
}

interface ChapterEntityRow {
  slug: string;
  kind: string;
  name: string;
  count: number;
  desc?: string;
  match?: string[];
  p?: string[];
  page?: boolean;
}

interface WorkOntologyFile {
  work: string;
  chapters: Record<string, ChapterEntityRow[]>;
}

interface WorkAtlasRow {
  work: string;
  title: string;
  author?: string;
  era?: string;
  language?: string;
  windows_done: number;
  windows_total: number;
  entity_rows: number;
  kinds: Record<string, number>;
  citations_out: number;
  quote_events: number;
  themes: number;
  top_entities?: { slug: string; kind: string; name: string; count: number }[];
}

interface AtlasMetaFile {
  generated_at: string;
  ontology_version: string;
  windows_synthesized: number;
  windows_total: number | null;
  works_harvested: number;
  works_total: number;
  kinds?: Record<string, number>;
  stances?: Record<string, number>;
  totals?: Record<string, number>;
  coverage?: {
    by_language?: Record<string, { done: number; total: number }>;
    by_era?: Record<string, { done: number; total: number }>;
  };
}

export class AtlasError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "AtlasError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reader — lazy + cached. Nothing is fetched until a tool needs it.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The two flat indexes are large (entities-index.json ~1.3 MB gzipped,
 * citations.json ~1.3 MB gzipped). They are fetched at most once per session
 * and only when a tool that needs them is actually called, so a user who
 * never asks an Atlas question never pays for them.
 */
class BrowserAtlas {
  private base: string;
  private fetchImpl: FetchLike;
  private jsonCache = new Map<string, unknown>();
  private lastFetchError: string | null = null;

  constructor(base = DEFAULT_ATLAS_BASE, fetchImpl: FetchLike = globalThis.fetch) {
    this.base = base.endsWith("/") ? base : base + "/";
    // Wrapped, not assigned — `this.fetchImpl(...)` on a stored native fetch
    // trips Chrome's receiver brand check ("Illegal invocation"). Same fix as
    // BrowserCorpus in ./localMcp.ts; see the comment there.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  private async readJson<T>(relPath: string): Promise<T | null> {
    if (this.jsonCache.has(relPath)) return this.jsonCache.get(relPath) as T | null;
    let parsed: T | null = null;
    try {
      const res = await this.fetchImpl(this.base + relPath);
      parsed = res.ok ? ((await res.json()) as T) : null;
    } catch (err) {
      this.lastFetchError = err instanceof Error ? err.message : String(err);
      parsed = null;
    }
    this.jsonCache.set(relPath, parsed);
    return parsed;
  }

  private required<T>(value: T | null, relPath: string): T {
    if (value === null) {
      const why = this.lastFetchError ? ` (fetch failed: ${this.lastFetchError})` : "";
      throw new AtlasError(
        `Atlas file not found: ${this.base}${relPath}${why}`,
        "The Atlas may not be built for this deployment. Corpus tools (search_corpus, read_chapter, get_passage) work independently of the Atlas.",
      );
    }
    return value;
  }

  async meta(): Promise<AtlasMetaFile> {
    return this.required(await this.readJson<AtlasMetaFile>("meta.json"), "meta.json");
  }

  async entityIndex(): Promise<EntityIndexRow[]> {
    return this.required(
      await this.readJson<EntityIndexRow[]>("entities-index.json"),
      "entities-index.json",
    );
  }

  async citations(): Promise<CitationEdge[]> {
    return this.required(await this.readJson<CitationEdge[]>("citations.json"), "citations.json");
  }

  async worksAtlas(): Promise<WorkAtlasRow[]> {
    return this.required(
      await this.readJson<WorkAtlasRow[]>("works-atlas.json"),
      "works-atlas.json",
    );
  }

  /** Per-entity dossier. Null (not an error) when the entity has no page. */
  async entityDetail(kind: string, slug: string): Promise<EntityDetailFile | null> {
    return this.readJson<EntityDetailFile>(`entities/${kind}--${slug}.json`);
  }

  /** Per-work chapter roster. Null when the work has not been harvested. */
  async workOntology(slug: string): Promise<WorkOntologyFile | null> {
    return this.readJson<WorkOntologyFile>(`works/${slug}.json`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Coverage — computed from meta.json on every call, never hardcoded
// ─────────────────────────────────────────────────────────────────────────

export interface AtlasCoverage {
  works_in_atlas: number;
  works_in_corpus: number;
  works_pct: number;
  windows_synthesized: number;
  windows_total: number | null;
  windows_pct: number | null;
  ontology_version: string;
  generated_at: string;
  caveat: string;
}

function pct(done: number, total: number | null | undefined): number | null {
  if (!total) return null;
  return Math.round((done / total) * 1000) / 10;
}

async function coverageOf(atlas: BrowserAtlas): Promise<AtlasCoverage> {
  const m = await atlas.meta();
  const worksPct = pct(m.works_harvested, m.works_total) ?? 0;
  const windowsPct = pct(m.windows_synthesized, m.windows_total);
  return {
    works_in_atlas: m.works_harvested,
    works_in_corpus: m.works_total,
    works_pct: worksPct,
    windows_synthesized: m.windows_synthesized,
    windows_total: m.windows_total,
    windows_pct: windowsPct,
    ontology_version: m.ontology_version,
    generated_at: m.generated_at,
    caveat:
      `The Atlas is a partial, in-progress layer: ${m.works_harvested} of ${m.works_total} works ` +
      `(${worksPct}%) have been through ontology extraction` +
      (windowsPct !== null
        ? `, covering ${m.windows_synthesized} of ${m.windows_total} text windows (${windowsPct}%)`
        : "") +
      `. A work or figure missing from the Atlas is NOT missing from the corpus — it simply has not ` +
      `been processed yet. Never conclude from an Atlas result that the corpus lacks something; ` +
      `use search_corpus, which covers all ${m.works_total} works. Tell the user when a negative ` +
      `answer rests on Atlas coverage rather than on the corpus itself.`,
  };
}

/** Coverage alone — also used to build the demo's system prompt at mount. */
export async function atlasCoverage(
  base?: string,
  fetchImpl?: FetchLike,
): Promise<AtlasCoverage> {
  return coverageOf(new BrowserAtlas(base, fetchImpl));
}

// ─────────────────────────────────────────────────────────────────────────
// Matching helpers
// ─────────────────────────────────────────────────────────────────────────

/** Fold case and diacritics so "sakra" matches "Śakra" and "rama" matches
 *  "Rāma" — the harvest keeps source-anchored transliteration, and users
 *  type ASCII. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function scoreEntity(row: EntityIndexRow, needle: string): number {
  const name = fold(row.name);
  let score = 0;
  if (name === needle) score = 100;
  else if (name.startsWith(needle)) score = 70;
  else if (name.includes(needle)) score = 45;

  if (score === 0) {
    for (const surface of row.surfaces ?? []) {
      const s = fold(surface);
      if (s === needle) {
        score = Math.max(score, 60);
        break;
      }
      if (s.includes(needle)) score = Math.max(score, 30);
    }
  }
  if (score === 0) return 0;
  // Prominence tiebreak — a figure in 123 works outranks a namesake in one.
  return score + Math.min(Math.log10(1 + row.mentions) * 3, 12);
}

const KINDS = ["figure", "group", "place", "object", "idea", "event", "animal"] as const;

// ─────────────────────────────────────────────────────────────────────────
// The five tools
// ─────────────────────────────────────────────────────────────────────────

const MAX_QUOTES_PER_WORK = 2;
const MAX_WORKS_PER_ENTITY = 15;
const MAX_ENTITIES_PER_CHAPTER = 10;
const MAX_CHAPTERS_PER_WORK = 40;

export interface AtlasSearchArgs {
  query?: string;
  kind?: string;
  limit?: number;
}

async function atlas_search(atlas: BrowserAtlas, args: AtlasSearchArgs) {
  const query = (args.query ?? "").trim();
  if (!query) throw new AtlasError("atlas_search requires a query");
  if (args.kind && !KINDS.includes(args.kind as (typeof KINDS)[number])) {
    throw new AtlasError(`Unknown kind: ${args.kind}`, `Valid kinds: ${KINDS.join(", ")}`);
  }
  const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
  const needle = fold(query);
  const rows = await atlas.entityIndex();

  const scored: { row: EntityIndexRow; score: number }[] = [];
  for (const row of rows) {
    if (args.kind && row.kind !== args.kind) continue;
    const score = scoreEntity(row, needle);
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || b.row.mentions - a.row.mentions);

  return {
    query,
    kind: args.kind ?? null,
    count: scored.length,
    results: scored.slice(0, limit).map(({ row }) => ({
      kind: row.kind,
      slug: row.slug,
      name: row.name,
      figure_kind: row.figure_kind ?? null,
      surfaces: (row.surfaces ?? []).slice(0, 8),
      works: row.works,
      mentions: row.mentions,
      // Only entities with a detail file can be opened by atlas_entity.
      has_dossier: row.page === true,
    })),
    atlas_coverage: await coverageOf(atlas),
  };
}

export interface AtlasEntityArgs {
  kind?: string;
  slug?: string;
  limit_works?: number;
}

async function atlas_entity(atlas: BrowserAtlas, args: AtlasEntityArgs) {
  if (!args.kind || !args.slug) {
    throw new AtlasError(
      "atlas_entity requires kind and slug",
      "Call atlas_search first — its results carry the exact kind + slug.",
    );
  }
  const detail = await atlas.entityDetail(args.kind, args.slug);
  if (!detail) {
    throw new AtlasError(
      `No Atlas dossier for ${args.kind}/${args.slug}`,
      "Either the slug is wrong (call atlas_search) or this entity is below the dossier threshold — atlas_search rows with has_dossier=false have index data only.",
    );
  }
  const limitWorks = Math.min(Math.max(args.limit_works ?? MAX_WORKS_PER_ENTITY, 1), 40);
  const works = [...detail.works]
    .sort((a, b) => b.count - a.count)
    .slice(0, limitWorks)
    .map((w) => ({
      work_slug: w.work,
      title: w.title,
      author: w.author ?? null,
      era: w.era ?? null,
      language: w.language ?? null,
      mentions: w.count,
      description: w.description ?? null,
      quotes: (w.quotes ?? []).slice(0, MAX_QUOTES_PER_WORK).map((q) => ({
        paragraph_id: q.p,
        text: q.text,
        chapter_slug: q.chapter,
        variant: q.variant,
        citation_url: urlForCitation({
          workSlug: w.work,
          chapterSlug: q.chapter,
          variant: q.variant,
          paragraphIds: q.p?.startsWith("p-") ? [q.p] : undefined,
        }),
      })),
    }));

  return {
    kind: detail.kind,
    slug: detail.slug,
    name: detail.name,
    figure_kind: detail.figure_kind ?? null,
    surfaces: (detail.surfaces ?? []).slice(0, 20),
    mentions_total: detail.mentions,
    works_total: detail.works.length,
    works_shown: works.length,
    works,
    atlas_coverage: await coverageOf(atlas),
  };
}

export interface AtlasWorkArgs {
  work_slug?: string;
  chapter_slug?: string;
}

async function atlas_work(atlas: BrowserAtlas, args: AtlasWorkArgs) {
  if (!args.work_slug) throw new AtlasError("atlas_work requires work_slug");
  const [ontology, rows, coverage] = await Promise.all([
    atlas.workOntology(args.work_slug),
    atlas.worksAtlas(),
    coverageOf(atlas),
  ]);
  const row = rows.find((r) => r.work === args.work_slug) ?? null;

  if (!ontology) {
    return {
      work_slug: args.work_slug,
      in_atlas: false,
      note: `This work has not been through ontology extraction yet, so the Atlas has nothing for it. The work's TEXT is still fully available — use list_chapters / read_chapter / search_corpus.`,
      atlas_coverage: coverage,
    };
  }

  const allChapters = Object.entries(ontology.chapters);
  const chapters = allChapters
    .slice(0, MAX_CHAPTERS_PER_WORK)
    .map(([chapterSlug, entities]) => ({
      chapter_slug: chapterSlug,
      entity_count: entities.length,
      entities: [...entities]
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_ENTITIES_PER_CHAPTER)
        .map((e) => ({
          kind: e.kind,
          slug: e.slug,
          name: e.name,
          mentions: e.count,
          description: e.desc ?? null,
          paragraph_ids: (e.p ?? []).slice(0, 3),
          has_dossier: e.page === true,
        })),
    }));

  return {
    work_slug: args.work_slug,
    in_atlas: true,
    title: row?.title ?? null,
    author: row?.author ?? null,
    work_completeness: row
      ? {
          windows_done: row.windows_done,
          windows_total: row.windows_total,
          windows_pct: pct(row.windows_done, row.windows_total),
          entity_rows: row.entity_rows,
          kinds: row.kinds,
          citations_out: row.citations_out,
          themes: row.themes,
        }
      : null,
    top_entities: (row?.top_entities ?? []).slice(0, 12),
    chapters_in_atlas: allChapters.length,
    chapters_shown: chapters.length,
    chapters: args.chapter_slug
      ? chapters.filter((c) => c.chapter_slug === args.chapter_slug)
      : chapters,
    atlas_coverage: coverage,
  };
}

export interface AtlasCitationsArgs {
  work_slug?: string;
  cited_work?: string;
  stance?: string;
  limit?: number;
}

async function atlas_citations(atlas: BrowserAtlas, args: AtlasCitationsArgs) {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 60);
  const edges = await atlas.citations();
  const citingFilter = args.work_slug;
  const citedNeedle = args.cited_work ? fold(args.cited_work) : null;
  const stance = args.stance?.toLowerCase();

  const matched = edges.filter((e) => {
    if (citingFilter && e.from !== citingFilter && e.to_work !== citingFilter) return false;
    if (
      citedNeedle &&
      !fold(e.cited_work ?? "").includes(citedNeedle) &&
      !fold(e.cited_author ?? "").includes(citedNeedle) &&
      !fold(e.to_work ?? "").includes(citedNeedle)
    ) {
      return false;
    }
    if (stance && e.stance?.toLowerCase() !== stance) return false;
    return true;
  });
  matched.sort((a, b) => b.count - a.count);

  return {
    filters: {
      work_slug: args.work_slug ?? null,
      cited_work: args.cited_work ?? null,
      stance: args.stance ?? null,
    },
    count: matched.length,
    stance_legend: {
      authority: "cited as an authority to settle a point",
      endorse: "cited approvingly",
      refute: "cited in order to argue against",
      extend: "cited and built upon",
      neutral: "cited without evident attitude",
    },
    edges: matched.slice(0, limit).map((e) => ({
      citing_work: e.from,
      cited_work_title: e.cited_work,
      cited_author: e.cited_author ?? null,
      cited_work_slug: e.to_work ?? null,
      // to_work is null when the cited text is outside the corpus — worth
      // stating so the model doesn't try to read_chapter a work we don't have.
      cited_work_in_corpus: Boolean(e.to_work),
      stance: e.stance,
      count: e.count,
      quotes: (e.quotes ?? []).slice(0, MAX_QUOTES_PER_WORK).map((q) => ({
        paragraph_id: q.p,
        text: q.text,
        chapter_slug: q.chapter,
        variant: q.variant,
        citation_url: urlForCitation({
          workSlug: e.from,
          chapterSlug: q.chapter,
          variant: q.variant,
          paragraphIds: q.p?.startsWith("p-") ? [q.p] : undefined,
        }),
      })),
    })),
    atlas_coverage: await coverageOf(atlas),
  };
}

async function atlas_coverage_tool(atlas: BrowserAtlas) {
  const m = await atlas.meta();
  const byLanguage = Object.entries(m.coverage?.by_language ?? {})
    .map(([language, c]) => ({ language, done: c.done, total: c.total, pct: pct(c.done, c.total) }))
    .sort((a, b) => b.total - a.total);
  const byEra = Object.entries(m.coverage?.by_era ?? {})
    .map(([era, c]) => ({ era, done: c.done, total: c.total, pct: pct(c.done, c.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    ...(await coverageOf(atlas)),
    entity_counts_by_kind: m.kinds ?? {},
    stance_counts: m.stances ?? {},
    totals: m.totals ?? {},
    by_language: byLanguage,
    by_era: byEra,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────

export const ATLAS_TOOL_NAMES = [
  "atlas_search",
  "atlas_entity",
  "atlas_work",
  "atlas_citations",
  "atlas_coverage",
] as const;

export type AtlasToolName = (typeof ATLAS_TOOL_NAMES)[number];

export function isAtlasTool(name: string): name is AtlasToolName {
  return (ATLAS_TOOL_NAMES as readonly string[]).includes(name);
}

/** One Atlas reader per client so caches are shared across a session. */
export function createAtlasClient(base?: string, fetchImpl?: FetchLike) {
  const atlas = new BrowserAtlas(base, fetchImpl);
  return {
    coverage: () => coverageOf(atlas),
    async dispatch(name: AtlasToolName, rawArgs: unknown): Promise<unknown> {
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      switch (name) {
        case "atlas_search":
          return atlas_search(atlas, args as AtlasSearchArgs);
        case "atlas_entity":
          return atlas_entity(atlas, args as AtlasEntityArgs);
        case "atlas_work":
          return atlas_work(atlas, args as AtlasWorkArgs);
        case "atlas_citations":
          return atlas_citations(atlas, args as AtlasCitationsArgs);
        case "atlas_coverage":
          return atlas_coverage_tool(atlas);
      }
    },
  };
}
