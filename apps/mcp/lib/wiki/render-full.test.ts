import { describe, expect, test } from "bun:test";
import { renderChapterFull, type ChapterFullInput } from "./render-full";

const fixture: ChapterFullInput = {
  // Card-shape fields (reused from chapter card)
  workTitle: "Manusmṛti",
  chapterNumber: 1,
  layout: "verse",
  paragraphCount: 119,
  wordCount: 3360,
  vocabulary: { distinctTypes: 1084, ttr: 0.32, hapaxPct: 0.44 },
  trigrams: [
    { ngram: "the self existent", score: 0.9 },
    { ngram: "from his mouth", score: 0.8 },
    { ngram: "great souled bhrigu", score: 0.7 },
  ],
  textRank: {
    confidence: "high",
    paragraphs: [
      { id: "p-153021", text: "Then the divine self-existent." },
      { id: "p-cd6713", text: "From his mouth he created the brahmin." },
      { id: "p-3bd729", text: "He divided his own body into two halves." },
    ],
  },
  opens: { id: "p-153021", text: "Listen, sages, to the path of dharma." },
  closes: {
    id: "p-13a2db",
    text: "Such was the first creation, by the resolve of the Self-Existent.",
  },
  refrain: { phrase: "the great-souled", count: 8, firstCite: "p-7e1c0e" },
  nearestInCorpus: [
    { workShortName: "Manu", chapterNumber: 12, cosine: 0.71 },
  ],
  originalLanguageSignature: null,
  // Full-sheet additions
  unigramsTop20: [
    { ngram: "dharma", score: 0.082 },
    { ngram: "brahma", score: 0.071 },
  ],
  bigramsTop20: [{ ngram: "self existent", score: 0.064 }],
  trigramsTop20: [{ ngram: "the self existent", score: 0.058 }],
  npmiTop10: [{ a: "hiranyagarbha", b: "golden_egg", npmi: 0.91 }],
  lexRank: {
    paragraphs: [
      { id: "p-153021", text: "Then the divine self-existent." },
      { id: "p-cd6713", text: "From his mouth he created the brahmin." },
      { id: "p-3bd729", text: "He divided his own body into two halves." },
    ],
  },
  allRefrains: [
    {
      phrase: "the great-souled",
      count: 8,
      cites: ["p-aaaaaa", "p-bbbbbb", "p-cccccc", "p-dddddd"],
    },
  ],
  boundaryParagraphs: [12, 47, 88],
  burrowsDelta: 0.78,
};

describe("renderChapterFull", () => {
  test("includes chapter card content (header + frontmatter + key passage)", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("# Manusmṛti · ch.1");
    expect(out).toMatch(/^---\ntextrank_confidence: high\n---/);
    expect(out).toContain("[p-153021] Then the divine self-existent.");
  });

  test("emits Top-20 unigrams section with score formatting", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Top-20 unigrams");
    expect(out).toContain("dharma 0.082");
  });

  test("emits Top-20 bigrams + trigrams sections", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Top-20 bigrams");
    expect(out).toContain('"self existent"');
    expect(out).toContain("## Top-20 trigrams");
    expect(out).toContain('"the self existent"');
  });

  test("emits NPMI top-10 section", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Strongest collocations (NPMI top-10)");
    expect(out).toContain("hiranyagarbha + golden_egg NPMI 0.91");
  });

  test("emits TextRank top-3 with FULL verbatim text (D2)", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Key passages (TextRank top-3, verbatim)");
    expect(out).toContain("[p-cd6713] From his mouth he created the brahmin.");
    expect(out).toContain("[p-3bd729] He divided his own body into two halves.");
  });

  test("emits LexRank cross-check section", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Cross-check (LexRank top-3, verbatim)");
  });

  test("emits all refrains with all cite handles", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## All refrains (≥2× verbatim)");
    expect(out).toContain('"the great-souled" — 8× — paragraphs: p-aaaaaa, p-bbbbbb');
  });

  test("emits boundary signals when present", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Topic boundary signals");
    expect(out).toContain("¶12, ¶47, ¶88");
  });

  test("emits Burrows Delta line", () => {
    const out = renderChapterFull(fixture);
    expect(out).toContain("## Stylometric outlier check");
    expect(out).toContain("Burrows' Delta");
    expect(out).toContain("0.78");
  });

  test("output ends with single trailing newline", () => {
    const out = renderChapterFull(fixture);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("omits empty boundary section gracefully", () => {
    const out = renderChapterFull({ ...fixture, boundaryParagraphs: [] });
    expect(out).not.toContain("## Topic boundary signals");
  });

  test("omits all-refrains section when no refrains found", () => {
    const out = renderChapterFull({ ...fixture, allRefrains: [] });
    expect(out).not.toContain("## All refrains");
  });
});
