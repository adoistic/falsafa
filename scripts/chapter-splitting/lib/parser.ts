/**
 * Verse-marker parser for TYPE_A works.
 *
 * Two flavors of marker delimiter occur in our corpus:
 *   - // Mn_1.5 //   (Manusmṛti, Yājñavalkya, Yama, Parāśara, Aṅgirasa, etc.)
 *   - || Vi_1.1 ||   (Viṣṇu Smṛti uses double-pipes, not slashes)
 *
 * Inside a paragraph the verse marker always appears AT THE END (after the
 * verse text). Inline citations to other verses ("as Mn_5.41 says, …") look
 * the same as a real marker but appear mid-paragraph — we drop those.
 *
 * Strategy: split body into paragraphs (by blank lines), then for each
 * paragraph keep only the LAST marker if and only if it's the trailing
 * token. This eliminates inline-citation false positives.
 */

export interface VerseMarker {
  start: number;
  end: number;
  prefix: string;
  chapter: number;
  verse: number;
  text: string;
}

/**
 * Bareword `Prefix_N.M` token. Optionally surrounded by `// … //` or `|| … ||`.
 */
const TOKEN_RX = /(?:[\/|]{2,}\s*)?\b([A-Za-z]{2,6})_(\d+)\.(\d+)\b(?:\s*[\/|]{2,})?/g;

/**
 * Find the byte-offset of `needle` starting at or after `from`. Returns -1
 * if not found. Used to walk paragraphs back to their position in body.
 */
function indexFrom(body: string, needle: string, from: number): number {
  return body.indexOf(needle, from);
}

/**
 * Parse all paragraph-trailing verse markers in document order.
 * Inline citations (markers that appear before more text in the same paragraph)
 * are dropped.
 */
export function parseVerseMarkers(body: string): VerseMarker[] {
  const out: VerseMarker[] = [];

  // Walk paragraphs by tracking byte offsets
  const paragraphPattern = /\n\s*\n+/g;
  let paraStart = 0;
  const boundaries: { start: number; end: number }[] = [];
  for (const m of body.matchAll(paragraphPattern)) {
    boundaries.push({ start: paraStart, end: m.index! });
    paraStart = m.index! + m[0].length;
  }
  boundaries.push({ start: paraStart, end: body.length });

  for (const b of boundaries) {
    const para = body.slice(b.start, b.end);
    if (!para.trim()) continue;
    // Find every marker token in this paragraph
    const matches = [...para.matchAll(TOKEN_RX)];
    if (matches.length === 0) continue;
    const last = matches[matches.length - 1]!;
    const lastEnd = (last.index ?? 0) + last[0].length;
    // Real verse markers sit at the END of the paragraph. If anything
    // non-whitespace follows the last marker within the same paragraph,
    // this is an inline citation, not a verse boundary — drop it.
    const tail = para.slice(lastEnd).trim();
    if (tail.length > 0) continue;

    out.push({
      start: b.start + (last.index ?? 0),
      end: b.start + lastEnd,
      prefix: last[1]!,
      chapter: parseInt(last[2]!, 10),
      verse: parseInt(last[3]!, 10),
      text: last[0],
    });
  }
  return out;
}

/**
 * Filter to just the most-frequent ("native") prefix.
 */
export function filterToNativePrefix(markers: VerseMarker[]): {
  native_prefix: string;
  native_markers: VerseMarker[];
  citation_markers: VerseMarker[];
} {
  const counts = new Map<string, number>();
  for (const m of markers) counts.set(m.prefix, (counts.get(m.prefix) ?? 0) + 1);
  let nativePrefix = "";
  let max = -1;
  for (const [p, c] of counts) {
    if (c > max) {
      max = c;
      nativePrefix = p;
    }
  }
  return {
    native_prefix: nativePrefix,
    native_markers: markers.filter((m) => m.prefix === nativePrefix),
    citation_markers: markers.filter((m) => m.prefix !== nativePrefix),
  };
}

export interface MarkerAnomaly {
  kind: "verse_out_of_order" | "chapter_out_of_order" | "duplicate_verse" | "implausible_chapter_number";
  message: string;
  marker: VerseMarker;
  prev_marker?: VerseMarker;
}

/**
 * Find anomalies in the marker stream. Plausibility check: chapter numbers
 * above MAX_PLAUSIBLE_CHAPTER are flagged — likely malformed concatenations
 * (e.g. `Nar_1516` from two adjacent markers `Nar_15.16` + `Nar_16.1`
 * getting glued together in the source).
 */
const MAX_PLAUSIBLE_CHAPTER = 250;

export function findMarkerAnomalies(markers: VerseMarker[]): MarkerAnomaly[] {
  const out: MarkerAnomaly[] = [];
  let prevChapter = -Infinity;
  let prevVerse = -Infinity;
  const seen = new Set<string>();
  for (const m of markers) {
    if (m.chapter > MAX_PLAUSIBLE_CHAPTER) {
      out.push({
        kind: "implausible_chapter_number",
        message: `${m.prefix}_${m.chapter}.${m.verse} — chapter number ${m.chapter} exceeds plausibility threshold ${MAX_PLAUSIBLE_CHAPTER}; likely a malformed marker (concatenation glitch)`,
        marker: m,
      });
      // Don't update prev — we'll skip this one for ordering checks
      continue;
    }
    const key = `${m.chapter}.${m.verse}`;
    if (seen.has(key)) {
      out.push({
        kind: "duplicate_verse",
        message: `${m.prefix}_${m.chapter}.${m.verse} appears more than once`,
        marker: m,
      });
    }
    seen.add(key);
    if (m.chapter < prevChapter) {
      out.push({
        kind: "chapter_out_of_order",
        message: `Chapter ${m.chapter} appears after chapter ${prevChapter}`,
        marker: m,
      });
    }
    if (m.chapter === prevChapter && m.verse < prevVerse) {
      out.push({
        kind: "verse_out_of_order",
        message: `Verse ${m.verse} in chapter ${m.chapter} appears after verse ${prevVerse}`,
        marker: m,
      });
    }
    prevChapter = m.chapter;
    prevVerse = m.verse;
  }
  return out;
}

/**
 * Drop markers with implausible chapter numbers from the stream — these
 * represent source-format glitches and would otherwise produce stray
 * "chapter 1516" output. Returns markers + dropped list.
 */
export function dropImplausibleMarkers(markers: VerseMarker[]): {
  kept: VerseMarker[];
  dropped: VerseMarker[];
} {
  const kept: VerseMarker[] = [];
  const dropped: VerseMarker[] = [];
  for (const m of markers) {
    if (m.chapter > MAX_PLAUSIBLE_CHAPTER) dropped.push(m);
    else kept.push(m);
  }
  return { kept, dropped };
}

/**
 * Drop markers that go BACKWARDS in chapter or verse order, and exact
 * duplicates. These represent inline citations to earlier verses that
 * happen to sit at the end of a paragraph (and thus look like real verse
 * boundaries to the parser). The first occurrence of any (chapter, verse)
 * pair wins; later backwards or duplicate occurrences are dropped.
 */
export function dropBackwardsMarkers(markers: VerseMarker[]): {
  kept: VerseMarker[];
  dropped: VerseMarker[];
} {
  const kept: VerseMarker[] = [];
  const dropped: VerseMarker[] = [];
  const seen = new Set<string>();
  let prevChapter = -Infinity;
  let prevVerse = -Infinity;
  for (const m of markers) {
    const key = `${m.chapter}.${m.verse}`;
    if (seen.has(key)) {
      dropped.push(m);
      continue;
    }
    if (m.chapter < prevChapter) {
      dropped.push(m);
      continue;
    }
    if (m.chapter === prevChapter && m.verse < prevVerse) {
      dropped.push(m);
      continue;
    }
    seen.add(key);
    kept.push(m);
    prevChapter = m.chapter;
    prevVerse = m.verse;
  }
  return { kept, dropped };
}
