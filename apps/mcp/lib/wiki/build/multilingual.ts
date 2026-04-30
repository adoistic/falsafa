/**
 * Multilingual policy per design D5: which file does the original-language
 * signature pipeline read from?
 *
 *   src = (language is Roman-script-native AND has original.md) ? "original.md"
 *       : (transliteration.md exists)                            ? "transliteration.md"
 *       : null  // omit the section entirely
 *
 * Roman-script-native languages: English, French, German, Old English, Latin.
 *   These ship with `original.md` already in Roman script.
 *
 * Non-Roman with transliteration: Sanskrit, Urdu, Kawi (Old Javanese).
 *   These have a `transliteration.md` sidecar that's already Romanized.
 *
 * Anything else: skip the original-language signature row in the wiki card.
 * Falsafa's current 37 works all have a usable Roman-script source after
 * the Nyāya Tilakam removal; the "skip" branch is dead code today but kept
 * for future ingestion.
 *
 * Returned `kind` distinguishes the two non-null paths so downstream
 * tooling can label the wiki section header correctly:
 *   "Original-language signature (sanskrit, top-3)" — kind="transliteration"
 *   "Original-language signature (french, top-3)"   — kind="native-roman"
 */

import type { Language } from "../tokenize";

export interface RomanSourceFiles {
  hasOriginal: boolean;
  hasTransliteration: boolean;
}

export interface RomanSourceResult {
  source: "original.md" | "transliteration.md";
  kind: "native-roman" | "transliteration";
}

const NATIVE_ROMAN: Set<Language> = new Set([
  "english",
  "french",
  "german",
  "old-english",
  "latin",
]);

const NON_ROMAN_WITH_TRANSLIT: Set<Language> = new Set([
  "sanskrit",
  "urdu",
  "kawi",
]);

export function pickRomanSource(
  language: Language,
  files: RomanSourceFiles,
): RomanSourceResult | null {
  if (NATIVE_ROMAN.has(language) && files.hasOriginal) {
    return { source: "original.md", kind: "native-roman" };
  }
  if (NON_ROMAN_WITH_TRANSLIT.has(language) && files.hasTransliteration) {
    return { source: "transliteration.md", kind: "transliteration" };
  }
  return null;
}
