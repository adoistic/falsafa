/**
 * On-demand ("lazy") wiki computation.
 *
 * The wiki layer used to be a batch-built artifact: scripts/build-wiki.ts
 * walked every (work × chapter), computed the statistical primitives, and
 * wrote corpus/works/<slug>/wiki/*.md to disk. That build is too slow at
 * full-corpus scale, so the MCP now computes each card/full-sheet at request
 * time from the same primitives.
 *
 * This module carries over the orchestration that used to live in the build
 * script — `loadWorkChapters` (per-work loading), `buildChapterPrimitives`,
 * and `buildWorkPrimitives` — but:
 *
 *   1. It reads through the `Corpus` accessor (works in both local-file and
 *      future remote/HTTP modes) instead of touching the filesystem directly.
 *   2. It loads ONE work at a time (not the whole corpus) and memoizes the
 *      result per-process, keyed by work slug.
 *   3. The cross-corpus sections (nearest-in-corpus / nearest-works /
 *      phrases-unique-vs-corpus) are hardwired off — those are served by the
 *      separate `find_related` tool, so they're always empty here.
 *
 * The statistical + rendering primitives are imported unchanged from their
 * lib modules; nothing in lib/wiki/* is modified.
 */

import { buildTfIdf, cosine } from "../tfidf";
import { tokenize, type Language } from "./tokenize";
import { ngrams } from "./ngrams";
import { computeNPMI } from "./npmi";
import { textRank } from "./textrank";
import { lexRank } from "./lexrank";
import { detectRefrains } from "./refrains";
import { typeTokenRatio, hapaxRatio, burrowsDelta } from "./stylometry";
import {
  renderChapterCard,
  type ChapterRenderInput,
} from "./render-card";
import {
  renderChapterFull,
  type ChapterFullInput,
} from "./render-full";
import {
  renderWorkCard,
  type WorkRenderInput,
  type WorkChapterEntry,
} from "./render-work-card";
import {
  renderWorkFull,
  type WorkFullInput,
} from "./render-work-full";
import { pickRomanSource } from "./build/multilingual";
import { MCPError, type Corpus } from "../../src/corpus.ts";

// ─────────────────────────────────────────────────────────────────────────
// Types — shapes the orchestrator carries internally
// ─────────────────────────────────────────────────────────────────────────

interface LoadedChapter {
  workSlug: string;
  workTitle: string;
  workAuthor: string;
  workEra: string;
  workLanguage: Language;
  workLayout: string; // verse | prose | manuscript
  chapterNumber: number;
  chapterSlug: string; // e.g. "01-aa-ke-meri-jaan-..."
  /** English translation paragraphs with stable [p-XXXXXX] hashes. */
  paragraphs: { id: string; text: string }[];
  /** English-translation tokens (full chapter, language-aware tokenized). */
  tokens: string[];
  /**
   * Per-paragraph tokens for the similarity matrix. Only the first
   * PARA_TOKEN_CAP paragraphs are tokenized — every downstream consumer caps
   * paragraph work at that window (see MAX_SIM_PARAS / computeNPMI / refrains),
   * so tokens beyond it are never read. `paragraphs` above still holds every
   * paragraph (opens/closes/count need the full list).
   */
  paragraphTokens: string[][];
  /** Total English word count. */
  wordCount: number;
  /** Optional Roman-script source for the original-language signature. */
  originalRoman: { language: Language; tokens: string[] } | null;
}

interface ChapterPrimitives {
  card: ChapterRenderInput;
  full: ChapterFullInput;
  /** Truncated TextRank #1 sentence used in the work-level chapter map. */
  chapterMapEntry: WorkChapterEntry;
}

/**
 * Paragraph-window cap. Mega-"chapters" (Mahābhārata parva-1 has ~13k
 * paragraphs) would make the O(paras²) similarity/refrain steps intractable,
 * so every paragraph-level computation is bounded to this window. We also cap
 * paragraph TOKENIZATION here: since no consumer reads paragraphTokens beyond
 * this index, tokenizing further is pure waste. Kept equal to the
 * MAX_SIM_PARAS / computeNPMI caps below so the load and the compute agree.
 */
const PARA_TOKEN_CAP = 500;

// ─────────────────────────────────────────────────────────────────────────
// Language → Language enum mapping (carried from build-wiki.ts)
// ─────────────────────────────────────────────────────────────────────────

function manifestLangToTokenizer(s: string | undefined): Language {
  const lower = (s ?? "").toLowerCase().replace(/_/g, "-");
  switch (lower) {
    case "english":
    case "old-english":
    case "old english":
      return lower === "english" ? "english" : "old-english";
    case "french":
      return "french";
    case "german":
      return "german";
    case "sanskrit":
      return "sanskrit";
    case "urdu":
      return "urdu";
    case "kawi":
    case "old-javanese":
      return "kawi";
    case "latin":
      return "latin";
    default:
      // Default to english tokenization for unknown languages — better than
      // throwing, since a single misclassified work shouldn't block a request.
      return "english";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Per-work loader (through the Corpus accessor)
// ─────────────────────────────────────────────────────────────────────────

// Per-process caches (keyed by work slug, as the design specifies).
//   chapterCache: memoized per-chapter loads (a `null` marks a chapter with no
//     English body, so we don't re-probe it).
//   workChapterCache: the fully-assembled LoadedChapter[] for a work.
//   tfMapCache: the by-work tf-map index used for Burrows' Delta.
const chapterCache = new Map<string, Map<number, LoadedChapter | null>>();
const workChapterCache = new Map<string, LoadedChapter[]>();
const tfMapCache = new Map<string, { key: string; tf: Map<string, number> }[]>();

interface WorkMeta {
  title: string;
  author: string;
  era: string;
  language: string | undefined;
  languageSlug: string | undefined;
  lang: Language;
}
const workMetaCache = new Map<string, WorkMeta>();

function getWorkMeta(corpus: Corpus, workSlug: string): WorkMeta {
  const cached = workMetaCache.get(workSlug);
  if (cached) return cached;
  const work = corpus.findWork(workSlug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${workSlug}`);
  const meta: WorkMeta = {
    title: work.title,
    author: work.author,
    era: work.era,
    language: work.language,
    languageSlug: work.language_slug,
    lang: manifestLangToTokenizer(work.language_slug ?? work.language),
  };
  workMetaCache.set(workSlug, meta);
  return meta;
}

/**
 * Load ONE chapter into a LoadedChapter, mirroring build-wiki.ts's loadCorpus
 * per-chapter logic but reading through the Corpus accessor. Memoized per
 * (workSlug, chapterNumber). Returns `null` when the chapter has no English
 * body to summarize.
 *
 * English-body selection (same policy as loadCorpus): prefer the `translation`
 * variant; if there's none and the work's own language is English, use the
 * `original` variant; otherwise skip (a non-English original with no
 * translation — the wiki layer is built over English text).
 *
 * Per-chapter granularity matters at runtime: a chapter CARD only summarizes
 * its own chapter, so we load exactly that one chapter and never touch the
 * work's (possibly enormous) siblings.
 */
function loadChapter(
  corpus: Corpus,
  workSlug: string,
  chapterNumber: number,
): LoadedChapter | null {
  let byNum = chapterCache.get(workSlug);
  if (!byNum) {
    byNum = new Map<number, LoadedChapter | null>();
    chapterCache.set(workSlug, byNum);
  }
  if (byNum.has(chapterNumber)) return byNum.get(chapterNumber)!;

  const wm = getWorkMeta(corpus, workSlug);
  const lang = wm.lang;
  const cmeta = corpus.getChapterMeta(workSlug, chapterNumber); // throws CHAPTER_OUT_OF_RANGE

  // Choose the English body variant.
  const hasTranslation = cmeta.variants.some((v) => v.content_type === "translation");
  const hasOriginal = cmeta.variants.some((v) => v.content_type === "original");
  const hasTranslit = cmeta.variants.some((v) => v.content_type === "transliteration");
  let bodyVariant: "translation" | "original" | null = null;
  if (hasTranslation) bodyVariant = "translation";
  else if (lang === "english" && hasOriginal) bodyVariant = "original";
  if (!bodyVariant) {
    byNum.set(chapterNumber, null); // no English body → skip (memoized)
    return null;
  }

  const { variant, body } = corpus.readChapter(workSlug, chapterNumber, bodyVariant);
  const paragraphs = corpus.readParagraphs(workSlug, chapterNumber, variant.file);

  // Token streams: chapter-level for distinctive-terms + stylometry,
  // paragraph-level (capped) for the similarity matrix that feeds
  // TextRank/LexRank. English translation is always English-tokenized.
  const tokens = tokenize(body, "english");
  const paragraphTokens = paragraphs
    .slice(0, PARA_TOKEN_CAP)
    .map((p) => tokenize(p.text, "english"));

  // Roman-script source for the original-language signature.
  let originalRoman: LoadedChapter["originalRoman"] = null;
  const romanPick = pickRomanSource(lang, {
    hasOriginal,
    hasTransliteration: hasTranslit,
  });
  if (romanPick) {
    const romanType = romanPick.kind === "native-roman" ? "original" : "transliteration";
    const { body: romanBody } = corpus.readChapter(workSlug, chapterNumber, romanType);
    originalRoman = {
      language: lang,
      tokens: tokenize(romanBody, lang),
    };
  }

  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const loaded: LoadedChapter = {
    workSlug,
    workTitle: wm.title,
    workAuthor: wm.author,
    workEra: wm.era,
    workLanguage: lang,
    workLayout: cmeta.layout ?? "prose",
    chapterNumber: cmeta.chapter_number,
    chapterSlug: cmeta.chapter_slug,
    paragraphs: paragraphs.map((p) => ({ id: p.id, text: p.text })),
    tokens,
    paragraphTokens,
    wordCount,
    originalRoman,
  };
  byNum.set(chapterNumber, loaded);
  return loaded;
}

/**
 * Assemble the LoadedChapter array for a WHOLE work (skipping chapters with no
 * English body). Used by the work-level card/sheet and by the chapter FULL
 * sheet (whose Burrows' Delta needs every sibling). Memoized per work.
 */
function loadWorkChapters(corpus: Corpus, workSlug: string): LoadedChapter[] {
  const cached = workChapterCache.get(workSlug);
  if (cached) return cached;
  const out: LoadedChapter[] = [];
  for (const meta of corpus.listChapters(workSlug)) {
    const ch = loadChapter(corpus, workSlug, meta.chapter_number);
    if (ch) out.push(ch);
  }
  workChapterCache.set(workSlug, out);
  return out;
}

/**
 * Normalized term-frequency map for one chapter (term → fraction of tokens).
 * Feeds Burrows' Delta, which compares length-normalized frequencies across
 * the chapters of a single work.
 */
function tfMapOf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / total);
  return tf;
}

/**
 * Normalized term-frequency map for one chapter (term → fraction of tokens).
 * Feeds Burrows' Delta, which compares length-normalized frequencies across
 * the chapters of a single work.
 */
function tfMapOf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / total);
  return tf;
}

/** Build (and cache) the by-work tf-map index used for Burrows' Delta. */
function getWorkTfMaps(
  workSlug: string,
  chapters: LoadedChapter[],
): { key: string; tf: Map<string, number> }[] {
  const cached = tfMapCache.get(workSlug);
  if (cached) return cached;
  const maps = chapters.map((ch) => ({
    key: `${ch.workSlug}/${ch.chapterSlug}`,
    tf: tfMapOf(ch.tokens),
  }));
  tfMapCache.set(workSlug, maps);
  return maps;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-chapter primitives + rendering (carried from build-wiki.ts;
// crossCorpus hardwired off)
// ─────────────────────────────────────────────────────────────────────────

function buildChapterPrimitives(
  ch: LoadedChapter,
  workTfMaps: { key: string; tf: Map<string, number> }[],
): ChapterPrimitives {
  const myKey = `${ch.workSlug}/${ch.chapterSlug}`;

  // --- Distinctive trigrams (top-3) ---
  const tri = ngrams(ch.tokens, 3).map((t) => t.join(" "));
  const triCounts = new Map<string, number>();
  for (const t of tri) triCounts.set(t, (triCounts.get(t) ?? 0) + 1);
  const triTop3: { ngram: string; score: number }[] = [...triCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(tri.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Top-20 unigrams / bigrams / trigrams (for full sheet)
  const uniCounts = new Map<string, number>();
  for (const t of ch.tokens) uniCounts.set(t, (uniCounts.get(t) ?? 0) + 1);
  const uniTop20 = [...uniCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(ch.tokens.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const bi = ngrams(ch.tokens, 2).map((t) => t.join(" "));
  const biCounts = new Map<string, number>();
  for (const t of bi) biCounts.set(t, (biCounts.get(t) ?? 0) + 1);
  const biTop20 = [...biCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(bi.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const triTop20 = [...triCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(tri.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // --- NPMI top-10 over paragraphs (capped: mega-chapters have ~13k paras) ---
  const npmiTop10 = computeNPMI(ch.paragraphTokens.slice(0, PARA_TOKEN_CAP), { minJointCount: 2 }).slice(0, 10);

  // --- Paragraph similarity matrix → TextRank, LexRank, refrains ---
  // Cap the matrix window: some logical "chapters" are whole epics
  // (Mahābhārata parva-12 has ~12.9k paragraphs), where a full N×N matrix is
  // ~165M cosines and >1 GB. The top-passage summary only needs a bounded
  // window, so cap at MAX_SIM_PARAS; TextRank/LexRank rank within it.
  const MAX_SIM_PARAS = PARA_TOKEN_CAP;
  const N = Math.min(ch.paragraphs.length, MAX_SIM_PARAS);
  const paraDocs = new Map<string, string[]>();
  for (let i = 0; i < N; i++) {
    paraDocs.set(`p${i}`, ch.paragraphTokens[i] ?? []);
  }
  const paraVectors = buildTfIdf(paraDocs);
  const sim: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    sim[i]![i] = 1.0;
    for (let j = i + 1; j < N; j++) {
      const c = cosine(paraVectors.get(`p${i}`)!, paraVectors.get(`p${j}`)!);
      sim[i]![j] = c;
      sim[j]![i] = c;
    }
  }
  const trResult = textRank(sim);
  const lrResult = lexRank(sim);
  const trIndices = [...trResult.scores.keys()].sort(
    (a, b) => (trResult.scores[b] ?? 0) - (trResult.scores[a] ?? 0),
  );
  const lrIndices = [...lrResult.scores.keys()].sort(
    (a, b) => (lrResult.scores[b] ?? 0) - (lrResult.scores[a] ?? 0),
  );
  const trTop3 = trIndices.slice(0, 3).map((i) => ({
    id: ch.paragraphs[i]?.id ?? "p-unknown",
    text: (ch.paragraphs[i]?.text ?? "").trim(),
  }));
  const lrTop3 = lrIndices.slice(0, 3).map((i) => ({
    id: ch.paragraphs[i]?.id ?? "p-unknown",
    text: (ch.paragraphs[i]?.text ?? "").trim(),
  }));

  // --- Refrains (within-chapter) ---
  // Capped: detectRefrains is O(paras²) with per-pair edit distance, so a
  // 12.9k-paragraph mega-chapter would be ~82M pairs. The refrain signal is
  // within the same MAX_SIM_PARAS window used above.
  const refrains = detectRefrains(
    ch.paragraphs.slice(0, MAX_SIM_PARAS).map((p, i) => ({ id: p.id, tokens: ch.paragraphTokens[i] ?? [] })),
    { threshold: 0.05 },
  );

  // --- Vocabulary stats ---
  const ttr = typeTokenRatio(ch.tokens);
  const hapax = hapaxRatio(ch.tokens);

  // --- Cross-corpus nearest chapters: served by find_related, empty here. ---
  const nearestInCorpus: ChapterRenderInput["nearestInCorpus"] = [];

  // --- Original-language signature (top-3 trigrams) ---
  let originalLanguageSignature: ChapterRenderInput["originalLanguageSignature"] = null;
  if (ch.originalRoman) {
    const otri = ngrams(ch.originalRoman.tokens, 3).map((t) => t.join(" "));
    const otriCounts = new Map<string, number>();
    for (const t of otri) otriCounts.set(t, (otriCounts.get(t) ?? 0) + 1);
    const otriTop3 = [...otriCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    if (otriTop3.length > 0) {
      originalLanguageSignature = {
        language: ch.originalRoman.language,
        trigrams: otriTop3,
      };
    }
  }

  // --- Burrows' Delta vs other chapters of the same work ---
  const myTfMap = workTfMaps.find((e) => e.key === myKey)?.tf ?? new Map<string, number>();
  const sameWorkTfMaps = workTfMaps.filter((e) => e.key !== myKey).map((e) => e.tf);
  const burrows = sameWorkTfMaps.length > 0 ? burrowsDelta(myTfMap, sameWorkTfMaps) : 0;

  // --- Card input (small) ---
  const card: ChapterRenderInput = {
    workTitle: ch.workTitle,
    chapterNumber: ch.chapterNumber,
    layout: ch.workLayout,
    paragraphCount: ch.paragraphs.length,
    wordCount: ch.wordCount,
    vocabulary: {
      distinctTypes: new Set(ch.tokens).size,
      ttr,
      hapaxPct: hapax,
    },
    trigrams: triTop3,
    textRank: {
      confidence: trResult.confidence,
      paragraphs: trTop3.slice(0, 1),
    },
    opens: {
      id: ch.paragraphs[0]?.id ?? "p-empty",
      text: (ch.paragraphs[0]?.text ?? "").trim(),
    },
    closes: {
      id: ch.paragraphs[ch.paragraphs.length - 1]?.id ?? "p-empty",
      text: (ch.paragraphs[ch.paragraphs.length - 1]?.text ?? "").trim(),
    },
    refrain: refrains[0]
      ? {
          phrase: refrains[0].phrase,
          count: refrains[0].count,
          firstCite: refrains[0].cites[0] ?? "p-?",
        }
      : null,
    nearestInCorpus,
    originalLanguageSignature,
  };

  // --- Full input (extends card) ---
  const full: ChapterFullInput = {
    ...card,
    textRank: { ...card.textRank, paragraphs: trTop3 },
    unigramsTop20: uniTop20,
    bigramsTop20: biTop20,
    trigramsTop20: triTop20,
    npmiTop10: npmiTop10.map((p) => ({ a: p.a, b: p.b, npmi: p.npmi })),
    lexRank: { paragraphs: lrTop3 },
    allRefrains: refrains.map((r) => ({
      phrase: r.phrase,
      count: r.count,
      cites: r.cites,
    })),
    boundaryParagraphs: [], // v1 stub — boundary detection deferred
    burrowsDelta: burrows,
  };

  // --- Chapter-map entry (for the work card's chapter map) ---
  const chapterMapEntry: WorkChapterEntry = {
    chapterNumber: ch.chapterNumber,
    textRankFirstSentence: trTop3[0]?.text ?? card.opens.text,
  };

  return { card, full, chapterMapEntry };
}

// ─────────────────────────────────────────────────────────────────────────
// Per-work aggregates (carried from build-wiki.ts; crossCorpus hardwired off)
// ─────────────────────────────────────────────────────────────────────────

function buildWorkPrimitives(
  workTitle: string,
  workAuthor: string,
  workEra: string,
  workLanguage: string,
  workLayout: string,
  workChapters: LoadedChapter[],
  chapterEntries: WorkChapterEntry[],
): { card: WorkRenderInput; full: WorkFullInput } {
  // Aggregate tokens across all chapters of this work
  const allTokens: string[] = [];
  for (const c of workChapters) allTokens.push(...c.tokens);
  const totalWords = workChapters.reduce((s, c) => s + c.wordCount, 0);

  // Work-level top-12 trigrams
  const tri = ngrams(allTokens, 3).map((t) => t.join(" "));
  const triCounts = new Map<string, number>();
  for (const t of tri) triCounts.set(t, (triCounts.get(t) ?? 0) + 1);
  const workTrigrams = [...triCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => k);

  // Work-level NPMI top-6 over chapter-level token sets
  const npmiDocs = workChapters.map((c) => c.tokens);
  const workNPMI = computeNPMI(npmiDocs, { minJointCount: 2 })
    .slice(0, 6)
    .map((p) => ({ a: p.a, b: p.b, npmi: p.npmi }));

  // Top-50 unigrams/bigrams/trigrams (work level)
  const uniCounts = new Map<string, number>();
  for (const t of allTokens) uniCounts.set(t, (uniCounts.get(t) ?? 0) + 1);
  const uniTop50 = [...uniCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(allTokens.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  const bi = ngrams(allTokens, 2).map((t) => t.join(" "));
  const biCounts = new Map<string, number>();
  for (const t of bi) biCounts.set(t, (biCounts.get(t) ?? 0) + 1);
  const biTop50 = [...biCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(bi.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  const triTop50 = [...triCounts.entries()]
    .map(([k, v]) => ({ ngram: k, score: v / Math.max(tri.length, 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  // Phrases unique to this work + statistically nearest works: cross-corpus,
  // served by find_related. Empty here.
  const uniquePhrases: string[] = [];
  const nearestWorks: { workShortName: string; cosine: number }[] = [];

  const card: WorkRenderInput = {
    title: workTitle,
    author: workAuthor,
    era: workEra,
    language: workLanguage,
    layout: workLayout,
    chapterCount: workChapters.length,
    totalWords,
    workTrigrams,
    workNPMI,
    chapterMap: [...chapterEntries].sort(
      (a, b) => a.chapterNumber - b.chapterNumber,
    ),
    nearestWorks,
    uniquePhrases,
    originalLanguageSignature: null, // v1 stub; per-work original-lang aggregation is a v2
  };

  // Per-work Burrows' Delta against every other work (v1 stub: empty)
  const full: WorkFullInput = {
    ...card,
    unigramsTop50: uniTop50,
    bigramsTop50: biTop50,
    trigramsTop50: triTop50,
    burrowsAgainstOtherWorks: [],
  };

  return { card, full };
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────

/**
 * Render the wiki card ("card") or full sheet ("full") for a single chapter,
 * computed on demand. Throws MCPError if the chapter has no English body to
 * summarize (a non-English original without a translation).
 *
 * The chapter CARD never renders Burrows' Delta (that stylometric outlier
 * check lives only on the full sheet), so the card path loads just the target
 * chapter and passes an empty tf-map index — Burrows resolves to 0 in the
 * discarded `full` object with zero effect on the rendered card. This keeps
 * mega-works (e.g. Mahābhārata, 18 giant parvas) well under a second: we don't
 * tokenize every sibling just to compute a value the card never shows. The
 * full sheet loads the whole work so its Burrows' Delta is correct.
 */
export function chapterWiki(
  corpus: Corpus,
  workSlug: string,
  chapterNumber: number,
  variant: "card" | "full",
): string {
  let ch: LoadedChapter | null;
  let workTfMaps: { key: string; tf: Map<string, number> }[];
  if (variant === "full") {
    const chapters = loadWorkChapters(corpus, workSlug);
    workTfMaps = getWorkTfMaps(workSlug, chapters);
    ch = chapters.find((c) => c.chapterNumber === chapterNumber) ?? null;
  } else {
    ch = loadChapter(corpus, workSlug, chapterNumber);
    workTfMaps = []; // card omits Burrows' Delta; no siblings needed
  }
  if (!ch) {
    throw new MCPError(
      "VARIANT_NOT_FOUND",
      `No English wiki available for ${workSlug} chapter ${chapterNumber}`,
      "The wiki layer is built over English text; this chapter has no translation or English original.",
    );
  }
  const prim = buildChapterPrimitives(ch, workTfMaps);
  return variant === "card" ? renderChapterCard(prim.card) : renderChapterFull(prim.full);
}

/**
 * Render the per-work wiki card ("card") or full sheet ("full"), computed on
 * demand. Runs per-chapter primitives to assemble the chapter map.
 */
export function workWiki(
  corpus: Corpus,
  workSlug: string,
  variant: "card" | "full",
): string {
  const chapters = loadWorkChapters(corpus, workSlug);
  if (chapters.length === 0) {
    throw new MCPError(
      "VARIANT_NOT_FOUND",
      `No English wiki available for ${workSlug}`,
      "The wiki layer is built over English text; this work has no translated or English chapters.",
    );
  }
  const workTfMaps = getWorkTfMaps(workSlug, chapters);
  const chapterEntries = chapters.map(
    (ch) => buildChapterPrimitives(ch, workTfMaps).chapterMapEntry,
  );
  const first = chapters[0]!;
  const { card, full } = buildWorkPrimitives(
    first.workTitle,
    first.workAuthor,
    first.workEra,
    first.workLanguage,
    first.workLayout,
    chapters,
    chapterEntries,
  );
  return variant === "card" ? renderWorkCard(card) : renderWorkFull(full);
}

/** Test-only: clear the per-process wiki caches so tests can swap fixtures. */
export function _resetWikiCache(): void {
  chapterCache.clear();
  workChapterCache.clear();
  tfMapCache.clear();
  workMetaCache.clear();
}
