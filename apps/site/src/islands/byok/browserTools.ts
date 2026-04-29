/**
 * Browser-side implementations of the 8 Falsafa MCP librarian tools.
 *
 * Each function takes the same args shape as apps/mcp/src/tools.ts
 * (so the LLM sees identical contracts whether it's calling stdio MCP
 * or this browser-bundled version) and returns the same JSON shape.
 *
 * Search uses Pagefind (already built into the site for the global
 * search bar). Cross-link discovery uses the precomputed cross-links.json.
 *
 * No network roundtrips except same-origin fetches of static corpus
 * files. Fits the static-deployment model exactly.
 */

import {
  loadManifest,
  loadWorkIndex,
  listChapterMetas,
  getChapterMeta,
  readChapterBody,
  readParagraphs,
  loadCrossLinks,
  type ManifestWork,
  type ChapterMeta,
} from "./browserCorpus";
import { urlForCitation } from "../../lib/citation-url";

/**
 * Map a chapter's variant file (e.g. "translation-2.md") back to its
 * URL-friendly content_type ("translation"). The route at
 * /works/[slug]/[chapter]/[variant] uses content_type, not file
 * basename — they usually match but a few chapters have files like
 * `translation-2.md` whose content_type is still "translation".
 *
 * Falls back to the file basename if the variant isn't in the meta —
 * the URL would 404, but at least it's a deterministic value.
 */
function variantContentTypeFor(meta: ChapterMeta, variantFile: string): string {
  const v = meta.variants.find((vv) => vv.file === variantFile);
  return v?.content_type ?? variantFile.replace(/\.md$/, "");
}

// ── Tool dispatcher ────────────────────────────────────────────────────

/**
 * Single entry point — the BYOK demo's `onToolCall` callback dispatches
 * here. Maps tool name to the implementation, runs it, and returns
 * JSON-serializable output. Throws on unknown tool names or runtime
 * errors so the AI SDK can surface them to the model as tool errors.
 */
export async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  const argsObj = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "list_works":
      return listWorks(argsObj);
    case "list_chapters":
      return listChapters(argsObj);
    case "get_metadata":
      return getMetadata(argsObj);
    case "read_chapter":
      return readChapter(argsObj);
    case "get_passage":
      return getPassage(argsObj);
    case "search_corpus":
      return searchCorpus(argsObj);
    case "find_related":
      return findRelated(argsObj);
    case "compare_works":
      return compareWorks(argsObj);
    default:
      throw new Error(`Unknown Falsafa tool: ${name}`);
  }
}

// ── list_works ─────────────────────────────────────────────────────────

interface ListWorksArgs {
  author?: string;
  era?: string;
  language?: string;
  genre?: string;
}

async function listWorks(args: ListWorksArgs): Promise<{ works: Array<Pick<ManifestWork, "slug" | "title" | "author" | "era" | "language" | "genre" | "total_logical_chapters">> }> {
  const manifest = await loadManifest();
  const filters = {
    author: norm(args.author),
    era: norm(args.era),
    language: norm(args.language),
    genre: norm(args.genre),
  };
  const works = manifest.works
    .filter((w) => {
      if (filters.author && !norm(w.author).includes(filters.author) && norm(w.author_slug) !== filters.author)
        return false;
      if (filters.era && norm(w.era) !== filters.era && norm(w.era_slug) !== filters.era)
        return false;
      if (filters.language && norm(w.language) !== filters.language && norm(w.language_slug) !== filters.language)
        return false;
      if (filters.genre && norm(w.genre) !== filters.genre && norm(w.genre_slug) !== filters.genre)
        return false;
      return true;
    })
    .map((w) => ({
      slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      language: w.language,
      genre: w.genre,
      total_logical_chapters: w.total_logical_chapters,
    }));
  return { works };
}

// ── list_chapters ──────────────────────────────────────────────────────

interface ListChaptersArgs {
  work_slug?: string;
}

async function listChapters(
  args: ListChaptersArgs,
): Promise<{
  work_slug: string;
  chapters: Array<{ chapter_number: number; title: string; default_variant: string; variants: string[] }>;
}> {
  if (!args.work_slug) throw new Error("list_chapters: missing required arg work_slug");
  const metas = await listChapterMetas(args.work_slug);
  return {
    work_slug: args.work_slug,
    chapters: metas.map((m) => ({
      chapter_number: m.chapter_number,
      title: m.title,
      default_variant: m.default_variant,
      variants: m.variants.map((v) => v.content_type),
    })),
  };
}

// ── get_metadata ───────────────────────────────────────────────────────

interface GetMetadataArgs {
  work_slug?: string;
}

async function getMetadata(
  args: GetMetadataArgs,
): Promise<{ work: ManifestWork; index: string }> {
  if (!args.work_slug) throw new Error("get_metadata: missing required arg work_slug");
  const manifest = await loadManifest();
  const work = manifest.works.find((w) => w.slug === args.work_slug);
  if (!work) throw new Error(`work not found: ${args.work_slug}`);
  const indexMd = await loadWorkIndex(args.work_slug);
  return { work, index: extractIndexProse(indexMd) };
}

// ── read_chapter ───────────────────────────────────────────────────────

interface ReadChapterArgs {
  work_slug?: string;
  chapter_number?: number;
  variant?: "original" | "transliteration" | "translation";
}

async function readChapter(
  args: ReadChapterArgs,
): Promise<{
  work_slug: string;
  chapter_number: number;
  chapter_slug: string;
  variant: string;
  title: string;
  body: string;
  /**
   * Bare chapter URL — the model should drop this in markdown footnotes
   * so readers can click through to the source. Format:
   *   /works/{work}/{chapter}/{variant}
   * For paragraph-anchored citations, prefer get_passage which returns
   * a URL with #p-x or ?paragraphs= already attached.
   */
  citation_url: string;
}> {
  if (!args.work_slug) throw new Error("read_chapter: missing required arg work_slug");
  if (typeof args.chapter_number !== "number")
    throw new Error("read_chapter: missing required arg chapter_number");
  const { meta, body, variantFile } = await readChapterBody(
    args.work_slug,
    args.chapter_number,
    args.variant,
  );
  const variantCT = variantContentTypeFor(meta, variantFile);
  // Annotate body with [p-xxxxxx] markers so the model can cite by
  // paragraph hash without guessing. Mirrors the stdio MCP fix at
  // apps/mcp/src/tools.ts (commit b6a13ac). Without this, the model
  // sees no per-paragraph hashes and either invents them or falls
  // back to inline verse markers (e.g. "Mn_1.52") that don't resolve.
  const paragraphs = await readParagraphs(args.work_slug, meta.chapter_number, variantFile);
  const annotatedBody = annotateBodyWithParagraphIds(body, paragraphs);
  return {
    work_slug: args.work_slug,
    chapter_number: meta.chapter_number,
    chapter_slug: meta.chapter_slug,
    variant: variantCT,
    title: meta.title,
    body: annotatedBody,
    citation_url: urlForCitation({
      workSlug: args.work_slug,
      chapterSlug: meta.chapter_slug,
      variant: variantCT,
    }),
  };
}

/**
 * Inject [p-xxxxxx] prefixes at each paragraph's offset in the body.
 * Direct port of apps/mcp/src/tools.ts:annotateBodyWithParagraphIds
 * (commit b6a13ac). If the sidecar is empty (no per-paragraph index),
 * returns the body unchanged. Offsets that fall outside the body are
 * silently skipped — those paragraphs lose annotation but the body
 * stays intact.
 *
 * The marker format [p-xxxxxx] matches the convention used by the
 * BYOK demo's defensive linkifier (defensive-linkify.ts), so a
 * paragraph_id surfaced here flows unchanged through the model into
 * a citation.
 */
function annotateBodyWithParagraphIds(
  body: string,
  paragraphs: ReadonlyArray<{ paragraph_id: string; offset: number }>,
): string {
  if (paragraphs.length === 0) return body;
  const sorted = [...paragraphs].sort((a, b) => a.offset - b.offset);
  let out = "";
  let cursor = 0;
  for (const p of sorted) {
    if (typeof p.offset !== "number" || p.offset < cursor) continue;
    if (p.offset > body.length) break;
    out += body.slice(cursor, p.offset);
    out += `[${p.paragraph_id}] `;
    cursor = p.offset;
  }
  out += body.slice(cursor);
  return out;
}

// ── get_passage ────────────────────────────────────────────────────────

interface GetPassageArgs {
  work_slug?: string;
  chapter_number?: number;
  paragraph_ids?: string[];
  /** 2-element [start, end] array, 0-indexed, inclusive. Schema enforces length 2. */
  paragraph_range?: number[];
  variant?: "original" | "transliteration" | "translation";
}

async function getPassage(args: GetPassageArgs): Promise<{
  work_slug: string;
  chapter_number: number;
  chapter_slug: string;
  variant: string;
  paragraphs: Array<{
    paragraph_id: string;
    index: number;
    text: string;
    /** Per-paragraph deep link — single-paragraph citation URL.
     *  Drop this directly into a markdown footnote like
     *  `[^1]: ... See [paragraph](url)`. */
    citation_url: string;
  }>;
  /** Aggregate URL highlighting ALL returned paragraphs. Use this when
   *  the answer references the whole passage as one citation rather
   *  than per-paragraph. */
  citation_url: string;
  source: "sidecar" | "body-split";
}> {
  if (!args.work_slug) throw new Error("get_passage: missing required arg work_slug");
  if (typeof args.chapter_number !== "number")
    throw new Error("get_passage: missing required arg chapter_number");

  const meta = await getChapterMeta(args.work_slug, args.chapter_number);
  const variantFile = args.variant
    ? meta.variants.find((v) => v.content_type === args.variant)?.file
    : meta.default_variant;
  if (!variantFile) throw new Error(`variant not found for ${args.work_slug}/${args.chapter_number}`);
  const variantCT = variantContentTypeFor(meta, variantFile);

  // Prefer the precomputed paragraphs.json sidecar — it has stable
  // paragraph_ids the model can cite back to. Fall back to splitting
  // the body on blank lines if the sidecar is missing or empty (some
  // variants ship without a sidecar). The fallback's paragraph_ids are
  // synthetic but still cite-able.
  let records = await readParagraphs(args.work_slug, args.chapter_number, variantFile);
  let source: "sidecar" | "body-split" = "sidecar";

  if (records.length === 0) {
    const { body } = await readChapterBody(
      args.work_slug,
      args.chapter_number,
      args.variant,
    );
    records = splitIntoParagraphs(body, args.work_slug, meta.chapter_number);
    source = "body-split";
  }

  let selected: typeof records = [];
  if (args.paragraph_ids && args.paragraph_ids.length > 0) {
    const set = new Set(args.paragraph_ids);
    selected = records.filter((r) => set.has(r.paragraph_id));
  } else if (args.paragraph_range) {
    const [start, end] = args.paragraph_range;
    selected = records.filter((r) => r.index >= start && r.index <= end);
  } else {
    // No selector → return first 8 paragraphs as a sensible default.
    selected = records.slice(0, 8);
  }

  // Decorate each paragraph with its single-paragraph deep link.
  // body-split fallback paragraph_ids look like "work/c1/p3" rather than
  // "p-xxxxxx" — those won't match a chapter anchor, so emit a bare
  // chapter URL for those instead of a broken hash.
  const paragraphs = selected.map((r) => {
    const isStableId = r.paragraph_id.startsWith("p-");
    return {
      ...r,
      citation_url: urlForCitation({
        workSlug: args.work_slug!,
        chapterSlug: meta.chapter_slug,
        variant: variantCT,
        paragraphIds: isStableId ? [r.paragraph_id] : undefined,
      }),
    };
  });

  // Aggregate URL: highlight every selected paragraph, scroll to first.
  const stableIds = selected
    .map((r) => r.paragraph_id)
    .filter((id) => id.startsWith("p-"));
  const aggregateCitationUrl = urlForCitation({
    workSlug: args.work_slug,
    chapterSlug: meta.chapter_slug,
    variant: variantCT,
    paragraphIds: stableIds.length > 0 ? stableIds : undefined,
  });

  return {
    work_slug: args.work_slug,
    chapter_number: meta.chapter_number,
    chapter_slug: meta.chapter_slug,
    variant: variantCT,
    paragraphs,
    citation_url: aggregateCitationUrl,
    source,
  };
}

/**
 * Split a chapter body into paragraph records. Paragraphs are separated
 * by one or more blank lines. Markdown headings and very short standalone
 * lines (e.g., metric notation) are preserved as their own paragraphs so
 * the model can cite them.
 */
function splitIntoParagraphs(
  body: string,
  workSlug: string,
  chapterNumber: number,
): Array<{ paragraph_id: string; index: number; text: string }> {
  const blocks = body.split(/\n\s*\n+/g);
  const out: Array<{ paragraph_id: string; index: number; text: string }> = [];
  let i = 0;
  for (const block of blocks) {
    const text = block.trim();
    if (!text) continue;
    out.push({
      paragraph_id: `${workSlug}/c${chapterNumber}/p${i}`,
      index: i,
      text,
    });
    i++;
  }
  return out;
}

// ── search_corpus ──────────────────────────────────────────────────────
// Uses Pagefind (already built for the site's global search). The Pagefind
// index lives at /pagefind/pagefind.js; we lazy-load it on first call.

interface SearchCorpusArgs {
  query?: string;
  limit?: number;
}

interface PagefindResultItem {
  id: string;
  data: () => Promise<{
    url: string;
    excerpt: string;
    meta?: { title?: string };
    filters?: Record<string, string[]>;
  }>;
}

interface PagefindAPI {
  search(query: string): Promise<{ results: PagefindResultItem[] }>;
}

let cachedPagefind: PagefindAPI | null = null;

/**
 * Lazy-load Pagefind once per page. Don't cache failures — the user might
 * build the search index between calls (`bun run search:build`), so we
 * retry on every search until we get a handle.
 *
 * The new Function() trick bypasses two layers of static analysis:
 * Astro's dev-server block on importing /public/ files, and Vite's URL
 * resolver. The /pagefind/pagefind.js URL is a runtime path the browser
 * fetches directly. Pattern recommended by Pagefind itself.
 */
async function loadPagefind(): Promise<PagefindAPI | null> {
  if (cachedPagefind) return cachedPagefind;
  try {
    // The /pagefind/ index is generated by `bun run search:build` into
    // apps/site/public/pagefind/. Astro's dev server intentionally
    // intercepts dynamic-imports of /public/ files, and Vite's static
    // analyzer follows even non-literal import() URLs. The only
    // reliable bypass is `new Function()` to construct a runtime-only
    // import call that Vite/Astro can't see at all.
    //
    // CSP requirement: this needs `script-src 'unsafe-eval'` on /try.
    // The page's CSP whitelists eval to allow exactly this pattern;
    // see apps/site/src/pages/try/index.astro for the rationale.
    //
    // Same pattern Pagefind itself recommends in its framework docs.
    const dynImport = new Function(
      "url",
      "return import(/* @vite-ignore */ url)",
    ) as (url: string) => Promise<PagefindAPI>;
    const mod = await dynImport("/pagefind/pagefind.js");
    cachedPagefind = mod;
    return mod;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[falsafa] pagefind load failed:", err);
    }
    return null;
  }
}

async function searchCorpus(args: SearchCorpusArgs): Promise<{
  query: string;
  total: number;
  results: Array<{
    work_slug: string | null;
    chapter_number: number | null;
    title: string | null;
    url: string;
    excerpt: string;
  }>;
  /** Diagnostic — set when the index isn't built. The model can react. */
  index_status?: "missing" | "ready";
  hint?: string;
}> {
  const query = (args.query ?? "").trim();
  if (!query) throw new Error("search_corpus: missing required arg query");
  const limit = Math.max(1, Math.min(args.limit ?? 8, 25));

  const pf = await loadPagefind();
  if (!pf) {
    // The Pagefind index lives at /pagefind/pagefind.js, generated by the
    // pagefind CLI during `bun run build`. In dev mode (`bun run dev`)
    // it doesn't exist unless the user ran `bun run search:build` once.
    // Return a clearly-flagged result so the model can fall back to
    // direct read_chapter / list_works rather than retrying with more
    // queries that will all return 0.
    return {
      query,
      total: 0,
      results: [],
      index_status: "missing",
      hint:
        "Search index isn't built in this environment. Use list_works + read_chapter / get_passage to navigate the corpus directly. Don't keep retrying search_corpus with different queries — every call will return 0 until the index is built.",
    };
  }

  const out = await pf.search(query);
  const top = out.results.slice(0, limit);
  const results = await Promise.all(
    top.map(async (r) => {
      const data = await r.data();
      const { workSlug, chapterNumber } = parseChapterUrl(data.url);
      return {
        work_slug: workSlug,
        chapter_number: chapterNumber,
        title: data.meta?.title ?? null,
        url: data.url,
        excerpt: data.excerpt,
      };
    }),
  );
  return { query, total: out.results.length, results, index_status: "ready" };
}

function parseChapterUrl(url: string): {
  workSlug: string | null;
  chapterNumber: number | null;
} {
  // Pagefind returns site URLs of the form:
  //   /works/<work-slug>/                                  → work index
  //   /works/<work-slug>/<NN>-<chapter-slug>/              → chapter
  //   /works/<work-slug>/<NN>-<chapter-slug>/<variant>/    → specific variant page
  // Pull the work slug and chapter number out, ignoring the trailing
  // variant segment if present.
  const m = url.match(/\/works\/([^/]+)(?:\/(\d+)[^/]*)?(?:\/[^/]+)?\/?$/);
  if (!m) return { workSlug: null, chapterNumber: null };
  const workSlug = m[1] ?? null;
  const numStr = m[2];
  if (!numStr) return { workSlug, chapterNumber: null };
  const num = parseInt(numStr, 10);
  return { workSlug, chapterNumber: Number.isNaN(num) ? null : num };
}

// ── find_related ───────────────────────────────────────────────────────

interface FindRelatedArgs {
  work_slug?: string;
  chapter_number?: number;
  limit?: number;
}

async function findRelated(args: FindRelatedArgs): Promise<{
  source: { work_slug: string; chapter_number: number | null };
  related: Array<{ work_slug: string; chapter_number: number; score: number; title?: string }>;
}> {
  if (!args.work_slug) throw new Error("find_related: missing required arg work_slug");
  const limit = Math.max(1, Math.min(args.limit ?? 5, 20));

  const links = (await loadCrossLinks()) as Record<
    string,
    Array<{ target: string; score: number; chapter_number?: number; title?: string }>
  >;

  // Look up by exact work or work+chapter key. The cross-links.json
  // emitted by scripts/cross-link.ts uses keys like "work_slug" or
  // "work_slug:chapter_number" — try both.
  const chapterKey =
    args.chapter_number !== undefined
      ? `${args.work_slug}:${args.chapter_number}`
      : null;
  const list = (chapterKey && links[chapterKey]) || links[args.work_slug] || [];

  const related = list.slice(0, limit).map((entry) => {
    const [tslug, tchap] = entry.target.split(":");
    return {
      work_slug: tslug ?? entry.target,
      chapter_number: tchap ? parseInt(tchap, 10) : entry.chapter_number ?? 0,
      score: entry.score,
      title: entry.title,
    };
  });

  return {
    source: {
      work_slug: args.work_slug,
      chapter_number: args.chapter_number ?? null,
    },
    related,
  };
}

// ── compare_works ──────────────────────────────────────────────────────
// Returns metadata + a small sample of chapter pointers from each work.
// The host LLM does the actual comparison reasoning.

interface CompareWorksArgs {
  work_slug_a?: string;
  work_slug_b?: string;
  topic?: string;
}

async function compareWorks(args: CompareWorksArgs): Promise<{
  topic: string | null;
  a: { work: ManifestWork; chapters: ChapterMeta[] };
  b: { work: ManifestWork; chapters: ChapterMeta[] };
}> {
  if (!args.work_slug_a || !args.work_slug_b)
    throw new Error("compare_works: missing required args work_slug_a and work_slug_b");

  const manifest = await loadManifest();
  const a = manifest.works.find((w) => w.slug === args.work_slug_a);
  const b = manifest.works.find((w) => w.slug === args.work_slug_b);
  if (!a) throw new Error(`work_slug_a not found: ${args.work_slug_a}`);
  if (!b) throw new Error(`work_slug_b not found: ${args.work_slug_b}`);

  const aChapters = await listChapterMetas(args.work_slug_a);
  const bChapters = await listChapterMetas(args.work_slug_b);

  // No topic-aware filtering yet; LLM picks chapters from the lists.
  // Passing the first 6 chapters of each as an opinionated pointer
  // sample. (Topic search lands when search_corpus + filtering matures.)
  return {
    topic: args.topic ?? null,
    a: { work: a, chapters: aChapters.slice(0, 6) },
    b: { work: b, chapters: bChapters.slice(0, 6) },
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function norm(s?: string): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, "-");
}

const INDEX_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
function extractIndexProse(md: string): string {
  return md.replace(INDEX_FRONTMATTER_RE, "").trim();
}
