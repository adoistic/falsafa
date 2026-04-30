import { describe, expect, test } from "bun:test";
import { tokenize, type Language } from "./tokenize";

describe("language-aware tokenize (D5)", () => {
  test("English: applies English stopwords, lowercase, ≥3 char filter", () => {
    const out = tokenize("The dharma of the cosmos.", "english");
    expect(out).toContain("dharma");
    expect(out).toContain("cosmos");
    expect(out).not.toContain("the"); // English stopword
    expect(out).not.toContain("of"); // English stopword (2 chars anyway)
  });

  test("Sanskrit: preserves diacritics (D5: ātmā stays atomic)", () => {
    const out = tokenize("ātmā samāhitaḥ vidyā", "sanskrit");
    expect(out).toContain("ātmā");
    expect(out).toContain("samāhitaḥ");
    expect(out).toContain("vidyā");
  });

  test("Urdu: preserves hyphenated compounds as ONE token (D5)", () => {
    const out = tokenize("dil-e-naadan tujhe hua kya hai", "urdu");
    expect(out).toContain("dil-e-naadan");
    expect(out).not.toContain("naadan"); // not split on hyphen
  });

  test("Sanskrit: preserves hyphenated compounds (varna-dharma stays atomic)", () => {
    const out = tokenize("varna-dharma is the topic", "sanskrit");
    expect(out).toContain("varna-dharma");
  });

  test("Old English: applies Toronto OE Corpus stopwords", () => {
    // 'and' / 'on' are in the Toronto OE stopword list
    const out = tokenize("Wyrd biþ ful aræd and on heofon", "old-english");
    expect(out).toContain("wyrd");
    expect(out).toContain("heofon");
    expect(out).not.toContain("and");
    expect(out).not.toContain("on");
  });

  test("French: applies French stopwords", () => {
    const out = tokenize("La liberté est essentielle.", "french");
    expect(out).toContain("liberté");
    expect(out).toContain("essentielle");
    expect(out).not.toContain("est"); // French stopword
  });

  test("German: applies German stopwords", () => {
    const out = tokenize("Die Freiheit ist eine Notwendigkeit.", "german");
    expect(out).toContain("freiheit");
    expect(out).toContain("notwendigkeit");
    expect(out).not.toContain("die"); // German stopword
    expect(out).not.toContain("ist"); // German stopword
  });

  test("kawi (Old Javanese transliterated): no stopword removal", () => {
    // No canonical Kawi stopword list — let TF-IDF handle high-DF terms
    const out = tokenize("san hyan tattvajñāna ikang", "kawi");
    expect(out.length).toBeGreaterThan(2);
  });

  test("rejects unknown languages by throwing", () => {
    expect(() => tokenize("test", "klingon" as Language)).toThrow();
  });

  test("smart quotes don't pollute token edges", () => {
    const out = tokenize(`"smartquoted"text 'apostrophed'word`, "english");
    expect(out).toContain("smartquoted");
    expect(out).toContain("text");
    expect(out).toContain("apostrophed");
  });

  test("RTL marks and zero-width characters are not preserved as token chars", () => {
    const input = "test‏text‍other";
    const out = tokenize(input, "english");
    // Either a single fused token (preserved as boundary char) or split — but
    // tokens with embedded RTL marks shouldn't surface as user-visible tokens.
    for (const t of out) {
      expect(t).not.toContain("‏");
      expect(t).not.toContain("‍");
    }
  });

  test("idempotent on stopword-free Sanskrit (re-tokenization stable)", () => {
    const input = "ātmā varna-dharma puruṣa hiraṇyagarbha";
    const once = tokenize(input, "sanskrit");
    const twice = tokenize(once.join(" "), "sanskrit");
    expect(twice).toEqual(once);
  });
});
