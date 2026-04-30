import { describe, expect, test } from "bun:test";
import { renderChapterCard, type ChapterRenderInput } from "./render-card";

const baseFixture: ChapterRenderInput = {
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
      {
        id: "p-153021",
        text: "Then the divine self-existent, desiring to produce beings of many kinds.",
      },
    ],
  },
  opens: {
    id: "p-153021",
    text: "Listen, sages, to the path of dharma.",
  },
  closes: {
    id: "p-13a2db",
    text: "Such was the first creation, by the resolve of the Self-Existent.",
  },
  refrain: { phrase: "the great-souled", count: 8, firstCite: "p-7e1c0e" },
  nearestInCorpus: [
    { workShortName: "Manu", chapterNumber: 12, cosine: 0.71 },
    { workShortName: "Yājñavalkya", chapterNumber: 1, cosine: 0.43 },
    { workShortName: "Viṣṇu", chapterNumber: 1, cosine: 0.39 },
  ],
  originalLanguageSignature: null,
};

describe("renderChapterCard", () => {
  test("emits frontmatter with textrank_confidence first", () => {
    const out = renderChapterCard(baseFixture);
    // Must START with frontmatter delimiter (no leading whitespace) so YAML
    // parsers + Astro pick it up cleanly
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toMatch(/^---\ntextrank_confidence: high\n---\n/);
  });

  test("emits header line with work title and chapter number", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain("# Manusmṛti · ch.1");
  });

  test("emits stat fingerprint line with TTR/hapax percentages", () => {
    const out = renderChapterCard(baseFixture);
    // 0.32 → 32%, 0.44 → 44%
    expect(out).toContain("verse · 119¶ · 3360w · vocab 1084 (TTR 32%, hapax 44%)");
  });

  test("emits FULL key-passage text (D2: no truncation)", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain(
      "[p-153021] Then the divine self-existent, desiring to produce beings of many kinds.",
    );
  });

  test("emits FULL opens + closes paragraphs (D2: no truncation)", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain("[p-153021] Listen, sages, to the path of dharma.");
    expect(out).toContain(
      "[p-13a2db] Such was the first creation, by the resolve of the Self-Existent.",
    );
  });

  test("emits trigrams as middot-separated quoted strings", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain(
      '"the self existent" · "from his mouth" · "great souled bhrigu"',
    );
  });

  test("emits nearest-in-corpus row with 2-decimal cosine", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain("Manu ch.12 0.71");
    expect(out).toContain("Yājñavalkya ch.1 0.43");
    expect(out).toContain("Viṣṇu ch.1 0.39");
  });

  test("omits Refrain section when refrain is null", () => {
    const noRefrain = { ...baseFixture, refrain: null };
    const out = renderChapterCard(noRefrain);
    expect(out).not.toContain("## Refrain");
  });

  test("emits Refrain section with phrase, count, first cite", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).toContain('"the great-souled" — 8× (first at p-7e1c0e)');
  });

  test("omits Original-language signature when null", () => {
    const out = renderChapterCard(baseFixture);
    expect(out).not.toContain("## Original-language signature");
  });

  test("emits Original-language signature when present", () => {
    const withSig: ChapterRenderInput = {
      ...baseFixture,
      originalLanguageSignature: {
        language: "sanskrit",
        trigrams: ["hiraṇyagarbhaḥ samavartatāgre", "ātmano 'tha vidyāt", "tasmād virāḍ ajāyata"],
      },
    };
    const out = renderChapterCard(withSig);
    expect(out).toContain("## Original-language signature (sanskrit, top-3)");
    expect(out).toContain('"hiraṇyagarbhaḥ samavartatāgre"');
  });

  test("textrank_confidence: low surfaces the same way", () => {
    const lowConf = {
      ...baseFixture,
      textRank: { ...baseFixture.textRank, confidence: "low" as const },
    };
    const out = renderChapterCard(lowConf);
    expect(out).toMatch(/^---\ntextrank_confidence: low\n---\n/);
  });

  test("output is a string, ends with single trailing newline", () => {
    const out = renderChapterCard(baseFixture);
    expect(typeof out).toBe("string");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
