/**
 * Pagefind-backed full-text passage search for the /try BYOK demo.
 *
 * The browser used to fall back to work-level METADATA matching (title /
 * author / genre / language / era) because scanning ~25k chapter files over
 * HTTP is impossible. But the site already ships a full-text index: `pagefind
 * --site dist` runs as part of `bun run build` (apps/site/package.json) and
 * publishes /pagefind/, which SearchDialog.astro already queries.
 *
 * Two properties of that index make real passage search possible here:
 *
 *   1. Chapter bodies are the indexed unit — ChapterBody.astro marks
 *      `data-pagefind-body` on `.reader-body`, so a hit is a chapter/variant
 *      page, and its URL is exactly the citation URL grammar
 *      (/works/{work}/{chapter}/{variant}/).
 *   2. Every reader paragraph carries `id="p-xxxxxx"`, and Pagefind records
 *      those as *anchors* with a word `location`. Matches also come back as
 *      word locations. Walking the anchors for the greatest location at or
 *      before a match yields the exact paragraph id — so a search hit is
 *      citable, not merely "somewhere on this page".
 *
 * Output rows mirror the installed MCP's FTS5 rows (apps/mcp/src/tools.ts:
 * work_slug, work_title, chapter_number, chapter_title, chapter_slug,
 * variant, language, paragraph_id, snippet) so the model sees the same shape
 * whether it is talking to `npx @falsafa/mcp` or to this in-page version. The
 * one addition is `citation_url`, which the demo's footnote citations need.
 */

import { urlForCitation } from "../../lib/citation-url";

// ─────────────────────────────────────────────────────────────────────────
// Pagefind's JS API (only the parts we use)
// ─────────────────────────────────────────────────────────────────────────

interface PagefindAnchor {
  element: string;
  id: string;
  text?: string;
  location: number;
}

interface PagefindFragment {
  url: string;
  raw_url?: string;
  excerpt: string;
  plain_excerpt?: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
  word_count: number;
  locations: number[];
  weighted_locations?: { weight: number; balanced_score: number; location: number }[];
  anchors: PagefindAnchor[];
}

interface PagefindSearchResult {
  id: string;
  data: () => Promise<PagefindFragment>;
}

export interface PagefindApi {
  options: (opts: Record<string, unknown>) => Promise<void>;
  search: (
    query: string,
    opts?: { filters?: Record<string, string[]> },
  ) => Promise<{ results: PagefindSearchResult[]; unfilteredResultCount?: number }>;
}

/**
 * Load /pagefind/pagefind.js.
 *
 * `new Function("return import(url)")` rather than a bare `import()` for the
 * same reason SearchDialog.astro does it: the index is a build artifact in
 * /public, Vite's static analyzer would try to resolve it at build time, and
 * Astro's dev server blocks dynamic imports of /public. The /try page's CSP
 * carries 'unsafe-eval' specifically to permit this (see try/index.astro) —
 * `connect-src` is what actually contains the page.
 *
 * Resolves to null (never throws) when the index is missing, e.g. a dev server
 * that has not run `pagefind --site dist` yet. Callers fall back to metadata
 * search and say so in the response.
 */
export type PagefindLoader = () => Promise<PagefindApi | null>;

export const defaultPagefindLoader: PagefindLoader = async () => {
  try {
    const dynImport = new Function("url", "return import(/* @vite-ignore */ url)") as (
      url: string,
    ) => Promise<unknown>;
    const api = (await dynImport("/pagefind/pagefind.js")) as PagefindApi;
    await api.options({ excerptLength: 30 });
    return api;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Result rows
// ─────────────────────────────────────────────────────────────────────────

export interface PassageHit {
  work_slug: string;
  work_title: string;
  chapter_number: number | null;
  chapter_title: string;
  chapter_slug: string;
  variant: string;
  language: string | null;
  paragraph_id: string | null;
  snippet: string;
  citation_url: string;
}

export interface SearchPassagesOptions {
  limit?: number;
  scope?: "english" | "all";
  work_slug?: string;
  /** Resolve a chapter slug to its logical chapter_number (mcp-index lookup). */
  resolveChapterNumber?: (workSlug: string, chapterSlug: string) => Promise<number | null>;
  loader?: PagefindLoader;
}

export interface SearchPassagesResult {
  engine: "pagefind";
  hits: PassageHit[];
  /** Total Pagefind matches before the scope/limit trim. */
  total_matches: number;
  /** Set when the long-query retry kicked in — mirrors apps/mcp's field. */
  auto_fallback?: { original_query: string; retried_with: string };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Pagefind results to consider per requested hit before giving up on the
 *  scope filter. Keeps `data()` fetches bounded on broad queries. */
const OVERSCAN = 4;

/** The default loader's result is memoized for the page's lifetime: loading
 *  pagefind.js twice would fetch the whole entry chunk again. An injected
 *  loader (tests) is never cached, so a stub can't leak into real use. */
let cachedApi: PagefindApi | null | undefined;

/** Drop the memoized default API. Tests only. */
export function resetPagefindCache(): void {
  cachedApi = undefined;
}

async function getApi(loader: PagefindLoader): Promise<PagefindApi | null> {
  if (loader !== defaultPagefindLoader) return loader();
  if (cachedApi === undefined) cachedApi = await loader();
  return cachedApi;
}

/**
 * Full-text passage search. Returns null when the Pagefind index could not be
 * loaded at all — the caller then falls back to metadata search.
 */
export async function searchPassages(
  query: string,
  options: SearchPassagesOptions = {},
): Promise<SearchPassagesResult | null> {
  const api = await getApi(options.loader ?? defaultPagefindLoader);
  if (!api) return null;

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const scope = options.scope ?? "english";

  let results = (await api.search(query)).results;
  let autoFallback: SearchPassagesResult["auto_fallback"];

  // Pagefind is AND across terms, so a long paraphrased query reliably
  // returns nothing. Same remedy the installed MCP applies: retry with the
  // longest (proxy for rarest) tokens and report that we did.
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (results.length === 0 && tokens.length > 5) {
    const retry = [...tokens]
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
      .join(" ");
    const retried = (await api.search(retry)).results;
    if (retried.length > 0) {
      results = retried;
      autoFallback = { original_query: query, retried_with: retry };
    }
  }

  const hits: PassageHit[] = [];
  const budget = Math.min(results.length, limit * OVERSCAN);

  for (let i = 0; i < budget && hits.length < limit; i++) {
    let fragment: PagefindFragment;
    try {
      fragment = await results[i]!.data();
    } catch {
      continue; // a single unreadable fragment shouldn't sink the query
    }
    const hit = toHit(fragment, scope, options.work_slug);
    if (hit) hits.push(hit);
  }

  if (options.resolveChapterNumber) {
    await Promise.all(
      hits.map(async (h) => {
        h.chapter_number = await options.resolveChapterNumber!(h.work_slug, h.chapter_slug);
      }),
    );
  }

  return {
    engine: "pagefind",
    hits,
    total_matches: results.length,
    ...(autoFallback ? { auto_fallback: autoFallback } : {}),
  };
}

/** Convert one Pagefind fragment into a citable passage hit, or null when it
 *  is not a chapter page / fails the scope filter. */
function toHit(
  fragment: PagefindFragment,
  scope: "english" | "all",
  workSlugFilter?: string,
): PassageHit | null {
  const route = parseChapterRoute(fragment.url);
  if (!route) return null;
  if (workSlugFilter && route.workSlug !== workSlugFilter) return null;

  const language = fragment.filters?.["language"]?.[0] ?? null;
  if (scope === "english" && route.variant !== "translation" && language !== "English") {
    return null;
  }

  const paragraphId = paragraphForMatch(fragment);

  return {
    work_slug: route.workSlug,
    work_title: fragment.meta?.["work"] ?? route.workSlug,
    // Filled in by the caller when a resolver is supplied; the slug is the
    // authoritative handle either way (read_chapter takes a number, so a null
    // here tells the model to call list_chapters).
    chapter_number: null,
    chapter_title: fragment.meta?.["title"] ?? route.chapterSlug,
    chapter_slug: route.chapterSlug,
    variant: route.variant,
    language,
    paragraph_id: paragraphId,
    snippet: plainSnippet(fragment),
    citation_url: urlForCitation({
      workSlug: route.workSlug,
      chapterSlug: route.chapterSlug,
      variant: route.variant,
      paragraphIds: paragraphId ? [paragraphId] : undefined,
    }),
  };
}

/** /works/{work}/{chapter}/{variant}/ → its three parts, or null. */
function parseChapterRoute(
  url: string,
): { workSlug: string; chapterSlug: string; variant: string } | null {
  const path = url.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[0] !== "works") return null;
  return { workSlug: segments[1]!, chapterSlug: segments[2]!, variant: segments[3]! };
}

/**
 * The paragraph containing the best match: the `p-` anchor with the greatest
 * location at or before the first (highest-weighted) match location. Anchors
 * come back in document order but sorting defensively costs nothing.
 */
function paragraphForMatch(fragment: PagefindFragment): string | null {
  const anchors = (fragment.anchors ?? [])
    .filter((a) => typeof a.location === "number" && a.id?.startsWith("p-"))
    .sort((a, b) => a.location - b.location);
  if (anchors.length === 0) return null;

  const matchLocation =
    fragment.weighted_locations?.[0]?.location ?? fragment.locations?.[0] ?? 0;

  let best: PagefindAnchor | null = null;
  for (const a of anchors) {
    if (a.location <= matchLocation) best = a;
    else break;
  }
  // A match before the first anchor still belongs to the first paragraph.
  return (best ?? anchors[0]!).id;
}

/** Pagefind's excerpt wraps matches in <mark>; the model wants plain text. */
function plainSnippet(fragment: PagefindFragment): string {
  const raw = fragment.plain_excerpt ?? fragment.excerpt ?? "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
