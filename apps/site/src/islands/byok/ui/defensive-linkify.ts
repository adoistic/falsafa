/**
 * defensive-linkify — repair raw "p-xxxxxx" leaks in model output.
 *
 * Why this exists:
 *   The system prompt forbids the model from emitting raw paragraph
 *   IDs in final-answer prose. The model is supposed to wrap them in
 *   markdown footnotes via the citation_url field. But models drift,
 *   and a stray "p-be2857" in a long answer is jarring — it reads
 *   like an artifact, not a citation. The defensive linkifier is the
 *   last line of defense: when we detect any naked p-xxxxxx in the
 *   rendered HTML, we look it up in the paragraph-index phone book
 *   and rewrite it as a real link to the chapter reader.
 *
 *   This is belt-and-suspenders. If the model behaves perfectly, this
 *   code never fires. If it slips, the reader still gets a clickable
 *   citation rather than a confusing hash.
 *
 * Performance:
 *   The paragraph index is ~8 MB / ~1.5 MB gzipped. We lazy-fetch it
 *   only when we detect naked IDs in HTML — most answers won't trigger
 *   this. Once fetched, the index is cached at module scope for the
 *   lifetime of the page.
 */

import { urlForCitation } from "../../../lib/citation-url";

/** Phone book entry — same shape the build-paragraph-index script emits. */
interface ParagraphIndexEntry {
  work: string;
  chapter: string;
  variant: string;
}

type ParagraphIndex = Record<string, ParagraphIndexEntry>;

// Module-scope cache of the index + the in-flight fetch promise (so
// concurrent renders share the same fetch).
let indexCache: ParagraphIndex | null = null;
let fetchPromise: Promise<ParagraphIndex | null> | null = null;

/**
 * Detect whether a rendered HTML string contains any naked paragraph
 * IDs that need linkifying. Looks for "p-{6+ hex chars}" as a whole
 * word that ISN'T already inside an attribute (heuristic: any p-xxx
 * preceded immediately by `="`, `=`, `'`, `"`, `/`, or `#` is part of
 * a URL or attribute and we leave it alone).
 *
 * Returning false is the fast path — caller can skip the index fetch
 * and the linkify pass entirely.
 */
export function hasNakedParagraphIds(html: string): boolean {
  // Use a non-global regex for detection — global regexes carry
  // `lastIndex` state across `test()` calls and would skip matches.
  return NAKED_PID_DETECT_RE.test(html);
}

// Negative lookbehind: skip when preceded by `="`, `='`, `=`, `"`, `'`,
// `/`, or `#` — those mean we're inside a URL or attribute value.
// The `[a-f0-9]{6,}` lower bound matches the 6-char hash IDs the corpus
// builder emits, while still allowing longer IDs if they appear.
const NAKED_PID_DETECT_RE = /(?<!["'=/#])\bp-[a-f0-9]{6,}\b/;
const NAKED_PID_REPLACE_RE = /(?<!["'=/#])\bp-[a-f0-9]{6,}\b/g;

/**
 * Fetch the paragraph index, sharing a single promise across concurrent
 * callers. Returns null on failure — callers should leave the HTML
 * alone in that case rather than trying to linkify with a missing map.
 */
export async function loadParagraphIndex(): Promise<ParagraphIndex | null> {
  if (indexCache) return indexCache;
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch("/corpus/paragraph-index.json");
      if (!res.ok) return null;
      const json = (await res.json()) as ParagraphIndex;
      indexCache = json;
      return json;
    } catch {
      return null;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

/**
 * Walk the HTML and replace every naked p-xxxxxx (outside attributes
 * and existing links) with a markdown-equivalent <a> pointing at the
 * paragraph in the chapter reader. IDs that aren't in the index pass
 * through unchanged — could be a stale ID, a body-split synthetic ID
 * we don't track, or just a false-positive match.
 *
 * The link text is the original ID, kept short and recognisable. We
 * tag it with class="byok-defensive-link" so styles can hint that it's
 * a runtime-repaired link (slightly different from a model-emitted
 * footnote link).
 */
export function applyParagraphLinkify(html: string, index: ParagraphIndex): string {
  return html.replace(NAKED_PID_REPLACE_RE, (match) => {
    const entry = index[match];
    if (!entry) return match;
    const url = urlForCitation({
      workSlug: entry.work,
      chapterSlug: entry.chapter,
      variant: entry.variant,
      paragraphIds: [match],
    });
    return `<a class="byok-defensive-link" href="${url}">${match}</a>`;
  });
}
