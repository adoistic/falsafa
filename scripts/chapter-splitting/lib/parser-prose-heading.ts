/**
 * Prose-heading parser for TYPE_C works.
 *
 * Discovery flagged 6 works whose chapters are demarcated by markdown
 * ATX headings (`## Chapter 1:`, `### Paragraph 4`, `## Canto 12`, etc.)
 * rather than verse markers. Each work uses headings at a specific depth
 * with a specific text shape; the splitter takes a per-work config that
 * tells it which headings count.
 *
 * Output is a list of synthetic VerseMarker objects with verse=1 and a
 * generic prefix ("Ch"). The splitter is invoked with
 * markerPosition="before_chapter" so the cut is placed BEFORE each
 * heading (the heading line opens its chapter, doesn't close the prior
 * one).
 *
 * Sequential numbering (1, 2, 3...) — we do NOT try to extract the
 * heading's own number, even when present. For Bṛhaspati's
 * `## Chapter 1: ...` we still emit chapter=1, but for Kātyāyana's
 * untitled `## The Qualities of a King` (no number in source) we'd
 * still get sequential ordering.
 */

import type { VerseMarker } from "./parser.ts";

export interface ProseHeadingConfig {
  /** Markdown heading depth: 2 = "## ", 3 = "### ", 4 = "#### " */
  depth: 2 | 3 | 4;
  /** Optional regex that the heading text (after the # marks) must match.
   *  Used to filter out sibling headings that aren't true chapter starts. */
  pattern?: RegExp;
  /** Optional regex of headings to skip — work-title repeats, prefaces
   *  outside the main chapter sequence, etc. */
  skipPattern?: RegExp;
}

export function parseProseHeadings(body: string, config: ProseHeadingConfig): VerseMarker[] {
  const hashes = "#".repeat(config.depth);
  // Match ATX headings of the requested depth at start-of-line. The
  // body part is captured up to the trailing newline (or end-of-body).
  const headingRx = new RegExp(`^${hashes}\\s+(.+)$`, "gm");
  const markers: VerseMarker[] = [];
  let chapterNum = 0;
  for (const m of body.matchAll(headingRx)) {
    const text = (m[1] ?? "").trim();
    if (config.pattern && !config.pattern.test(text)) continue;
    if (config.skipPattern && config.skipPattern.test(text)) continue;
    chapterNum++;
    const start = m.index ?? 0;
    markers.push({
      start,
      end: start + m[0].length,
      prefix: "Ch",
      chapter: chapterNum,
      verse: 1,
      text: m[0],
    });
  }
  return markers;
}
