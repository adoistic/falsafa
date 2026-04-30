/**
 * Post-process rendered HTML, replacing `p-XXXXXX` text tokens with anchors
 * when a matching citation resolves to a real chapter URL. Operates on
 * already-rendered HTML (post markdown), and skips contents inside
 * `<pre>` and `<code>` elements so code-fence text isn't mangled.
 *
 * The chapter URL is `/works/<work_slug>/<chapter_slug>/translation/#p-XXXXXX`.
 * Variant is hard-coded to `translation` — the canonical English variant
 * matches the existing default in pages/works/[slug]/[chapter]/[variant].astro.
 *
 * Tokens with no matching citation render unchanged (no anchor) and emit
 * a build-time warning, advisory only — does NOT fail the build, since
 * legitimate paraphrases sometimes cite ids outside the formal
 * `result.citations[]` set.
 *
 * `listChaptersFn` is dependency-injected so this helper is unit-testable
 * without booting Astro / loading the whole corpus. In Astro callsites,
 * pass `listChapters` from `lib/corpus.ts` directly.
 */
import type { EvalCitation } from "./eval-types";

interface ChapterStub { chapter_number: number; chapter_slug: string; }
type ListChaptersFn = (workSlug: string) => ReadonlyArray<ChapterStub>;

const TOKEN_RE = /\bp-[0-9a-f]{6}\b/g;

// Splits the HTML into "skip" segments (inside <pre>, <code>, OR <a> elements)
// and "prose" segments. We only linkify prose. The split is conservative —
// it doesn't try to be a real HTML parser; it just respects the element
// boundaries that matter for not corrupting rendering.
//
// Why <a> is in the skip set:
//   When marked.parse renders a markdown link like [paragraph](#p-XXXXXX),
//   the result is <a href="...#p-XXXXXX">paragraph</a>. The token p-XXXXXX
//   appears INSIDE the href attribute. Without skipping <a>, the regex
//   replace would wrap that attribute-internal token in a nested anchor,
//   producing <a href="...#<a href="...">p-XXXXXX</a>">paragraph</a> —
//   invalid HTML that the browser parser bails out of, leaking the partial
//   '">paragraph' text. linkifyHtml's only legitimate job is wrapping
//   leaked-into-prose tokens; properly-formed anchors must pass through
//   verbatim.
const SKIP_REGION_RE = /<(pre|code|a)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function linkifyHtml(
  html: string,
  citations: ReadonlyArray<EvalCitation>,
  listChaptersFn: ListChaptersFn,
): string {
  // Index citations by paragraph_id for O(1) lookup per token.
  const byPid = new Map<string, EvalCitation>();
  for (const c of citations) {
    if (c.paragraph_id) byPid.set(c.paragraph_id, c);
  }
  // Dedup warnings per (work_slug, chapter_number) per call so build logs
  // don't flood with repeats when the same missing chapter is cited many times.
  const warnedKeys = new Set<string>();

  // Walk the HTML, copying skip regions (pre/code/a) verbatim and linkifying
  // everything else.
  let out = "";
  let lastIdx = 0;
  SKIP_REGION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SKIP_REGION_RE.exec(html)) !== null) {
    const prose = html.slice(lastIdx, m.index);
    out += linkifyProse(prose, byPid, listChaptersFn, warnedKeys);
    out += m[0];                                  // skip region verbatim
    lastIdx = m.index + m[0].length;
  }
  out += linkifyProse(html.slice(lastIdx), byPid, listChaptersFn, warnedKeys);
  return out;
}

function linkifyProse(
  prose: string,
  byPid: Map<string, EvalCitation>,
  listChaptersFn: ListChaptersFn,
  warnedKeys: Set<string>,
): string {
  return prose.replace(TOKEN_RE, (token) => {
    const cite = byPid.get(token);
    if (!cite || cite.chapter_number === undefined) return token;
    const chapters = listChaptersFn(cite.work_slug);
    const ch = chapters.find((c) => c.chapter_number === cite.chapter_number);
    if (!ch) {
      const key = `${cite.work_slug}|${cite.chapter_number}`;
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key);
        console.warn(
          `[eval-paragraph-link] no chapter for ${cite.work_slug} ch.${cite.chapter_number}`,
        );
      }
      return token;
    }
    const href = `/works/${cite.work_slug}/${ch.chapter_slug}/translation/#${token}`;
    return `<a href="${href}">${token}</a>`;
  });
}
