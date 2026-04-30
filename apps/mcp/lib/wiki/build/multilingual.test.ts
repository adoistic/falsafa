import { describe, expect, test } from "bun:test";
import { pickRomanSource, type RomanSourceFiles } from "./multilingual";

describe("pickRomanSource (multilingual policy per D5)", () => {
  test("Roman-script-native language with original.md → use original", () => {
    const files: RomanSourceFiles = {
      hasOriginal: true,
      hasTransliteration: true,
    };
    expect(pickRomanSource("english", files)).toEqual({
      source: "original.md",
      kind: "native-roman",
    });
    expect(pickRomanSource("french", files)).toEqual({
      source: "original.md",
      kind: "native-roman",
    });
    expect(pickRomanSource("german", files)).toEqual({
      source: "original.md",
      kind: "native-roman",
    });
    expect(pickRomanSource("old-english", files)).toEqual({
      source: "original.md",
      kind: "native-roman",
    });
    expect(pickRomanSource("latin", files)).toEqual({
      source: "original.md",
      kind: "native-roman",
    });
  });

  test("Non-Roman language with transliteration available → use transliteration", () => {
    const files: RomanSourceFiles = {
      hasOriginal: true,
      hasTransliteration: true,
    };
    expect(pickRomanSource("sanskrit", files)).toEqual({
      source: "transliteration.md",
      kind: "transliteration",
    });
    expect(pickRomanSource("urdu", files)).toEqual({
      source: "transliteration.md",
      kind: "transliteration",
    });
    expect(pickRomanSource("kawi", files)).toEqual({
      source: "transliteration.md",
      kind: "transliteration",
    });
  });

  test("Non-Roman with NO transliteration → null (skip original-lang signature)", () => {
    const files: RomanSourceFiles = {
      hasOriginal: true,
      hasTransliteration: false,
    };
    expect(pickRomanSource("sanskrit", files)).toBeNull();
  });

  test("Roman-script-native missing original → null (graceful skip)", () => {
    const files: RomanSourceFiles = {
      hasOriginal: false,
      hasTransliteration: false,
    };
    expect(pickRomanSource("french", files)).toBeNull();
  });

  test("Unknown language → null (defensive)", () => {
    const files: RomanSourceFiles = {
      hasOriginal: true,
      hasTransliteration: true,
    };
    // Pass at runtime via cast; we want the function to handle unexpected input
    expect(pickRomanSource("klingon" as never, files)).toBeNull();
  });
});
