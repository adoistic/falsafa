/**
 * Chapter card renderer per design D2 + D3.
 *
 * Produces a markdown card (~280 tokens typical, may flex for prose-heavy
 * chapters) describing a single chapter:
 *   - YAML frontmatter with textrank_confidence (low|medium|high) per D3
 *   - Header line + stat fingerprint (layout, paragraph count, word count,
 *     vocabulary richness)
 *   - Distinctive trigrams (top-3, quoted, middot-separated)
 *   - Key passage: TextRank #1 paragraph with [p-XXXXXX] cite handle,
 *     FULL verbatim text (D2: no truncation)
 *   - Opens / Closes: first + last paragraphs verbatim, full text
 *   - Refrain (when present): phrase + count + first cite
 *   - Nearest in corpus: top-K cross-document cosine matches
 *   - Original-language signature (when a Roman-script source is available):
 *     top-3 trigrams in the original language
 *
 * Pure function. No I/O. Output is the entire markdown file as a string,
 * ready to write to disk.
 */

export interface NgramScore {
  ngram: string;
  score: number;
}

export interface NearestRef {
  workShortName: string;
  chapterNumber: number;
  cosine: number;
}

export interface RefrainSummary {
  phrase: string;
  count: number;
  firstCite: string;
}

export interface OriginalLanguageSignature {
  language: string;
  trigrams: string[];
}

export interface ChapterRenderInput {
  workTitle: string;
  chapterNumber: number;
  layout: string;
  paragraphCount: number;
  wordCount: number;
  vocabulary: { distinctTypes: number; ttr: number; hapaxPct: number };
  trigrams: NgramScore[];
  textRank: {
    confidence: "low" | "medium" | "high";
    paragraphs: { id: string; text: string }[];
  };
  opens: { id: string; text: string };
  closes: { id: string; text: string };
  refrain: RefrainSummary | null;
  nearestInCorpus: NearestRef[];
  originalLanguageSignature: OriginalLanguageSignature | null;
}

export function renderChapterCard(c: ChapterRenderInput): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`textrank_confidence: ${c.textRank.confidence}`);
  lines.push("---");
  lines.push("");

  // Header + stat fingerprint
  lines.push(`# ${c.workTitle} · ch.${c.chapterNumber}`);
  const ttrPct = Math.round(c.vocabulary.ttr * 100);
  const hapaxPct = Math.round(c.vocabulary.hapaxPct * 100);
  lines.push(
    `${c.layout} · ${c.paragraphCount}¶ · ${c.wordCount}w · vocab ${c.vocabulary.distinctTypes} (TTR ${ttrPct}%, hapax ${hapaxPct}%)`,
  );
  lines.push("");

  // Distinctive trigrams
  lines.push("## Distinctive trigrams");
  lines.push(c.trigrams.map((t) => `"${t.ngram}"`).join(" · "));
  lines.push("");

  // Key passage (TextRank #1) — D2 strict verbatim
  lines.push("## Key passage (TextRank #1)");
  for (const p of c.textRank.paragraphs.slice(0, 1)) {
    lines.push(`> [${p.id}] ${p.text}`);
  }
  lines.push("");

  // Opens — D2 strict verbatim
  lines.push("## Opens");
  lines.push(`> [${c.opens.id}] ${c.opens.text}`);
  lines.push("");

  // Closes — D2 strict verbatim
  lines.push("## Closes");
  lines.push(`> [${c.closes.id}] ${c.closes.text}`);
  lines.push("");

  // Refrain (conditional)
  if (c.refrain) {
    lines.push("## Refrain (top)");
    lines.push(
      `"${c.refrain.phrase}" — ${c.refrain.count}× (first at ${c.refrain.firstCite})`,
    );
    lines.push("");
  }

  // Nearest in corpus
  lines.push("## Nearest in corpus");
  lines.push(
    c.nearestInCorpus
      .map((n) => `${n.workShortName} ch.${n.chapterNumber} ${n.cosine.toFixed(2)}`)
      .join(" · "),
  );
  lines.push("");

  // Original-language signature (conditional)
  if (c.originalLanguageSignature) {
    const sig = c.originalLanguageSignature;
    lines.push(`## Original-language signature (${sig.language}, top-3)`);
    lines.push(sig.trigrams.map((t) => `"${t}"`).join(" · "));
    lines.push("");
  }

  // Trim trailing blank lines, then add exactly one newline
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}
