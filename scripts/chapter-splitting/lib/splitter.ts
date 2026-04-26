/**
 * Splitter — given a body and a list of native markers, produce one
 * content chunk per chapter.
 *
 * Cut rule: the boundary between chapters K and K+1 is placed immediately
 * after the LAST marker of K (i.e. just past the closing `//` of the
 * verse marker for the final verse of K). Anything before the first
 * marker of chapter 1 (preludes, work titles) belongs to chapter 1.
 * Anything after the last marker of the final chapter (epilogues, end-
 * matter) belongs to the final chapter.
 */

import type { VerseMarker } from "./parser.ts";

export interface ChapterSlice {
  chapter: number;
  /** Content from the body for this chapter, including all in-chapter verse markers. */
  content: string;
  /** Markers from the original body that fall within this chapter. */
  markers: VerseMarker[];
  /** Verse range [first..last]. */
  first_verse: number;
  last_verse: number;
}

export function splitBodyByChapter(body: string, markers: VerseMarker[]): ChapterSlice[] {
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
      // Final chapter — include everything to end of body
      cursorEnd = body.length;
    } else {
      // Cut just after the last marker of THIS chapter
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
