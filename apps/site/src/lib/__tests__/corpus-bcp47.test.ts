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
