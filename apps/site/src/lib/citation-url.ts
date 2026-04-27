/**
 * citation-url — pure helpers for building and parsing chapter URLs
 * with paragraph citations.
 *
 * Why this lives in its own file:
 *   Three places need the same URL grammar:
 *     1. browser-bundled MCP tools (read_chapter, get_passage) — emit
 *        citation_url so the model has a ready-made link to drop into
 *        its markdown footnotes.
 *     2. ChapterBody.astro — needs to parse the URL on page load to
 *        find which paragraphs to highlight.
 *     3. The defensive linkifier in MarkdownView — when the model
 *        leaks a raw "p-xxxxxx" instead of a footnote, we use the
 *        paragraph-index phone book + this helper to repair the
 *        citation into a real link.
 *
 *   One source of truth for the URL grammar means a route change
 *   touches one file, not three.
 *
 * URL grammar (locked by /plan-eng-review run 2):
 *
 *   • Bare chapter:        /works/{work}/{chapter}/{variant}/
 *   • Single paragraph:    /works/{work}/{chapter}/{variant}/#p-x
 *   • Multiple paragraphs: /works/{work}/{chapter}/{variant}/?paragraphs=p-1,p-2,p-3#p-1
 *
 *   Multi-paragraph: the query string lists ALL paragraphs to highlight;
 *   the hash names the FIRST one (which is what the browser scrolls to).
 *
 *   The trailing slash on the variant segment is required: Astro is
 *   configured with `trailingSlash: "always"` (apps/site/astro.config.mjs),
 *   so chapter pages physically live at /works/.../translation/ — fetches
 *   without the slash 404. The slash MUST come before the `#` or `?`,
 *   otherwise the browser sends e.g. `/works/.../translation#p-x` which
 *   strips the hash on the server side and looks up `/works/.../translation`,
 *   which doesn't exist on disk.
 *
 * Why query string + hash for multi-paragraph:
 *   The browser scrolls to whatever's in the hash for free. We need
 *   the full list separately because the hash can only name one anchor,
 *   and a citation may legitimately span "paragraphs 4–6" or "paragraphs
 *   2, 7, and 12".
 */

/**
 * Information needed to construct a citation URL.
 *
 * `paragraphIds`:
 *   - undefined / [] → bare chapter URL, no highlight
 *   - [single]       → hash-only URL: scroll to + highlight one paragraph
 *   - [multiple]     → query + hash URL: highlight all, scroll to first
 *
 * `variant` is the chapter route segment (= meta.json content_type:
 * "original", "translation", "transliteration", etc.). NOT the file
 * basename — see corpus/paragraph-index.json for the same convention.
 */
export interface CitationTarget {
  workSlug: string;
  chapterSlug: string;
  variant: string;
  paragraphIds?: string[];
}

/**
 * Build a chapter URL with optional paragraph anchors.
 * Returns a relative path string (no origin) so it works whether the
 * site is served from a custom domain, a Vercel preview, or localhost.
 */
export function urlForCitation(target: CitationTarget): string {
  // Trailing slash is required — Astro's `trailingSlash: "always"` config
  // means /works/.../translation 404s, /works/.../translation/ 200s.
  const base = `/works/${encodeURIComponent(target.workSlug)}/${encodeURIComponent(target.chapterSlug)}/${encodeURIComponent(target.variant)}/`;
  const ids = (target.paragraphIds ?? []).filter((id) => id && id.startsWith("p-"));

  if (ids.length === 0) return base;
  if (ids.length === 1) return `${base}#${ids[0]}`;

  // Multi-paragraph: query lists all, hash names the first (scroll target).
  const query = `paragraphs=${ids.map(encodeURIComponent).join(",")}`;
  return `${base}?${query}#${ids[0]}`;
}

/**
 * Parsed result of a chapter URL with optional paragraph citation.
 *
 * Returns `null` from parseCitationUrl when the URL doesn't match the
 * /works/{slug}/{chapter}/{variant} shape — let callers decide whether
 * that's an error or just a different page.
 */
export interface ParsedCitation {
  workSlug: string;
  chapterSlug: string;
  variant: string;
  /**
   * All paragraph IDs to highlight. May be empty (bare chapter URL),
   * length 1 (hash-only), or length >1 (query + hash).
   */
  paragraphIds: string[];
  /**
   * The single paragraph ID to scroll to, if any. Pulled from the URL
   * fragment. May be `null` when no fragment is present.
   */
  scrollTarget: string | null;
}

/**
 * Parse a chapter URL into its parts. Accepts either:
 *   - A full URL (https://example.com/works/foo/bar/translation#p-x)
 *   - A relative path (/works/foo/bar/translation?paragraphs=p-1,p-2#p-1)
 *
 * Returns `null` if the path doesn't match the chapter route shape.
 */
export function parseCitationUrl(url: string): ParsedCitation | null {
  // URL constructor needs a base for relative paths; the base origin is
  // discarded since we only return path-derived data.
  let parsed: URL;
  try {
    parsed = new URL(url, "http://_placeholder_");
  } catch {
    return null;
  }

  // Match /works/{slug}/{chapter}/{variant} (4 segments after split).
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== "works") return null;

  const [, workSlug, chapterSlug, variant] = segments as [string, string, string, string];

  // Extract paragraphs from query first (multi-paragraph case).
  const queryIds = (parsed.searchParams.get("paragraphs") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("p-"));

  // Extract scroll target from fragment.
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const scrollTarget = fragment.startsWith("p-") ? fragment : null;

  // Reconcile: if query has IDs, those are the highlight set. Otherwise
  // the fragment alone (if it names a paragraph) is the singleton set.
  let paragraphIds: string[];
  if (queryIds.length > 0) {
    paragraphIds = queryIds;
  } else if (scrollTarget) {
    paragraphIds = [scrollTarget];
  } else {
    paragraphIds = [];
  }

  return {
    workSlug: decodeURIComponent(workSlug),
    chapterSlug: decodeURIComponent(chapterSlug),
    variant: decodeURIComponent(variant),
    paragraphIds,
    scrollTarget,
  };
}
