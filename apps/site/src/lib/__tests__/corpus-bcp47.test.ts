import { describe, expect, it } from "bun:test";
import { bcp47Of, isRtl } from "../corpus";

describe("bcp47Of", () => {
  it("returns base language for English translation", () => {
    expect(bcp47Of({ language: "en", script: undefined })).toBe("en");
  });
  it("returns language-script for Urdu original (Arabic script)", () => {
    expect(bcp47Of({ language: "ur", script: "Arab" })).toBe("ur-Arab");
  });
  it("returns language-script for Sanskrit transliteration (Latin)", () => {
    expect(bcp47Of({ language: "sa", script: "Latn" })).toBe("sa-Latn");
  });
  it("returns language-script for Sanskrit devanagari", () => {
    expect(bcp47Of({ language: "sa", script: "Deva" })).toBe("sa-Deva");
  });
  it("normalizes language to lowercase, script to title case", () => {
    expect(bcp47Of({ language: "UR", script: "ARAB" })).toBe("ur-Arab");
  });
  // Corpus-style inputs (long-form names from corpus/works/*/chapters/*/meta.json)
  it("normalizes corpus 'arabic' script to ISO 15924 'Arab'", () => {
    expect(bcp47Of({ language: "ur", script: "arabic" })).toBe("ur-Arab");
  });
  it("normalizes corpus 'latin' script to ISO 15924 'Latn'", () => {
    expect(bcp47Of({ language: "sa", script: "latin" })).toBe("sa-Latn");
  });
  it("drops unrecognized 'other' script (lang-only fallback)", () => {
    expect(bcp47Of({ language: "ur", script: "other" })).toBe("ur");
  });
  it("normalizes corpus language 'Urdu' to ISO 639 'ur'", () => {
    expect(bcp47Of({ language: "Urdu", script: "arabic" })).toBe("ur-Arab");
  });
  it("normalizes corpus language 'Sanskrit' to ISO 639 'sa'", () => {
    expect(bcp47Of({ language: "Sanskrit", script: "latin" })).toBe("sa-Latn");
  });
  it("normalizes corpus language 'old_english' to ISO 639 'ang'", () => {
    expect(bcp47Of({ language: "old_english", script: "latin" })).toBe("ang-Latn");
  });
  it("normalizes corpus language 'Kawi' to ISO 639 'kaw'", () => {
    expect(bcp47Of({ language: "Kawi", script: "latin" })).toBe("kaw-Latn");
  });
  it("normalizes corpus language 'French' to ISO 639 'fr'", () => {
    expect(bcp47Of({ language: "French" })).toBe("fr");
  });
  it("normalizes corpus language 'German' to ISO 639 'de'", () => {
    expect(bcp47Of({ language: "German" })).toBe("de");
  });
});

describe("isRtl", () => {
  it("identifies Urdu-Arabic as RTL", () => {
    expect(isRtl("ur-Arab")).toBe(true);
  });
  it("identifies Arabic as RTL", () => {
    expect(isRtl("ar")).toBe(true);
  });
  it("identifies Hebrew as RTL", () => {
    expect(isRtl("he")).toBe(true);
  });
  it("identifies English as LTR", () => {
    expect(isRtl("en")).toBe(false);
  });
  it("identifies Urdu-Latn as LTR", () => {
    expect(isRtl("ur-Latn")).toBe(false);
  });
  it("identifies Sanskrit-Deva as LTR", () => {
    expect(isRtl("sa-Deva")).toBe(false);
  });
});
