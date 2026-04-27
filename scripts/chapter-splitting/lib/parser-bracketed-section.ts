/**
 * Bracketed-section parser — for Old Javanese / romanized-Sanskrit
 * variants where chapter starts are marked by a bracketed Sanskrit
 * section name on its own line:
 *
 *   [rājaguṇāḥ]
 *   [rājadharmāḥ]
 *   [vyavahāralakṣaṇādi]
 *
 * Used for Kātyāyana Smṛti's transliteration variant: 80 such bracketed
 * lines, matching 80 ## markdown sections in the translation. Sequential
 * order preserved; chapter numbering assigned 1..N regardless of bracket
 * contents.
 *
 * Output is the same shape as parser-prose-heading.ts — synthetic
 * VerseMarker[] with verse=1 and a generic prefix ("Br"). The orchestrator
 * pairs this with markerPosition="before_chapter" so cuts land before
 * each bracket line.
 *
 * Distinguished from inline citation brackets (e.g. `[Brh_1,1.1]` in some
 * sources) by requiring the bracket to be the ENTIRE non-whitespace
 * content of its line — no trailing tokens. This rules out mid-paragraph
 * bracket annotations.
 */

import type { VerseMarker } from "./parser.ts";

export interface BracketedSectionConfig {
  /** Optional regex the bracket contents must match — typically only used
   *  to filter out non-section brackets like verse-citation tokens. */
  pattern?: RegExp;
  /** Optional regex to skip — e.g. work-title brackets that aren't real
   *  section starts. */
  skipPattern?: RegExp;
}

export function parseBracketedSections(body: string, config: BracketedSectionConfig = {}): VerseMarker[] {
  const markers: VerseMarker[] = [];
  // Match a bracketed block that starts a line and is the only non-whitespace
  // content on that line. ^[ <body> ]$ (with anchors per line via /m flag).
  // The bracket body can contain any non-bracket character — Sanskrit
  // diacritics, spaces, hyphens, etc. — but no nested brackets.
  const bracketLineRx = /^\[([^\]]+)\]\s*$/gm;
  let chapterNum = 0;
  for (const m of body.matchAll(bracketLineRx)) {
    const text = (m[1] ?? "").trim();
    if (!text) continue;
    if (config.pattern && !config.pattern.test(text)) continue;
    if (config.skipPattern && config.skipPattern.test(text)) continue;
    chapterNum++;
    const start = m.index ?? 0;
    markers.push({
      start,
      end: start + m[0].length,
      prefix: "Br",
      chapter: chapterNum,
      verse: 1,
      text: m[0],
    });
  }
  return markers;
}
