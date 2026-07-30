/**
 * Atlas tools for the installed MCP — the ontology layer over the corpus.
 *
 * The Atlas is built by scripts/atlas/synthesize.ts in the Falsafa repo and
 * published as plain JSON: entity dossiers (figures, places, ideas, groups,
 * objects, events, animals), per-work chapter rosters, a citation graph with
 * stances, and a meta.json holding live coverage counters.
 *
 * WHERE IT READS FROM. The Atlas is ~64 MB, so it is deliberately NOT part of
 * the corpus release tarball that `npx @falsafa/mcp` downloads — that would add
 * 64 MB to every first run for a layer many sessions never touch. Instead:
 *
 *   1. `FALSAFA_ATLAS_URL`, if set, wins (a mirror, or a local static server).
 *   2. `<corpusRoot>/graph/atlas/` on disk, when a build put it there.
 *   3. `<FALSAFA_CORPUS_URL>graph/atlas/` in remote (zero-download) mode.
 *   4. Otherwise https://falsafa.ai/corpus/graph/atlas/ — fetched lazily, per
 *      file, and cached in memory for the process.
 *
 * So Atlas tools work in every mode, and a session that asks no Atlas question
 * fetches nothing.
 *
 * COVERAGE IS PART OF THE CONTRACT. The ontology run is incomplete (357 of
 * 2,018 works at the time of writing, and climbing). Every response carries a
 * live `atlas_coverage` block read from meta.json — never a constant in this
 * file — because a model that reads "absent from the Atlas" as "absent from the
 * corpus" will confidently tell a user a text does not exist.
 *
 * Output shapes match apps/site/src/islands/byok/atlas.ts (the browser port)
 * so a model sees the same structure whether it is talking to this server or
 * to the in-page demo.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MCPError } from "./corpus.ts";
import type { Corpus } from "./corpus.ts";

const PUBLIC_ATLAS_URL = "https://falsafa.ai/corpus/graph/atlas/";

// ─────────────────────────────────────────────────────────────────────────
// File shapes (subsets — see apps/site/src/lib/atlas-graph.ts for the full set)
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

// ─────────────────────────────────────────────────────────────────────────
// Reader
// ─────────────────────────────────────────────────────────────────────────

export class Atlas {
  private mode: "local" | "remote";
  private root = "";
  private baseUrl = "";
  private cache = new Map<string, unknown>();
  private lastFetchError: string | null = null;

  constructor(corpus?: Corpus) {
    const envUrl = process.env["FALSAFA_ATLAS_URL"]?.trim();
    const localDir = corpus && !corpus.isRemote ? join(corpus.rootPath, "graph", "atlas") : null;

    if (envUrl) {
      this.mode = "remote";
      this.baseUrl = envUrl.endsWith("/") ? envUrl : envUrl + "/";
    } else if (localDir && existsSync(join(localDir, "meta.json"))) {
      this.mode = "local";
      this.root = localDir;
    } else if (corpus?.isRemote) {
      this.mode = "remote";
      this.baseUrl = corpus.rootPath + "graph/atlas/";
    } else {
      this.mode = "remote";
      this.baseUrl = PUBLIC_ATLAS_URL;
    }
  }

  /** Where this process is reading the Atlas from — logged at startup. */
  get source(): string {
    return this.mode === "local" ? this.root : this.baseUrl;
  }

  private async readJson<T>(relPath: string): Promise<T | null> {
    if (this.cache.has(relPath)) return this.cache.get(relPath) as T | null;
    let parsed: T | null = null;
    try {
      if (this.mode === "local") {
        const p = join(this.root, relPath);
        parsed = existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as T) : null;
      } else {
        const res = await fetch(this.baseUrl + relPath);
        parsed = res.ok ? ((await res.json()) as T) : null;
      }
    } catch (err) {
      this.lastFetchError = err instanceof Error ? err.message : String(err);
      parsed = null;
    }
    this.cache.set(relPath, parsed);
    return parsed;
  }

  private required<T>(value: T | null, relPath: string): T {
    if (value === null) {
      const why = this.lastFetchError ? ` (read failed: ${this.lastFetchError})` : "";
      throw new MCPError(
        "INTERNAL",
        `Atlas file not found: ${this.source}${relPath}${why}`,
        "The Atlas is fetched from falsafa.ai unless FALSAFA_ATLAS_URL or a local graph/atlas/ directory is present. Corpus tools (search_corpus, read_chapter, get_passage) do not depend on it.",
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

  async entityDetail(kind: string, slug: string): Promise<EntityDetailFile | null> {
    return this.readJson<EntityDetailFile>(`entities/${kind}--${slug}.json`);
  }

  async workOntology(slug: string): Promise<WorkOntologyFile | null> {
    return this.readJson<WorkOntologyFile>(`works/${slug}.json`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Citations + coverage
// ─────────────────────────────────────────────────────────────────────────

/** Chapter URL grammar on falsafa.ai. Mirrors urlForCitation in
 *  apps/site/src/lib/citation-url.ts — the site is configured with
 *  `trailingSlash: always`, so the slash before the `#` is required. */
function citationUrl(workSlug: string, chapterSlug: string, variant: string, pId?: string): string {
  const base = `https://falsafa.ai/works/${encodeURIComponent(workSlug)}/${encodeURIComponent(chapterSlug)}/${encodeURIComponent(variant)}/`;
  return pId?.startsWith("p-") ? `${base}#${pId}` : base;
}

function pct(done: number, total: number | null | undefined): number | null {
  if (!total) return null;
  return Math.round((done / total) * 1000) / 10;
}

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

async function coverageOf(atlas: Atlas): Promise<AtlasCoverage> {
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

/** Fold case and diacritics so "sakra" matches "Śakra" — the harvest keeps
 *  source-anchored transliteration and callers type ASCII. */
function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function scoreEntity(row: EntityIndexRow, needle: string): number {
  const name = foldText(row.name);
  let score = 0;
  if (name === needle) score = 100;
  else if (name.startsWith(needle)) score = 70;
  else if (name.includes(needle)) score = 45;

  if (score === 0) {
    for (const surface of row.surfaces ?? []) {
      const s = foldText(surface);
      if (s === needle) {
        score = Math.max(score, 60);
        break;
      }
      if (s.includes(needle)) score = Math.max(score, 30);
    }
  }
  if (score === 0) return 0;
  return score + Math.min(Math.log10(1 + row.mentions) * 3, 12);
}

export const ATLAS_KINDS = [
  "figure",
  "group",
  "place",
  "object",
  "idea",
  "event",
  "animal",
] as const;

const MAX_QUOTES_PER_WORK = 2;
const MAX_WORKS_PER_ENTITY = 15;
const MAX_ENTITIES_PER_CHAPTER = 10;
const MAX_CHAPTERS_PER_WORK = 40;

// ─────────────────────────────────────────────────────────────────────────
// The five tools
// ─────────────────────────────────────────────────────────────────────────

export async function atlas_search(
  atlas: Atlas,
  args: { query?: string; kind?: string; limit?: number },
) {
  const query = (args.query ?? "").trim();
  if (!query) throw new MCPError("BAD_QUERY", "atlas_search requires a query");
  if (args.kind && !(ATLAS_KINDS as readonly string[]).includes(args.kind)) {
    throw new MCPError(
      "BAD_QUERY",
      `Unknown kind: ${args.kind}`,
      `Valid kinds: ${ATLAS_KINDS.join(", ")}`,
    );
  }
  const limit = Math.min(Math.max(args.limit ?? 15, 1), 50);
  const needle = foldText(query);
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
      has_dossier: row.page === true,
    })),
    atlas_coverage: await coverageOf(atlas),
  };
}

export async function atlas_entity(
  atlas: Atlas,
  args: { kind?: string; slug?: string; limit_works?: number },
) {
  if (!args.kind || !args.slug) {
    throw new MCPError(
      "BAD_QUERY",
      "atlas_entity requires kind and slug",
      "Call atlas_search first — its results carry the exact kind + slug.",
    );
  }
  const detail = await atlas.entityDetail(args.kind, args.slug);
  if (!detail) {
    throw new MCPError(
      "WORK_NOT_FOUND",
      `No Atlas dossier for ${args.kind}/${args.slug}`,
      "Either the slug is wrong (call atlas_search) or this entity is below the dossier threshold — atlas_search rows with has_dossier=false have index data only.",
    );
  }
  const limitWorks = Math.min(Math.max(args.limit_works ?? MAX_WORKS_PER_ENTITY, 1), 40);

  return {
    kind: detail.kind,
    slug: detail.slug,
    name: detail.name,
    figure_kind: detail.figure_kind ?? null,
    surfaces: (detail.surfaces ?? []).slice(0, 20),
    mentions_total: detail.mentions,
    works_total: detail.works.length,
    works_shown: Math.min(detail.works.length, limitWorks),
    works: [...detail.works]
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
          citation_url: citationUrl(w.work, q.chapter, q.variant, q.p),
        })),
      })),
    atlas_coverage: await coverageOf(atlas),
  };
}

export async function atlas_work(
  atlas: Atlas,
  args: { work_slug?: string; chapter_slug?: string },
) {
  if (!args.work_slug) throw new MCPError("BAD_QUERY", "atlas_work requires work_slug");
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
      note: "This work has not been through ontology extraction yet, so the Atlas has nothing for it. The work's TEXT is still fully available — use list_chapters / read_chapter / search_corpus.",
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

export async function atlas_citations(
  atlas: Atlas,
  args: { work_slug?: string; cited_work?: string; stance?: string; limit?: number },
) {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 60);
  const edges = await atlas.citations();
  const citingFilter = args.work_slug;
  const citedNeedle = args.cited_work ? foldText(args.cited_work) : null;
  const stance = args.stance?.toLowerCase();

  const matched = edges.filter((e) => {
    if (citingFilter && e.from !== citingFilter && e.to_work !== citingFilter) return false;
    if (
      citedNeedle &&
      !foldText(e.cited_work ?? "").includes(citedNeedle) &&
      !foldText(e.cited_author ?? "").includes(citedNeedle) &&
      !foldText(e.to_work ?? "").includes(citedNeedle)
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
      cited_work_in_corpus: Boolean(e.to_work),
      stance: e.stance,
      count: e.count,
      quotes: (e.quotes ?? []).slice(0, MAX_QUOTES_PER_WORK).map((q) => ({
        paragraph_id: q.p,
        text: q.text,
        chapter_slug: q.chapter,
        variant: q.variant,
        citation_url: citationUrl(e.from, q.chapter, q.variant, q.p),
      })),
    })),
    atlas_coverage: await coverageOf(atlas),
  };
}

export async function atlas_coverage(atlas: Atlas) {
  const m = await atlas.meta();
  const byLanguage = Object.entries(m.coverage?.by_language ?? {})
    .map(([language, c]) => ({ language, done: c.done, total: c.total, pct: pct(c.done, c.total) }))
    .sort((a, b) => b.total - a.total);
  const byEra = Object.entries(m.coverage?.by_era ?? {})
    .map(([era, c]) => ({ era, done: c.done, total: c.total, pct: pct(c.done, c.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    ...(await coverageOf(atlas)),
    source: atlas.source,
    entity_counts_by_kind: m.kinds ?? {},
    stance_counts: m.stances ?? {},
    totals: m.totals ?? {},
    by_language: byLanguage,
    by_era: byEra,
  };
}
