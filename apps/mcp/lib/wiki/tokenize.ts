/**
 * Language-aware tokenizer for the wiki layer per design D5.
 *
 * Rules (from docs/designs/wiki-layer-rule-based-summaries.md, locked
 * in engineering review on 2026-04-30):
 *
 *   - Lowercase always.
 *   - Split on whitespace + brackets/parens + most punctuation,
 *     **but NOT on hyphens** — hyphenated compounds stay atomic
 *     ("dil-e-naadan", "varna-dharma", "self-existent").
 *   - Preserve diacritics (no NFKD normalization). "ātmā" stays one
 *     token; not "atma".
 *   - Drop tokens of length < 3.
 *   - Apply per-language stopword list when available.
 *
 * Languages without a stopword list (sanskrit, urdu, kawi, latin):
 * no stopword removal. TF-IDF handles high-DF terms via the IDF score
 * itself, so a hand-curated stopword list isn't required.
 *
 * This is INTENTIONALLY different from apps/mcp/lib/tfidf.ts's
 * tokenize(): that one matches the cross-link.ts behavior (English-
 * stopword-aware regex `[^a-z']+` that also strips hyphens). The wiki
 * layer needs richer multilingual handling.
 */

import { EN_STOPWORDS } from "./stopwords/en";
import { FR_STOPWORDS } from "./stopwords/fr";
import { DE_STOPWORDS } from "./stopwords/de";
import { OE_STOPWORDS } from "./stopwords/oe";

export type Language =
  | "english"
  | "french"
  | "german"
  | "old-english"
  | "sanskrit"
  | "urdu"
  | "kawi"
  | "latin";

/**
 * Token boundary regex. Splits on:
 *   - whitespace
 *   - brackets / parens / curly / angle
 *   - most punctuation (period, comma, semi/colon, !?…)
 *   - both straight and smart quotes ("'""'')
 *   - em-dash / en-dash (— –)
 *
 * Does NOT split on:
 *   - hyphens (compounds preserved per D5)
 *   - apostrophes inside words (don't, l'âme)
 *
 * The /u flag matters for Unicode property correctness with diacritics.
 */
const TOKEN_RE = /[\s,.;:()\[\]{}<>"'!?—–…“”‘’]+/u;

/** RTL marks, ZWJ, ZWNJ — strip from input before tokenizing. */
const ZERO_WIDTH_RE = /[​-‏‪-‮⁠﻿]/g;

const STOPWORDS_BY_LANG: Partial<Record<Language, Set<string>>> = {
  english: EN_STOPWORDS,
  french: FR_STOPWORDS,
  german: DE_STOPWORDS,
  "old-english": OE_STOPWORDS,
};

const KNOWN_LANGS: Set<Language> = new Set([
  "english",
  "french",
  "german",
  "old-english",
  "sanskrit",
  "urdu",
  "kawi",
  "latin",
]);

export function tokenize(body: string, language: Language): string[] {
  if (!KNOWN_LANGS.has(language)) {
    throw new Error(`Unknown language: ${language}`);
  }
  const stopwords = STOPWORDS_BY_LANG[language];
  // Strip zero-width / RTL marks first so they can't surface inside tokens.
  const cleaned = body.replace(ZERO_WIDTH_RE, " ");
  return cleaned
    .toLowerCase()
    .split(TOKEN_RE)
    .filter((t) => t.length >= 3 && !stopwords?.has(t));
}
