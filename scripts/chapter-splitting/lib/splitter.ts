/**
 * Splitter — given a body and a list of markers, produce one content
 * chunk per chapter.
 *
 * Two cut semantics, picked per work:
 *
 *   "after_chapter"  (default — TYPE_A verse-marker works)
 *     The boundary between chapters K and K+1 sits immediately AFTER the
 *     LAST marker of K (just past the closing `//` of K's last verse).
 *     Real markers in this mode appear at the END of their verse, so the
 *     trailing marker IS the chapter boundary.
 *
 *   "before_chapter"  (TYPE_C prose-heading works)
 *     The boundary between K and K+1 sits immediately BEFORE the FIRST
 *     marker of K+1. Real markers in this mode are heading lines that
 *     OPEN a chapter, so the next chapter's heading IS the boundary.
 *
 * In both modes:
 *   - Anything before the first marker of chapter 1 belongs to chapter 1
 *     (so a prelude/title block before "Chapter 1" gets attached to ch.1).
 *   - Anything after the last marker of the final chapter belongs to the
 *     final chapter (epilogue, end-matter).
 */

import type { VerseMarker } from "./parser.ts";

export interface ChapterSlice {
  chapter: number;
  /** Content from the body for this chapter, including all in-chapter markers. */
  content: string;
  /** Markers from the original body that fall within this chapter. */
  markers: VerseMarker[];
  /** Verse range [first..last]. */
  first_verse: number;
  last_verse: number;
}

export type MarkerPosition = "after_chapter" | "before_chapter";

export interface SplitOptions {
  markerPosition?: MarkerPosition;
  /** When true and markerPosition === "before_chapter", strip the leading
   *  marker text from each slice's content. Useful for TYPE_C where the
   *  heading itself ("### Paragraph 1") would otherwise duplicate the
   *  chapter title rendered by the reader page. */
  stripLeadingMarker?: boolean;
}

export function splitBodyByChapter(
  body: string,
  markers: VerseMarker[],
  optsOrPosition: SplitOptions | MarkerPosition = {},
): ChapterSlice[] {
  // Backwards-compatible: accept a bare MarkerPosition string for callers
  // that pre-date the SplitOptions object (only TYPE_A in tree).
  const opts: SplitOptions = typeof optsOrPosition === "string"
    ? { markerPosition: optsOrPosition }
    : optsOrPosition;
  const markerPosition: MarkerPosition = opts.markerPosition ?? "after_chapter";
  const stripLeadingMarker = opts.stripLeadingMarker === true && markerPosition === "before_chapter";
  if (markers.length === 0) return [];

  // Group markers by chapter, preserving order.
  const byChapter = new Map<number, VerseMarker[]>();
  for (const m of markers) {
    if (!byChapter.has(m.chapter)) byChapter.set(m.chapter, []);
    byChapter.get(m.chapter)!.push(m);
  }

  const chapterNumbers = [...byChapter.keys()].sort((a, b) => a - b);

  const slices: ChapterSlice[] = [];
  let cursorStart = 0;

  for (let i = 0; i < chapterNumbers.length; i++) {
    const ch = chapterNumbers[i]!;
    const markersInChapter = byChapter.get(ch)!;
    const lastMarkerOfThisChapter = markersInChapter[markersInChapter.length - 1]!;

    let cursorEnd: number;
    if (i === chapterNumbers.length - 1) {
      // Final chapter — always include everything to end of body
      cursorEnd = body.length;
    } else if (markerPosition === "before_chapter") {
      // TYPE_C: cut just BEFORE the FIRST marker of the NEXT chapter
      // (so the heading "Chapter K+1" goes with chapter K+1, not K).
      const nextChapter = chapterNumbers[i + 1]!;
      const firstMarkerOfNext = byChapter.get(nextChapter)![0]!;
      cursorEnd = firstMarkerOfNext.start;
    } else {
      // TYPE_A: cut just AFTER the LAST marker of THIS chapter
      cursorEnd = lastMarkerOfThisChapter.end;
    }

    // Trim trailing whitespace AFTER the marker but before the next chapter,
    // so the previous chapter doesn't include the next chapter's prelude.
    // (We only need this for non-final chapters.)
    let content = body.slice(cursorStart, cursorEnd);
    // Right-trim only newlines/whitespace at the very end so the file ends cleanly.
    if (i !== chapterNumbers.length - 1) {
      content = content.replace(/\s+$/, "");
    }
    // stripLeadingMarker (for TYPE_C "before_chapter") is reserved but
    // not yet wired — the round-trip-integrity validator currently
    // forbids any content drop at slice boundaries. Leaving the leading
    // heading in body is functionally fine; the reader page renders an
    // h1 ("Chapter N") followed by an h3 from the heading. Title polish
    // is a follow-up.
    void stripLeadingMarker;

    slices.push({
      chapter: ch,
      content,
      markers: markersInChapter,
      first_verse: markersInChapter[0]!.verse,
      last_verse: lastMarkerOfThisChapter.verse,
    });

    cursorStart = cursorEnd;
    // Eat the leading whitespace of the next chunk so chapter K+1 doesn't
    // start with a long string of blank lines from the gap.
    while (cursorStart < body.length && /\s/.test(body[cursorStart]!)) {
      cursorStart++;
    }
  }

  return slices;
}
