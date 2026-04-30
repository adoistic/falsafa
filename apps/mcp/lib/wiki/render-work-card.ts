/**
 * Work card renderer per design doc.
 *
 * Produces the per-work card written to corpus/works/<slug>/wiki/_work.card.md.
 * The marquee feature is the **chapter map** — one line per chapter with its
 * TextRank-#1 paragraph deterministically truncated to ~80 chars at the
 * first sentence boundary. Lets the LLM see the work's *shape* in one
 * glance without loading any chapter card.
 *
 * Structure:
 *   - Header: title
 *   - Metadata line: author · era · language · layout · chapter count · word count
 *   - Work-level distinctive trigrams (top-12)
 *   - Work-level NPMI collocations (top-6)
 *   - Chapter map (one line per chapter)
 *   - Statistically nearest works in corpus (top-K)
 *   - Phrases unique to this work (vs. rest of corpus, top-8)
 *   - Original-language signature (when Roman-script source available)
 */

export interface WorkNPMIPair {
  a: string;
  b: string;
  npmi: number;
}

export interface WorkChapterEntry {
  chapterNumber: number;
  /** TextRank #1 paragraph for this chapter, full text. Renderer truncates. */
  textRankFirstSentence: string;
}

export interface WorkNearestRef {
  workShortName: string;
  cosine: number;
}

export interface WorkOriginalLanguageSignature {
  language: string;
  trigrams: string[];
}

export interface WorkRenderInput {
  title: string;
  author: string;
  era: string;
  language: string;
  layout: string;
  chapterCount: number;
  totalWords: number;
  workTrigrams: string[]; // top-12, already ordered
  workNPMI: WorkNPMIPair[]; // top-6, already ordered
  chapterMap: WorkChapterEntry[];
  nearestWorks: WorkNearestRef[];
  uniquePhrases: string[]; // top-8
  originalLanguageSignature: WorkOriginalLanguageSignature | null;
}

/**
 * Truncate a sentence at the first natural breakpoint near maxLen:
 *   1. First period followed by space (sentence end)
 *   2. First comma followed by space (clause end)
 *   3. Last whitespace at-or-before maxLen (word boundary)
 * Adds an ellipsis when truncated mid-sentence (no ellipsis on full sentences).
 *
 * Exported for unit-testing.
 */
export function truncatedSentence(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  const periodIdx = text.indexOf(". ");
  if (periodIdx > 0 && periodIdx < maxLen) {
    return text.slice(0, periodIdx + 1);
  }
  const commaIdx = text.indexOf(", ");
  if (commaIdx > 0 && commaIdx < maxLen) {
    return text.slice(0, commaIdx + 1) + "...";
  }
  const wordEnd = text.lastIndexOf(" ", maxLen);
  if (wordEnd > 0) return text.slice(0, wordEnd) + "...";
  // Fallback: hard cut at maxLen (no whitespace found)
  return text.slice(0, maxLen) + "...";
}

/** Format a number with thousands separator (US locale, deterministic). */
function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderWorkCard(w: WorkRenderInput): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${w.title}`);
  lines.push(
    `${w.author} · ${w.era} · ${w.language} · ${w.layout} · ${w.chapterCount} chapters · ${fmtN(w.totalWords)} words`,
  );
  lines.push("");

  // Distinctive trigrams (top-12)
  lines.push("## Work-level distinctive trigrams (top-12 across all chapters)");
  lines.push(w.workTrigrams.map((t) => `"${t}"`).join(" · "));
  lines.push("");

  // NPMI collocations (top-6)
  lines.push("## Work-level NPMI signature collocations");
  lines.push(w.workNPMI.map((c) => `${c.a} + ${c.b}`).join(" · "));
  lines.push("");

  // Chapter map — pad chapter-number column so the em-dashes align
  lines.push("## Chapter map");
  const maxChNumWidth = Math.max(
    ...w.chapterMap.map((c) => `${c.chapterNumber}`.length),
  );
  for (const ch of w.chapterMap) {
    const num = `${ch.chapterNumber}`.padEnd(maxChNumWidth);
    lines.push(`ch.${num} — ${truncatedSentence(ch.textRankFirstSentence)}`);
  }
  lines.push("");

  // Nearest works in corpus — pad work-name column for alignment
  lines.push("## Statistically nearest works in corpus");
  const maxNameWidth = Math.max(
    ...w.nearestWorks.map((n) => n.workShortName.length),
  );
  for (const n of w.nearestWorks) {
    lines.push(
      `${n.workShortName.padEnd(maxNameWidth)}  cosine ${n.cosine.toFixed(2)}`,
    );
  }
  lines.push("");

  // Phrases unique to this work
  lines.push("## Phrases unique to this work (vs. rest of corpus, top-8)");
  lines.push(w.uniquePhrases.map((p) => `"${p}"`).join(" · "));
  lines.push("");

  // Original-language signature (conditional)
  if (w.originalLanguageSignature) {
    const sig = w.originalLanguageSignature;
    lines.push(`## Original-language signature (${sig.language}, top-6)`);
    lines.push(sig.trigrams.map((t) => `"${t}"`).join(" · "));
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}
