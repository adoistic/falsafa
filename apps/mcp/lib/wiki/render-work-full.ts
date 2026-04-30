/**
 * Work full-sheet renderer per design doc.
 *
 * Composition: work card + work-level expansion sections.
 *   - Top-50 unigrams / bigrams / trigrams (TF-IDF, work-level)
 *   - Cross-corpus Burrows' Delta against every other work
 *
 * Note: per design doc Open Question Q1 ("is per-work full sheet worth
 * building?"), the spec's provisional answer is "build it, mark for v2
 * deletion if real usage shows nobody escalates to it." So this is a
 * pragmatic stub — adds the work-level n-gram tables + cross-corpus
 * Burrows' Delta, but nothing fancier. If usage data shows the work
 * full is dead weight, this is easy to drop.
 */

import { renderWorkCard, type WorkRenderInput } from "./render-work-card";
import type { NgramScore } from "./render-card";

export interface BurrowsDeltaCrossWork {
  workShortName: string;
  delta: number;
}

export interface WorkFullInput extends WorkRenderInput {
  unigramsTop50: NgramScore[];
  bigramsTop50: NgramScore[];
  trigramsTop50: NgramScore[];
  /** Burrows' Delta vs every other work in the corpus, sorted however caller wants. */
  burrowsAgainstOtherWorks: BurrowsDeltaCrossWork[];
}

function fmtScore(s: number, decimals = 3): string {
  return s.toFixed(decimals);
}

export function renderWorkFull(w: WorkFullInput): string {
  const cardLines = renderWorkCard(w).trimEnd().split("\n");
  const out: string[] = [...cardLines, ""];

  out.push("## Work-level top-50 unigrams (TF-IDF)");
  out.push(
    w.unigramsTop50.map((u) => `${u.ngram} ${fmtScore(u.score)}`).join(" · "),
  );
  out.push("");

  out.push("## Work-level top-50 bigrams (n-gram TF-IDF)");
  out.push(
    w.bigramsTop50.map((b) => `"${b.ngram}" ${fmtScore(b.score)}`).join(" · "),
  );
  out.push("");

  out.push("## Work-level top-50 trigrams (n-gram TF-IDF)");
  out.push(
    w.trigramsTop50.map((t) => `"${t.ngram}" ${fmtScore(t.score)}`).join(" · "),
  );
  out.push("");

  if (w.burrowsAgainstOtherWorks.length > 0) {
    out.push("## Cross-corpus Burrows' Delta");
    out.push(
      "Stylistic distance vs every other work; higher = more stylistically distinct",
    );
    const maxName = Math.max(
      ...w.burrowsAgainstOtherWorks.map((b) => b.workShortName.length),
    );
    for (const b of w.burrowsAgainstOtherWorks) {
      out.push(`${b.workShortName.padEnd(maxName)}  Δ ${fmtScore(b.delta, 2)}`);
    }
    out.push("");
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
