import { describe, expect, test } from "bun:test";
import {
  renderWorkCard,
  truncatedSentence,
  type WorkRenderInput,
} from "./render-work-card";

describe("truncatedSentence (helper)", () => {
  test("returns full text when shorter than maxLen", () => {
    expect(truncatedSentence("Short text.", 80)).toBe("Short text.");
  });

  test("truncates at first sentence-end period (when input exceeds maxLen)", () => {
    const input = "First sentence. Second sentence longer than the cap.";
    // input is 53 chars; cap=30 forces a truncation; the period at idx 14
    // is the natural break before the cap
    expect(truncatedSentence(input, 30)).toBe("First sentence.");
  });

  test("returns full text when maxLen is larger than input (no truncation)", () => {
    const input = "Short input under cap.";
    expect(truncatedSentence(input, 80)).toBe(input);
  });

  test("falls back to first comma when no period present", () => {
    const input = "Long opening clause, then more text continuing past the cap";
    const out = truncatedSentence(input, 40);
    expect(out.endsWith(",...") || out.endsWith(",")).toBe(true);
  });

  test("falls back to word boundary when no comma either", () => {
    const input = "alphabetagamma deltaepsilon zeta eta theta iota kappa lambda";
    const out = truncatedSentence(input, 30);
    expect(out.length).toBeLessThanOrEqual(33); // some slack for ellipsis
    expect(out.endsWith("...")).toBe(true);
  });

  test("does not truncate mid-word at the maxLen boundary", () => {
    const input = "abcdefghij klmnopqrst uvwxyz alpha beta gamma delta";
    const out = truncatedSentence(input, 25);
    // Last whitespace before 25 is between 'klmnopqrst' and 'uvwxyz' (idx 21);
    // truncate there + ellipsis
    expect(out).toBe("abcdefghij klmnopqrst...");
  });
});

const baseFixture: WorkRenderInput = {
  title: "Manusmṛti",
  author: "Manu",
  era: "Ancient",
  language: "Sanskrit",
  layout: "verse",
  chapterCount: 12,
  totalWords: 39720,
  workTrigrams: [
    "the twice-born",
    "the great-souled",
    "fish on a spit",
    "sons of bhrigu",
    "from his mouth",
    "as it pleased him",
    "path of dharma",
    "the self-existent",
    "rules of conduct",
    "the four orders",
    "the king should",
    "the brahmin who",
  ],
  workNPMI: [
    { a: "hiranyagarbha", b: "golden_egg", npmi: 0.91 },
    { a: "varna", b: "dharma", npmi: 0.76 },
    { a: "twice-born", b: "brahmin", npmi: 0.81 },
    { a: "sins", b: "rebirths", npmi: 0.7 },
    { a: "self-existent", b: "lord", npmi: 0.84 },
    { a: "kshatriya", b: "vaishya", npmi: 0.65 },
  ],
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
    {
      chapterNumber: 12,
      textRankFirstSentence:
        "The transmigration of beings is governed by their actions.",
    },
  ],
  nearestWorks: [
    { workShortName: "Yājñavalkya-smṛti", cosine: 0.58 },
    { workShortName: "Viṣṇu-smṛti", cosine: 0.51 },
    { workShortName: "Vīramitrodaya", cosine: 0.47 },
    { workShortName: "Parāśara-smṛti", cosine: 0.44 },
  ],
  uniquePhrases: [
    "hiranyagarbha",
    "fish on a spit",
    "mouth arms thighs feet",
    "hair-count",
    "the four yugas",
    "twice-born initiation",
    "sons of bhrigu",
    "self-existent lord",
  ],
  originalLanguageSignature: null,
};

describe("renderWorkCard", () => {
  test("emits header line with title", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain("# Manusmṛti");
  });

  test("emits metadata line with author/era/language/layout/chapter count/word count", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain(
      "Manu · Ancient · Sanskrit · verse · 12 chapters · 39,720 words",
    );
  });

  test("emits work-level distinctive trigrams (top-12) middot-separated", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain('"the twice-born"');
    expect(out).toContain('"the brahmin who"');
  });

  test("emits NPMI signature line (top-6) with + and rounded NPMI", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain("hiranyagarbha + golden_egg");
    expect(out).toContain("twice-born + brahmin");
  });

  test("emits chapter map: each row 'ch.N — sentence' with truncation", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain("ch.1  — Then the divine self-existent");
    expect(out).toContain("ch.2  — Eight forms of marriage are enumerated.");
    expect(out).toContain("ch.12 — The transmigration of beings");
  });

  test("emits statistically nearest works", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain("Yājñavalkya-smṛti  cosine 0.58");
    expect(out).toContain("Viṣṇu-smṛti        cosine 0.51");
  });

  test("emits unique phrases line", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).toContain('"hiranyagarbha" · "fish on a spit"');
  });

  test("omits Original-language section when null", () => {
    const out = renderWorkCard(baseFixture);
    expect(out).not.toContain("## Original-language signature");
  });

  test("emits Original-language section when present", () => {
    const out = renderWorkCard({
      ...baseFixture,
      originalLanguageSignature: {
        language: "sanskrit",
        trigrams: ["ātmā vai jāyate", "tat tvam asi", "neti neti", "saṃsāra mukti", "puruṣa prakṛti", "brahman ātman"],
      },
    });
    expect(out).toContain("## Original-language signature");
    expect(out).toContain('"ātmā vai jāyate"');
  });

  test("output ends with single trailing newline", () => {
    const out = renderWorkCard(baseFixture);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});
