import { describe, expect, test } from "bun:test";
import { renderWorkFull, type WorkFullInput } from "./render-work-full";

const fixture: WorkFullInput = {
  title: "Manusmṛti",
  author: "Manu",
  era: "Ancient",
  language: "Sanskrit",
  layout: "verse",
  chapterCount: 12,
  totalWords: 39720,
  workTrigrams: ["the twice-born", "the great-souled"],
  workNPMI: [{ a: "varna", b: "dharma", npmi: 0.76 }],
  chapterMap: [
    {
      chapterNumber: 1,
      textRankFirstSentence:
        "Then the divine self-existent, desiring to produce beings of many kinds.",
    },
    {
      chapterNumber: 2,
      textRankFirstSentence: "Eight forms of marriage are enumerated.",
    },
  ],
  nearestWorks: [
    { workShortName: "Yājñavalkya-smṛti", cosine: 0.58 },
  ],
  uniquePhrases: ["hiranyagarbha", "fish on a spit"],
  originalLanguageSignature: null,
  // Full-sheet additions
  unigramsTop50: [
    { ngram: "dharma", score: 0.082 },
    { ngram: "brahma", score: 0.071 },
  ],
  bigramsTop50: [{ ngram: "self existent", score: 0.064 }],
  trigramsTop50: [{ ngram: "the self existent", score: 0.058 }],
  burrowsAgainstOtherWorks: [
    { workShortName: "Yājñavalkya-smṛti", delta: 0.78 },
    { workShortName: "Viṣṇu-smṛti", delta: 1.23 },
  ],
};

describe("renderWorkFull", () => {
  test("includes work card content (header + chapter map)", () => {
    const out = renderWorkFull(fixture);
    expect(out).toContain("# Manusmṛti");
    expect(out).toContain("## Chapter map");
    expect(out).toContain("Then the divine self-existent");
  });

  test("emits work-level top-50 n-gram tables", () => {
    const out = renderWorkFull(fixture);
    expect(out).toContain("## Work-level top-50 unigrams (TF-IDF)");
    expect(out).toContain("dharma 0.082");
    expect(out).toContain("## Work-level top-50 bigrams");
    expect(out).toContain("## Work-level top-50 trigrams");
  });

  test("emits Burrows' Delta against every other work", () => {
    const out = renderWorkFull(fixture);
    expect(out).toContain("## Cross-corpus Burrows' Delta");
    expect(out).toContain("Yājñavalkya-smṛti");
    expect(out).toContain("0.78");
    expect(out).toContain("Viṣṇu-smṛti");
    expect(out).toContain("1.23");
  });

  test("output ends with single trailing newline", () => {
    const out = renderWorkFull(fixture);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
