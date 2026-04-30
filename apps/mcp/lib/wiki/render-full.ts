/**
 * Chapter full-sheet renderer per design doc.
 *
 * Card content + 5 expansion sections:
 *   - Top-20 unigrams / bigrams / trigrams (TF-IDF)
 *   - NPMI top-10 collocations
 *   - TextRank top-3 (vs. just #1 in the card)
 *   - LexRank top-3 cross-check
 *   - All refrains with full cite lists
 *   - Topic boundary signals (paragraph indices where vocabulary shifts)
 *   - Burrows' Delta outlier flag
 *
 * Approach: render the chapter card via render-card.ts, then append the
 * full-sheet expansions. Keeps the card and full schemas in lockstep —
 * any card-shape change automatically propagates.
 *
 * Output target: ~1,500 tokens. Soft cap; flexes per D2 strict-verbatim.
 */

import { renderChapterCard, type ChapterRenderInput, type NgramScore } from "./render-card";

export interface FullNPMIPair {
  a: string;
  b: string;
  npmi: number;
}

export interface FullRefrain {
  phrase: string;
  count: number;
  cites: string[];
}

export interface ChapterFullInput extends ChapterRenderInput {
  /** Top-20 unigrams by TF-IDF (already ordered desc). */
  unigramsTop20: NgramScore[];
  /** Top-20 bigrams. */
  bigramsTop20: NgramScore[];
  /** Top-20 trigrams. */
  trigramsTop20: NgramScore[];
  /** NPMI top-10 collocations. */
  npmiTop10: FullNPMIPair[];
  /** LexRank top-3 paragraphs (cross-check against TextRank). */
  lexRank: { paragraphs: { id: string; text: string }[] };
  /** All refrains in the chapter with their full cite lists. */
  allRefrains: FullRefrain[];
  /** 0-indexed paragraph indices where vocabulary shifts (boundary signals). */
  boundaryParagraphs: number[];
  /** Burrows' Delta vs work-mean. */
  burrowsDelta: number;
}

function fmtScore(s: number, decimals = 3): string {
  return s.toFixed(decimals);
}

export function renderChapterFull(c: ChapterFullInput): string {
  const cardLines = renderChapterCard(c).trimEnd().split("\n");
  const out: string[] = [...cardLines, ""];

  // Top-20 unigrams
  out.push("## Top-20 unigrams (TF-IDF against corpus background)");
  out.push(c.unigramsTop20.map((u) => `${u.ngram} ${fmtScore(u.score)}`).join(" · "));
  out.push("");

  // Top-20 bigrams
  out.push("## Top-20 bigrams (n-gram TF-IDF)");
  out.push(
    c.bigramsTop20.map((b) => `"${b.ngram}" ${fmtScore(b.score)}`).join(" · "),
  );
  out.push("");

  // Top-20 trigrams
  out.push("## Top-20 trigrams (n-gram TF-IDF)");
  out.push(
    c.trigramsTop20.map((t) => `"${t.ngram}" ${fmtScore(t.score)}`).join(" · "),
  );
  out.push("");

  // NPMI top-10
  out.push("## Strongest collocations (NPMI top-10)");
  for (const p of c.npmiTop10) {
    out.push(`${p.a} + ${p.b} NPMI ${fmtScore(p.npmi, 2)}`);
  }
  out.push("");

  // TextRank top-3 (verbatim)
  out.push("## Key passages (TextRank top-3, verbatim)");
  for (const p of c.textRank.paragraphs.slice(0, 3)) {
    out.push(`> [${p.id}] ${p.text}`);
  }
  out.push("");

  // LexRank top-3 (verbatim)
  out.push("## Cross-check (LexRank top-3, verbatim)");
  for (const p of c.lexRank.paragraphs.slice(0, 3)) {
    out.push(`> [${p.id}] ${p.text}`);
  }
  out.push("");

  // All refrains (conditional)
  if (c.allRefrains.length > 0) {
    out.push("## All refrains (≥2× verbatim)");
    for (const r of c.allRefrains) {
      out.push(
        `"${r.phrase}" — ${r.count}× — paragraphs: ${r.cites.join(", ")}`,
      );
    }
    out.push("");
  }

  // Boundary signals (conditional)
  if (c.boundaryParagraphs.length > 0) {
    out.push("## Topic boundary signals");
    out.push(
      `Vocabulary-shift valleys at paragraphs: ${c.boundaryParagraphs.map((n) => `¶${n}`).join(", ")} (boundary candidates)`,
    );
    out.push("");
  }

  // Burrows' Delta
  out.push("## Stylometric outlier check");
  out.push(`Burrows' Delta vs work-mean: ${fmtScore(c.burrowsDelta, 2)}`);
  if (c.burrowsDelta > 1.5) {
    out.push(
      "(Flag: chapter is stylistically unlike the rest of the work; delta > 1.5σ)",
    );
  }
  out.push("");

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
