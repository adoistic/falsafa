/**
 * Local (client-side, zero-backend) Falsafa MCP client for the /try BYOK demo.
 *
 * The /try page and the corpus are served from the SAME origin (falsafa.ai):
 * the corpus markdown lives under /corpus/* (see apps/site/scripts/prepare-
 * corpus.ts, which symlinks public/corpus → repo-root corpus/). So the
 * librarian tools can run entirely in the browser by `fetch`-ing the same
 * static files the stdio/remote MCP reads — no server hop, no CORS, no key
 * beyond the LLM provider key the user already typed. Full-text search comes
 * from the site's own Pagefind index (./pagefindSearch.ts) and the Atlas tools
 * from the published ontology graph (./atlas.ts).
 *
 * This is a direct browser port of the "remote" (zero-download) mode of
 * apps/mcp: apps/mcp/src/corpus.ts (the Corpus reader) + apps/mcp/src/tools.ts
 * (the catalog tools). Output shapes mirror apps/mcp/src/tools.ts so the model sees
 * the same structure whether it's talking to the installed MCP or this
 * in-page version. Two deliberate additions the demo's system prompt
 * (FALSAFA_SYSTEM_PROMPT in ./providers/tools.ts) requires — `citation_url`
 * on read_chapter and get_passage — are documented inline; without them the
 * demo's markdown-footnote citations can't be built.
 *
 * `createLocalMcpClient(base)` returns the SAME `{ invoke(name, args) }`
 * interface as `createMcpClient` (./mcpClient.ts), so the two are drop-in
 * interchangeable — the HTTP client stays available as an explicit override
 * (PUBLIC_FALSAFA_MCP_URL / window.__FALSAFA_MCP_URL).
 */

import { urlForCitation } from "../../lib/citation-url";
import type { McpCallError, McpCallResult } from "./mcpClient";
import { searchPassages, type PagefindLoader } from "./pagefindSearch";
import { AtlasError, createAtlasClient, isAtlasTool } from "./atlas";

/**
 * Minimal fetch signature. NOT `typeof globalThis.fetch`: Bun's lib types hang
 * extra statics (`preconnect`) off that type, which a wrapper closure can't
 * satisfy — and wrapping is mandatory here (see the constructor comment).
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ─────────────────────────────────────────────────────────────────────────
// Types (subset of apps/mcp/src/corpus.ts — only what the reader needs)
// ─────────────────────────────────────────────────────────────────────────

export interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
  era: string;
  era_slug: string;
  genre: string;
  genre_slug: string;
  language: string;
  language_slug: string;
  language_direction: string;
  total_logical_chapters: number;
  total_variant_entries: number;
  published_year: number | null;
  difficulty: string | null;
  description: string;
  thothica_role: string;
}

interface Manifest {
  works: ManifestWork[];
}

interface ChapterVariant {
  file: string;
  content_type: "original" | "transliteration" | "translation" | "unknown";
  variant_id: string;
  language: string;
  source_language: string;
  script: string;
  word_count: number;
  paragraph_count: number;
  has_image: boolean;
  source_url: string | null;
}

interface ChapterMeta {
  work_slug: string;
  work_title: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  layout: "prose" | "verse" | "manuscript";
  layouts_in_variants: string[];
  default_variant: string;
  variants: ChapterVariant[];
}

interface ParagraphRecord {
  id: string;
  offset: number;
  text: string;
}

/** Flat catalog (`mcp-index.json`) — stands in for readdir, which the
 *  browser can't do over HTTP. Only the fields we need are typed. */
interface McpIndexChapterEntry {
  n: number;
  slug: string;
  def: string;
  wiki: boolean;
  variants: { type: string; file: string; lang: string }[];
}
interface McpIndex {
  chapters_by_work: Record<string, McpIndexChapterEntry[]>;
}

interface CrossLinkEntry {
  work_slug: string;
  chapter_slug: string;
  chapter_number: number;
  score: number;
}
interface CrossLinkIndexFile {
  links: Record<string, CrossLinkEntry[]>;
}

// ─────────────────────────────────────────────────────────────────────────
// Errors — mirrors apps/mcp/src/corpus.ts MCPError
// ─────────────────────────────────────────────────────────────────────────

type MCPErrorCode =
  | "WORK_NOT_FOUND"
  | "CHAPTER_NOT_FOUND"
  | "VARIANT_NOT_FOUND"
  | "CHAPTER_OUT_OF_RANGE"
  | "PASSAGE_OUT_OF_RANGE"
  | "BAD_QUERY"
  | "INTERNAL";

class MCPError extends Error {
  constructor(
    public code: MCPErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "MCPError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter parser — ported verbatim from apps/mcp/src/corpus.ts so the
// `body` string (and thus the sidecar `offset`s that index into it) match
// byte-for-byte. A trim-based stripper would shift those offsets and
// misalign the [p-xxxxxx] annotation markers — this only strips the
// delimiter block plus leading newlines, exactly as apps/mcp does.
// ─────────────────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const yamlRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const frontmatter = parseSimpleYaml(yamlRaw);
  return { frontmatter, body };
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = input.split("\n");
  let currentObj: Record<string, unknown> | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("  ") && currentObj !== null) {
      const m = line.trimStart().match(/^([\w_]+):\s*(.*)$/);
      if (m) currentObj[m[1]!] = parseValue(m[2]!);
      continue;
    }
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === "" || v === undefined) {
        currentObj = {};
        result[k!] = currentObj;
      } else {
        result[k!] = parseValue(v);
        currentObj = null;
      }
    }
  }
  return result;
}

function parseValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────
// Browser corpus reader — fetch-backed analog of the "remote" Corpus.
// One instance per client; caches every fetched file in an in-module Map so
// repeated tool calls in a session don't re-fetch the same chapter.
// ─────────────────────────────────────────────────────────────────────────

class BrowserCorpus {
  private base: string;
  private fetchImpl: FetchLike;
  private fileCache = new Map<string, string | null>();
  private _manifest: Manifest | null = null;
  private _mcpIndex: McpIndex | null = null;
  private _crossLinks: CrossLinkIndexFile | null | undefined;
  private chapterListCache = new Map<string, ChapterMeta[]>();
  /** Message from the most recent fetch that threw — folded into the
   *  INTERNAL errors below so a transport failure doesn't masquerade as a
   *  missing file. */
  private lastFetchError: string | null = null;

  constructor(base: string, fetchImpl: FetchLike) {
    this.base = base.endsWith("/") ? base : base + "/";
    // Wrap, don't assign. Storing fetch on the instance and calling it as
    // `this.fetchImpl(...)` invokes the browser's native fetch with `this` set
    // to the BrowserCorpus — and Chrome brand-checks the receiver, throwing
    // "Failed to execute 'fetch' on 'Window': Illegal invocation". Node/Bun
    // don't brand-check, so this only ever broke in the browser (the one place
    // this client actually runs): every readFile threw, got swallowed below,
    // and surfaced to the model as "manifest.json not found". The arrow keeps
    // the invocation plain, which is legal for native fetch and for any
    // injected test double.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  /** Fetch one corpus file by POSIX-relative path; null when it 404s. */
  private async readFile(relPath: string): Promise<string | null> {
    if (this.fileCache.has(relPath)) return this.fileCache.get(relPath)!;
    let body: string | null;
    try {
      const res = await this.fetchImpl(this.base + relPath);
      body = res.ok ? await res.text() : null;
    } catch (err) {
      this.lastFetchError = err instanceof Error ? err.message : String(err);
      body = null;
    }
    this.fileCache.set(relPath, body);
    return body;
  }

  /** Suffix for the "index file missing" errors: names the transport failure
   *  when there was one, so the next class of bug isn't invisible. */
  private fetchErrorSuffix(): string {
    return this.lastFetchError ? ` (fetch failed: ${this.lastFetchError})` : "";
  }

  private async readJson<T>(relPath: string): Promise<T | null> {
    const raw = await this.readFile(relPath);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async manifest(): Promise<Manifest> {
    if (!this._manifest) {
      const m = await this.readJson<Manifest>("manifest.json");
      if (!m)
        throw new MCPError(
          "INTERNAL",
          `manifest.json not found at ${this.base}${this.fetchErrorSuffix()}`,
        );
      this._manifest = m;
    }
    return this._manifest;
  }

  async works(): Promise<ManifestWork[]> {
    return (await this.manifest()).works;
  }

  async findWork(slug: string): Promise<ManifestWork | undefined> {
    return (await this.works()).find((w) => w.slug === slug);
  }

  private async mcpIndex(): Promise<McpIndex> {
    if (!this._mcpIndex) {
      const idx = await this.readJson<McpIndex>("mcp-index.json");
      if (!idx)
        throw new MCPError(
          "INTERNAL",
          `mcp-index.json not found at ${this.base}${this.fetchErrorSuffix()}`,
        );
      this._mcpIndex = idx;
    }
    return this._mcpIndex;
  }

  /**
   * List a work's chapters. The browser can't readdir over HTTP, so the flat
   * mcp-index tells us which chapter slugs exist; we then fetch each chapter's
   * meta.json for the full ChapterMeta (chapter_title, layout, variants, …).
   * Mirrors Corpus.listChapters (remote branch) in apps/mcp/src/corpus.ts.
   */
  async listChapters(workSlug: string): Promise<ChapterMeta[]> {
    if (this.chapterListCache.has(workSlug)) return this.chapterListCache.get(workSlug)!;
    const work = await this.findWork(workSlug);
    if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${workSlug}`);
    const entries = (await this.mcpIndex()).chapters_by_work[workSlug];
    if (!entries) {
      throw new MCPError("INTERNAL", `No chapter index for ${workSlug} in mcp-index.json`);
    }
    const metas = (
      await Promise.all(
        entries.map((e) =>
          this.readJson<ChapterMeta>(`works/${workSlug}/chapters/${e.slug}/meta.json`),
        ),
      )
    )
      .filter((m): m is ChapterMeta => m !== null)
      .sort((a, b) => a.chapter_number - b.chapter_number);
    this.chapterListCache.set(workSlug, metas);
    return metas;
  }

  /**
   * Map a chapter SLUG to its logical chapter_number. Search hits carry slugs
   * (they come from URLs), while read_chapter / get_passage take numbers — so
   * without this the model can't act on a search result. Answered from the
   * flat mcp-index (~270 KB gzipped, fetched once per session), not by walking
   * every chapter's meta.json.
   */
  async chapterNumberFor(workSlug: string, chapterSlug: string): Promise<number | null> {
    try {
      const entries = (await this.mcpIndex()).chapters_by_work[workSlug];
      return entries?.find((e) => e.slug === chapterSlug)?.n ?? null;
    } catch {
      return null;
    }
  }

  async getChapterMeta(workSlug: string, chapterNumber: number): Promise<ChapterMeta> {
    const list = await this.listChapters(workSlug);
    const m = list.find((c) => c.chapter_number === chapterNumber);
    if (!m) {
      throw new MCPError(
        "CHAPTER_OUT_OF_RANGE",
        `Chapter ${chapterNumber} not found in ${workSlug}`,
        `Valid chapter numbers: ${list.map((c) => c.chapter_number).join(", ")}`,
      );
    }
    return m;
  }

  async readChapter(
    workSlug: string,
    chapterNumber: number,
    variantType?: "original" | "transliteration" | "translation",
  ): Promise<{ meta: ChapterMeta; variant: ChapterVariant; body: string; frontmatter: Record<string, unknown> }> {
    const meta = await this.getChapterMeta(workSlug, chapterNumber);
    const variantFile = variantType
      ? meta.variants.find((v) => v.content_type === variantType)?.file
      : meta.default_variant;
    if (!variantFile) {
      throw new MCPError(
        "VARIANT_NOT_FOUND",
        `Variant '${variantType ?? "default"}' not found in ${workSlug} chapter ${chapterNumber}`,
        `Available variants: ${meta.variants.map((v) => v.content_type).join(", ")}`,
      );
    }
    const variant = meta.variants.find((v) => v.file === variantFile)!;
    const relPath = `works/${workSlug}/chapters/${meta.chapter_slug}/${variantFile}`;
    const raw = await this.readFile(relPath);
    if (raw === null) throw new MCPError("INTERNAL", `Chapter file missing: ${relPath}`);
    const { frontmatter, body } = parseFrontmatter(raw);
    return { meta, variant, body, frontmatter };
  }

  async readParagraphs(
    workSlug: string,
    chapterSlug: string,
    variantFile: string,
  ): Promise<ParagraphRecord[]> {
    const sidecarFile = variantFile.replace(/\.md$/, ".paragraphs.json");
    const recs = await this.readJson<ParagraphRecord[]>(
      `works/${workSlug}/chapters/${chapterSlug}/${sidecarFile}`,
    );
    return recs ?? [];
  }

  async crossLinks(): Promise<CrossLinkIndexFile | null> {
    if (this._crossLinks !== undefined) return this._crossLinks;
    this._crossLinks = await this.readJson<CrossLinkIndexFile>("cross-links.json");
    return this._crossLinks;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Body annotation — ported verbatim from apps/mcp/src/tools.ts. Injects
// `[p-xxxxxx] ` markers at each paragraph's offset so the model can cite by
// stable hash instead of guessing from inline verse markers.
// ─────────────────────────────────────────────────────────────────────────

function annotateBodyWithParagraphIds(body: string, paragraphs: ParagraphRecord[]): string {
  if (paragraphs.length === 0) return body;
  const sorted = [...paragraphs].sort((a, b) => a.offset - b.offset);
  let out = "";
  let cursor = 0;
  for (const p of sorted) {
    if (typeof p.offset !== "number" || p.offset < cursor) continue;
    if (p.offset > body.length) break;
    out += body.slice(cursor, p.offset);
    out += `[${p.id}] `;
    cursor = p.offset;
  }
  out += body.slice(cursor);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// The catalog tools — output shapes mirror apps/mcp/src/tools.ts.
// (The five atlas_* tools live in ./atlas.ts and are routed in the factory.)
// ─────────────────────────────────────────────────────────────────────────

interface ListWorksArgs {
  era?: string;
  author?: string;
  language?: string;
  genre?: string;
  difficulty?: string;
}

async function list_works(corpus: BrowserCorpus, filter: ListWorksArgs = {}) {
  let works = await corpus.works();
  if (filter.era) {
    const e = filter.era.toLowerCase();
    works = works.filter((w) => w.era.toLowerCase() === e || w.era_slug === e);
  }
  if (filter.author) {
    const a = filter.author.toLowerCase();
    works = works.filter((w) => w.author.toLowerCase().includes(a) || w.author_slug.includes(a));
  }
  if (filter.language) {
    const l = filter.language.toLowerCase();
    works = works.filter((w) => w.language.toLowerCase() === l || w.language_slug === l);
  }
  if (filter.genre) {
    const g = filter.genre.toLowerCase();
    works = works.filter((w) => w.genre.toLowerCase() === g || w.genre_slug === g);
  }
  if (filter.difficulty) {
    const d = filter.difficulty.toLowerCase();
    works = works.filter((w) => (w.difficulty ?? "").toLowerCase() === d);
  }
  return {
    count: works.length,
    works: works.map((w) => ({
      slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      genre: w.genre,
      language: w.language,
      difficulty: w.difficulty,
      total_logical_chapters: w.total_logical_chapters,
      total_variant_entries: w.total_variant_entries,
      published_year: w.published_year,
      description: w.description,
    })),
  };
}

async function list_chapters(corpus: BrowserCorpus, work_slug: string) {
  const work = await corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);
  const chapters = await corpus.listChapters(work_slug);
  return {
    work_slug,
    work_title: work.title,
    author: work.author,
    chapter_count: chapters.length,
    chapters: chapters.map((c) => ({
      chapter_number: c.chapter_number,
      chapter_slug: c.chapter_slug,
      chapter_title: c.chapter_title,
      layout: c.layout,
      default_variant: c.default_variant,
      available_variants: c.variants.map((v) => v.content_type),
      variant_count: c.variants.length,
    })),
  };
}

async function get_metadata(corpus: BrowserCorpus, work_slug: string) {
  const work = await corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);
  const chapters = await corpus.listChapters(work_slug);
  const layoutCounts = chapters.reduce(
    (acc, c) => {
      acc[c.layout] = (acc[c.layout] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const variantTypeCounts = chapters
    .flatMap((c) => c.variants.map((v) => v.content_type))
    .reduce(
      (acc, t) => {
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  return {
    ...work,
    layouts: layoutCounts,
    variant_types: variantTypeCounts,
    chapters_overview: chapters.slice(0, 8).map((c) => ({
      chapter_number: c.chapter_number,
      chapter_title: c.chapter_title,
      layout: c.layout,
    })),
    chapter_count: chapters.length,
  };
}

async function read_chapter(
  corpus: BrowserCorpus,
  work_slug: string,
  chapter_number: number,
  variant?: "original" | "transliteration" | "translation",
) {
  const { meta, variant: v, body, frontmatter } = await corpus.readChapter(
    work_slug,
    chapter_number,
    variant,
  );
  const paragraphs = await corpus.readParagraphs(work_slug, meta.chapter_slug, v.file);
  const annotatedBody = annotateBodyWithParagraphIds(body, paragraphs);
  return {
    work_slug,
    work_title: meta.work_title,
    chapter_number,
    chapter_title: meta.chapter_title,
    chapter_slug: meta.chapter_slug,
    variant: v.content_type,
    variant_file: v.file,
    language: v.language,
    source_language: v.source_language,
    script: v.script,
    layout: meta.layout,
    word_count: v.word_count,
    paragraph_count: v.paragraph_count,
    source_url: v.source_url,
    available_variants: meta.variants.map((vv) => vv.content_type),
    frontmatter,
    body: annotatedBody,
    // Addition over apps/mcp/src/tools.ts: the demo's system prompt
    // (FALSAFA_SYSTEM_PROMPT) tells the model to cite a whole chapter via
    // read_chapter's `citation_url`. Bare chapter URL, no paragraph anchor.
    citation_url: urlForCitation({
      workSlug: work_slug,
      chapterSlug: meta.chapter_slug,
      variant: v.content_type,
    }),
  };
}

interface GetPassageArgs {
  work_slug?: string;
  chapter_number?: number;
  paragraph_ids?: string[];
  /** 2-element [start, end] array, 0-indexed, inclusive (schema enforces length 2). */
  paragraph_range?: number[];
  variant?: "original" | "transliteration" | "translation";
}

async function get_passage(corpus: BrowserCorpus, args: GetPassageArgs) {
  const { meta, variant: v } = await corpus.readChapter(
    args.work_slug!,
    args.chapter_number!,
    args.variant,
  );
  const paragraphs = await corpus.readParagraphs(args.work_slug!, meta.chapter_slug, v.file);
  let selected: ParagraphRecord[];
  if (args.paragraph_ids?.length) {
    const set = new Set(args.paragraph_ids);
    selected = paragraphs.filter((p) => set.has(p.id));
  } else if (args.paragraph_range) {
    const start = args.paragraph_range[0]!;
    const end = args.paragraph_range[1]!;
    if (start < 0 || end >= paragraphs.length || start > end) {
      throw new MCPError(
        "PASSAGE_OUT_OF_RANGE",
        `Paragraph range [${start}, ${end}] is invalid`,
        `Valid range for this variant: 0 to ${paragraphs.length - 1}`,
      );
    }
    selected = paragraphs.slice(start, end + 1);
  } else {
    throw new MCPError("BAD_QUERY", "get_passage requires either paragraph_ids or paragraph_range");
  }

  // Per-paragraph + aggregate deep links. Addition over apps/mcp/src/tools.ts:
  // the demo's system prompt reads `paragraphs[0].citation_url` (single
  // paragraph) and the top-level `citation_url` (multi-paragraph). apps/mcp's
  // get_passage names the array `passages` and carries no citation_url; the
  // browser demo needs the links baked in to build markdown footnotes.
  const stableIds = selected.map((p) => p.id).filter((id) => id.startsWith("p-"));
  const enriched = selected.map((p) => ({
    id: p.id,
    offset: p.offset,
    text: p.text,
    citation_url: urlForCitation({
      workSlug: args.work_slug!,
      chapterSlug: meta.chapter_slug,
      variant: v.content_type,
      paragraphIds: p.id.startsWith("p-") ? [p.id] : undefined,
    }),
  }));
  return {
    work_slug: args.work_slug,
    chapter_number: args.chapter_number,
    chapter_title: meta.chapter_title,
    variant: v.content_type,
    language: v.language,
    paragraph_count_total: paragraphs.length,
    paragraphs: enriched,
    citation_url: urlForCitation({
      workSlug: args.work_slug!,
      chapterSlug: meta.chapter_slug,
      variant: v.content_type,
      paragraphIds: stableIds.length > 0 ? stableIds : undefined,
    }),
  };
}

/**
 * Full-text passage search.
 *
 * Runs against the Pagefind index the site already publishes at /pagefind/
 * (see ./pagefindSearch.ts for why that index can produce citable paragraph
 * ids). Result rows match the installed MCP's FTS5 rows so the model sees one
 * shape either way.
 *
 * `metadataSearch` below is the fallback for the one case Pagefind can't
 * serve: an index that isn't there (a dev server that never ran `pagefind
 * --site dist`). It is also still the right tool for "works BY x" questions,
 * so the fallback response says which engine answered.
 */
async function search_corpus(
  corpus: BrowserCorpus,
  query: string,
  options: {
    limit?: number;
    scope?: "english" | "all";
    work_slug?: string;
    loader?: PagefindLoader;
  } = {},
) {
  const scope = options.scope ?? "english";
  if (!query || !query.trim()) {
    return { query, scope, engine: "pagefind" as const, count: 0, results: [] };
  }

  const fts = await searchPassages(query, {
    limit: options.limit,
    scope,
    work_slug: options.work_slug,
    loader: options.loader,
    resolveChapterNumber: (workSlug, chapterSlug) =>
      corpus.chapterNumberFor(workSlug, chapterSlug),
  });

  if (fts) {
    return {
      query,
      scope,
      engine: fts.engine,
      count: fts.hits.length,
      total_matches: fts.total_matches,
      results: fts.hits,
      ...(fts.auto_fallback ? { auto_fallback: fts.auto_fallback } : {}),
      note:
        fts.hits.length === 0
          ? "No passage matched. Pagefind requires EVERY word of the query to appear in the same chapter, and does not accept regex or placeholders — retry with a distinctive 2-3 word phrase. For catalog questions ('what works by X'), use list_works."
          : undefined,
    };
  }

  // Pagefind index unavailable — degrade to work-level metadata matching.
  const meta = await metadataSearch(corpus, query, { limit: options.limit, scope });
  return {
    ...meta,
    note:
      "Full-text index (/pagefind/) could not be loaded, so this fell back to work-level METADATA matches (title/author/genre/language/era) — NOT passage text. Say so if you rely on these results.",
  };
}

/**
 * Work-level metadata matching — ported from apps/mcp/src/tools.ts:
 * metadataSearch. Matches the query's word tokens against each work's title /
 * author / genre / language / era and ranks by distinct-token hits.
 */
async function metadataSearch(
  corpus: BrowserCorpus,
  query: string,
  options: { limit?: number; scope?: "english" | "all" } = {},
) {
  const scope = options.scope ?? "english";
  if (!query || !query.trim()) {
    return { query, scope, count: 0, results: [] };
  }
  const limit = options.limit ?? 30;
  const FIELDS = ["title", "author", "genre", "language", "era"] as const;
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length > 0);

  const scored: Array<{
    work: ManifestWork;
    hits: number;
    matchedTokens: Set<string>;
    matchedFields: Set<string>;
  }> = [];

  for (const w of await corpus.works()) {
    const haystacks = [w.title, w.author, w.genre, w.language, w.era].map((f) =>
      (f ?? "").toLowerCase(),
    );
    let hits = 0;
    const matchedTokens = new Set<string>();
    const matchedFields = new Set<string>();
    for (const tok of tokens) {
      for (let i = 0; i < haystacks.length; i++) {
        if (haystacks[i]!.includes(tok)) {
          hits++;
          matchedTokens.add(tok);
          matchedFields.add(FIELDS[i]!);
        }
      }
    }
    if (hits > 0) scored.push({ work: w, hits, matchedTokens, matchedFields });
  }

  scored.sort((a, b) => b.matchedTokens.size - a.matchedTokens.size || b.hits - a.hits);
  const results = scored.slice(0, limit).map((s) => ({
    work_slug: s.work.slug,
    work_title: s.work.title,
    author: s.work.author,
    era: s.work.era,
    genre: s.work.genre,
    language: s.work.language,
    matched_fields: [...s.matchedFields],
    matched_tokens: [...s.matchedTokens],
    score: s.hits,
  }));

  return {
    query,
    scope,
    engine: "metadata" as const,
    count: results.length,
    results,
  };
}

async function find_related(
  corpus: BrowserCorpus,
  work_slug: string,
  chapter_number?: number,
  limit = 5,
) {
  const work = await corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);

  const contentRelated: Array<{
    work_slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    relation: "content_similar";
    chapter_number: number;
    chapter_slug: string;
    score: number;
  }> = [];
  const contentWorkSlugs = new Set<string>();

  const xlinks = await corpus.crossLinks();
  if (xlinks && chapter_number !== undefined) {
    const chapters = await corpus.listChapters(work_slug);
    const meta = chapters.find((c) => c.chapter_number === chapter_number);
    if (meta) {
      const key = `${work_slug}/${meta.chapter_slug}`;
      const links = xlinks.links[key] ?? [];
      for (const l of links) {
        if (contentWorkSlugs.has(l.work_slug)) continue;
        const otherWork = await corpus.findWork(l.work_slug);
        if (!otherWork) continue;
        contentWorkSlugs.add(l.work_slug);
        contentRelated.push({
          work_slug: otherWork.slug,
          title: otherWork.title,
          author: otherWork.author,
          era: otherWork.era,
          genre: otherWork.genre,
          relation: "content_similar",
          chapter_number: l.chapter_number,
          chapter_slug: l.chapter_slug,
          score: l.score,
        });
      }
    }
  }

  const all = (await corpus.works()).filter((w) => w.slug !== work_slug);
  const sameAuthor = all.filter((w) => w.author === work.author);
  const sameEra = all.filter((w) => w.era === work.era && w.author !== work.author);
  const sameGenre = all.filter(
    (w) => w.genre === work.genre && w.author !== work.author && w.era !== work.era,
  );
  const structuralRanked = [...sameAuthor, ...sameEra, ...sameGenre];

  const merged: Array<{
    work_slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    relation: "content_similar" | "same_author" | "same_era" | "same_genre";
    chapter_number?: number;
    chapter_slug?: string;
    score?: number;
  }> = [...contentRelated];
  for (const w of structuralRanked) {
    if (merged.length >= limit) break;
    if (contentWorkSlugs.has(w.slug)) continue;
    merged.push({
      work_slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      genre: w.genre,
      relation:
        w.author === work.author ? "same_author" : w.era === work.era ? "same_era" : "same_genre",
    });
  }

  const final = merged.slice(0, limit);
  const usedContent = contentRelated.length > 0;

  return {
    work_slug,
    chapter_number: chapter_number ?? null,
    method: usedContent ? "tfidf_v1+structural" : "structural_v0",
    note: usedContent
      ? "Mix of content-based (TF-IDF cosine over English chapter bodies) and structural fallback."
      : xlinks
        ? "Structural fallback (chapter not indexed or chapter_number missing)."
        : "Structural fallback (cross-links index not built).",
    related: final,
  };
}

async function compare_works(
  corpus: BrowserCorpus,
  work_slug_a: string,
  work_slug_b: string,
  topic?: string,
) {
  const a = await corpus.findWork(work_slug_a);
  const b = await corpus.findWork(work_slug_b);
  if (!a) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug_a}`);
  if (!b) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug_b}`);

  const aChapters = await corpus.listChapters(work_slug_a);
  const bChapters = await corpus.listChapters(work_slug_b);

  let matchingA = aChapters.slice(0, 5);
  let matchingB = bChapters.slice(0, 5);
  if (topic) {
    // Now that search_corpus is real full-text search, the topic can pick the
    // chapters that actually discuss it — one work-scoped query per side. Each
    // still falls back to its opening chapters when the topic doesn't hit.
    const [aHits, bHits] = await Promise.all([
      search_corpus(corpus, topic, { scope: "english", limit: 5, work_slug: work_slug_a }),
      search_corpus(corpus, topic, { scope: "english", limit: 5, work_slug: work_slug_b }),
    ]);
    const aSet = new Set(
      aHits.results.map((r) => (r as { chapter_number?: number | null }).chapter_number),
    );
    const bSet = new Set(
      bHits.results.map((r) => (r as { chapter_number?: number | null }).chapter_number),
    );
    matchingA = aChapters.filter((c) => aSet.has(c.chapter_number));
    matchingB = bChapters.filter((c) => bSet.has(c.chapter_number));
    if (matchingA.length === 0) matchingA = aChapters.slice(0, 3);
    if (matchingB.length === 0) matchingB = bChapters.slice(0, 3);
  }

  return {
    topic: topic ?? null,
    note: "Returns relevant chapter pointers and metadata for both works. The host LLM does the actual comparison.",
    work_a: {
      slug: a.slug,
      title: a.title,
      author: a.author,
      era: a.era,
      genre: a.genre,
      language: a.language,
      relevant_chapters: matchingA.map((c) => ({
        chapter_number: c.chapter_number,
        chapter_title: c.chapter_title,
        layout: c.layout,
        default_variant: c.default_variant,
      })),
    },
    work_b: {
      slug: b.slug,
      title: b.title,
      author: b.author,
      era: b.era,
      genre: b.genre,
      language: b.language,
      relevant_chapters: matchingB.map((c) => ({
        chapter_number: c.chapter_number,
        chapter_title: c.chapter_title,
        layout: c.layout,
        default_variant: c.default_variant,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatcher + client factory
// ─────────────────────────────────────────────────────────────────────────

async function dispatch(
  corpus: BrowserCorpus,
  name: string,
  rawArgs: unknown,
  pagefindLoader?: PagefindLoader,
): Promise<unknown> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  switch (name) {
    case "list_works":
      return list_works(corpus, args as ListWorksArgs);
    case "list_chapters": {
      const workSlug = args["work_slug"] as string | undefined;
      if (!workSlug) throw new MCPError("BAD_QUERY", "list_chapters requires work_slug");
      return list_chapters(corpus, workSlug);
    }
    case "get_metadata": {
      const workSlug = args["work_slug"] as string | undefined;
      if (!workSlug) throw new MCPError("BAD_QUERY", "get_metadata requires work_slug");
      return get_metadata(corpus, workSlug);
    }
    case "read_chapter": {
      const workSlug = args["work_slug"] as string | undefined;
      const chapterNumber = args["chapter_number"] as number | undefined;
      if (!workSlug) throw new MCPError("BAD_QUERY", "read_chapter requires work_slug");
      if (typeof chapterNumber !== "number")
        throw new MCPError("BAD_QUERY", "read_chapter requires chapter_number");
      return read_chapter(
        corpus,
        workSlug,
        chapterNumber,
        args["variant"] as "original" | "transliteration" | "translation" | undefined,
      );
    }
    case "get_passage": {
      const workSlug = args["work_slug"] as string | undefined;
      const chapterNumber = args["chapter_number"] as number | undefined;
      if (!workSlug) throw new MCPError("BAD_QUERY", "get_passage requires work_slug");
      if (typeof chapterNumber !== "number")
        throw new MCPError("BAD_QUERY", "get_passage requires chapter_number");
      return get_passage(corpus, args as GetPassageArgs);
    }
    case "search_corpus": {
      const query = args["query"] as string | undefined;
      if (query === undefined) throw new MCPError("BAD_QUERY", "search_corpus requires query");
      return search_corpus(corpus, query, {
        limit: args["limit"] as number | undefined,
        scope: args["scope"] as "english" | "all" | undefined,
        work_slug: args["work_slug"] as string | undefined,
        loader: pagefindLoader,
      });
    }
    case "find_related": {
      const workSlug = args["work_slug"] as string | undefined;
      if (!workSlug) throw new MCPError("BAD_QUERY", "find_related requires work_slug");
      return find_related(
        corpus,
        workSlug,
        args["chapter_number"] as number | undefined,
        (args["limit"] as number | undefined) ?? 5,
      );
    }
    case "compare_works": {
      // apps/mcp / the demo schema use work_slug_a / work_slug_b; accept the
      // shorter work_a / work_b aliases defensively.
      const aSlug = (args["work_slug_a"] ?? args["work_a"]) as string | undefined;
      const bSlug = (args["work_slug_b"] ?? args["work_b"]) as string | undefined;
      if (!aSlug || !bSlug)
        throw new MCPError("BAD_QUERY", "compare_works requires work_slug_a and work_slug_b");
      return compare_works(corpus, aSlug, bSlug, args["topic"] as string | undefined);
    }
    default:
      throw new MCPError("BAD_QUERY", `Unknown Falsafa tool: ${name}`);
  }
}

/**
 * Build a client that runs the 8 Falsafa tools entirely in the browser by
 * fetching corpus files from `base` (default `/corpus/`, same-origin on
 * falsafa.ai). Same `{ invoke(name, args) }` interface as createMcpClient, so
 * makeOnToolCall (./mcpClient.ts) works on it unchanged. Never throws —
 * failures come back as a structured McpCallError.
 *
 * `fetchImpl` is exposed for tests / a Node harness (point it at a live CDN).
 */
export function createLocalMcpClient(
  base = "/corpus/",
  fetchImpl: FetchLike = globalThis.fetch,
  opts: { pagefindLoader?: PagefindLoader } = {},
) {
  const corpusBase = base.endsWith("/") ? base : base + "/";
  const corpus = new BrowserCorpus(corpusBase, fetchImpl);
  // The Atlas lives under the same corpus root (corpus/graph/atlas/), so one
  // base serves both. Its indexes are fetched lazily — a session that never
  // asks an Atlas question never downloads them.
  const atlas = createAtlasClient(corpusBase + "graph/atlas/", fetchImpl);
  return {
    baseURL: base,
    /** Live Atlas coverage, for the demo's system prompt. */
    atlasCoverage: () => atlas.coverage(),
    async invoke(toolName: string, toolArgs: unknown): Promise<McpCallResult | McpCallError> {
      try {
        const output = isAtlasTool(toolName)
          ? await atlas.dispatch(toolName, toolArgs)
          : await dispatch(corpus, toolName, toolArgs, opts.pagefindLoader);
        return { ok: true, output };
      } catch (err) {
        if (err instanceof MCPError || err instanceof AtlasError) {
          return { ok: false, error: err.hint ? `${err.message} — ${err.hint}` : err.message };
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
