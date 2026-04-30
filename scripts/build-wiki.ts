#!/usr/bin/env bun
/**
 * Build the wiki layer for the entire corpus or a single work.
 *
 * Reads corpus/manifest.json, walks every (work × chapter), computes the
 * statistical primitives (TF-IDF n-grams, NPMI, TextRank, refrains,
 * vocabulary stats), renders chapter cards + full sheets + per-work cards
 * + full sheets, writes atomically to corpus/works/<slug>/wiki/<chapter>.card.md
 * and friends.
 *
 * Modes:
 *   --check         build to memory; diff vs on-disk; exit 1 if differ.
 *                   This is the D4 CI staleness gate.
 *   --work <slug>   single-work rebuild (faster dev loop)
 *   --corpus <dir>  override the corpus root (default: ../corpus relative to
 *                   this script). Used by integration tests against a
 *                   fixture corpus.
 *   --quiet         suppress per-work logging
 *
 * Default behavior: full corpus rebuild, write to disk, log progress.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";

import { buildTfIdf, cosine, type DocVector } from "../apps/mcp/lib/tfidf";
import { tokenize, type Language } from "../apps/mcp/lib/wiki/tokenize";
import { ngrams } from "../apps/mcp/lib/wiki/ngrams";
import { computeNPMI } from "../apps/mcp/lib/wiki/npmi";
import { textRank } from "../apps/mcp/lib/wiki/textrank";
import { lexRank } from "../apps/mcp/lib/wiki/lexrank";
import { detectRefrains } from "../apps/mcp/lib/wiki/refrains";
import {
  typeTokenRatio,
  hapaxRatio,
  burrowsDelta,
} from "../apps/mcp/lib/wiki/stylometry";
import {
  renderChapterCard,
  type ChapterRenderInput,
} from "../apps/mcp/lib/wiki/render-card";
import {
  renderWorkCard,
  type WorkRenderInput,
  type WorkChapterEntry,
} from "../apps/mcp/lib/wiki/render-work-card";
import {
  renderChapterFull,
  type ChapterFullInput,
} from "../apps/mcp/lib/wiki/render-full";
import {
  renderWorkFull,
  type WorkFullInput,
} from "../apps/mcp/lib/wiki/render-work-full";
import { atomicWriteFile } from "../apps/mcp/lib/wiki/build/atomic-write";
import { pickRomanSource } from "../apps/mcp/lib/wiki/build/multilingual";

// ─────────────────────────────────────────────────────────────────────────
// Types — shapes the orchestrator carries internally
// ─────────────────────────────────────────────────────────────────────────

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  era: string;
  language: string;
  language_slug?: string;
  total_logical_chapters: number;
}

interface Manifest {
  works: ManifestWork[];
}

type ParagraphRecord = { id: string; text: string; offset?: number };
/**
 * Some corpus chapters store paragraphs as a top-level array; others as
 * `{paragraphs: [...]}`. Both shapes appear in the corpus today; load
 * defensively.
 */
type ParagraphsFile = ParagraphRecord[] | { paragraphs: ParagraphRecord[] };
function paragraphsOf(raw: ParagraphsFile): ParagraphRecord[] {
  if (Array.isArray(raw)) return raw;
  return raw.paragraphs ?? [];
}

interface LoadedChapter {
  workSlug: string;
  workTitle: string;
  workAuthor: string;
  workEra: string;
  workLanguage: Language;
  workLayout: string; // verse | prose | manuscript
  chapterNumber: number;
  chapterSlug: string; // e.g. "01-aa-ke-meri-jaan-..."
  chapterDir: string; // absolute path to corpus/works/<slug>/chapters/<chapter-slug>
  /** English translation paragraphs with stable [p-XXXXXX] hashes. */
  paragraphs: { id: string; text: string }[];
  /** English-translation tokens (full chapter, language-aware tokenized). */
  tokens: string[];
  /** Per-paragraph tokens for the similarity matrix. */
  paragraphTokens: string[][];
  /** Total English word count. */
  wordCount: number;
  /** Optional Roman-script source for the original-language signature. */
  originalRoman: { language: Language; tokens: string[] } | null;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────

interface Args {
  check: boolean;
  workSlug: string | null;
  corpus: string;
  quiet: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    check: false,
    workSlug: null,
    corpus: resolve(import.meta.dir, "..", "corpus"),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--check") out.check = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--work") out.workSlug = argv[++i] ?? null;
    else if (a === "--corpus") out.corpus = resolve(argv[++i] ?? out.corpus);
  }
  return out;
}

function log(quiet: boolean, ...args: unknown[]): void {
  if (!quiet) console.log(...args);
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter helper (minimal — we don't need YAML for our chapter bodies)
// ─────────────────────────────────────────────────────────────────────────

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;
  return raw.slice(end + 4).replace(/^\n+/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// Language → Language enum mapping
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
      // throwing, since a single misclassified work shouldn't block the build.
      return "english";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Corpus loader
// ─────────────────────────────────────────────────────────────────────────

export function loadCorpus(corpusRoot: string, onlyWork?: string): LoadedChapter[] {
  const manifestPath = join(corpusRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const out: LoadedChapter[] = [];
  for (const w of manifest.works) {
    if (onlyWork && w.slug !== onlyWork) continue;
    const chDir = join(corpusRoot, "works", w.slug, "chapters");
    if (!existsSync(chDir)) continue;
    const lang = manifestLangToTokenizer(w.language_slug ?? w.language);
    for (const cdir of readdirSync(chDir)) {
      const chPath = join(chDir, cdir);
      if (!statSync(chPath).isDirectory()) continue;
      const metaPath = join(chPath, "meta.json");
      if (!existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
        chapter_number: number;
        chapter_slug: string;
        layout?: string;
      };
      const transPath = join(chPath, "translation.md");
      const paragraphsPath = join(chPath, "translation.paragraphs.json");
      if (!existsSync(transPath) || !existsSync(paragraphsPath)) continue;
      const transRaw = readFileSync(transPath, "utf-8");
      const transBody = stripFrontmatter(transRaw);
      const paragraphsFile = JSON.parse(
        readFileSync(paragraphsPath, "utf-8"),
      ) as ParagraphsFile;
      const paragraphs = paragraphsOf(paragraphsFile);
      // Token streams: chapter-level for distinctive-terms, paragraph-level
      // for the similarity matrix that feeds TextRank/LexRank.
      const tokens = tokenize(transBody, "english"); // English translation always
      const paragraphTokens = paragraphs.map((p) => tokenize(p.text, "english"));
      // Roman-script source for the original-language signature
      const hasOriginal = existsSync(join(chPath, "original.md"));
      const hasTranslit = existsSync(join(chPath, "transliteration.md"));
      let originalRoman: LoadedChapter["originalRoman"] = null;
      const romanPick = pickRomanSource(lang, {
        hasOriginal,
        hasTransliteration: hasTranslit,
      });
      if (romanPick) {
        const romanPath = join(chPath, romanPick.source);
        const romanBody = stripFrontmatter(readFileSync(romanPath, "utf-8"));
        originalRoman = {
          language: lang,
          tokens: tokenize(romanBody, lang),
        };
      }
      const wordCount = transBody.split(/\s+/).filter(Boolean).length;
      out.push({
        workSlug: w.slug,
        workTitle: w.title,
        workAuthor: w.author,
        workEra: w.era,
        workLanguage: lang,
        workLayout: meta.layout ?? "prose",
        chapterNumber: meta.chapter_number,
        chapterSlug: meta.chapter_slug,
        chapterDir: chPath,
        paragraphs,
        tokens,
        paragraphTokens,
        wordCount,
        originalRoman,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-chapter primitives + rendering
// ─────────────────────────────────────────────────────────────────────────

interface ChapterPrimitives {
  card: ChapterRenderInput;
  full: ChapterFullInput;
  /** Truncated TextRank #1 sentence used in the work-level chapter map. */
  chapterMapEntry: WorkChapterEntry;
}

function buildChapterPrimitives(
  ch: LoadedChapter,
  corpusVectors: Map<string, DocVector>,
  corpusTfMaps: Map<string, Map<string, number>>,
  workChaptersById: Map<string, LoadedChapter>,
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

  // --- NPMI top-10 over paragraphs ---
  const npmiTop10 = computeNPMI(ch.paragraphTokens, { minJointCount: 2 }).slice(0, 10);

  // --- Paragraph similarity matrix → TextRank, LexRank, refrains ---
  const paraDocs = new Map<string, string[]>();
  for (let i = 0; i < ch.paragraphs.length; i++) {
    paraDocs.set(`p${i}`, ch.paragraphTokens[i] ?? []);
  }
  const paraVectors = buildTfIdf(paraDocs);
  const N = ch.paragraphs.length;
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
  const refrains = detectRefrains(
    ch.paragraphs.map((p, i) => ({ id: p.id, tokens: ch.paragraphTokens[i] ?? [] })),
    { threshold: 0.05 },
  );

  // --- Vocabulary stats ---
  const ttr = typeTokenRatio(ch.tokens);
  const hapax = hapaxRatio(ch.tokens);

  // --- Cross-corpus nearest chapters (top-3) ---
  const myVec = corpusVectors.get(myKey);
  const nearestRaw: { key: string; cosine: number }[] = [];
  if (myVec) {
    for (const [otherKey, otherVec] of corpusVectors) {
      if (otherKey === myKey) continue;
      const c = cosine(myVec, otherVec);
      if (c > 0) nearestRaw.push({ key: otherKey, cosine: c });
    }
  }
  nearestRaw.sort((a, b) => b.cosine - a.cosine);
  const nearestInCorpus = nearestRaw.slice(0, 3).map((r) => {
    const [otherSlug, otherChapterSlug] = r.key.split("/");
    const other = workChaptersById.get(r.key);
    const workShort = other?.workTitle ?? otherSlug ?? "?";
    const chNum = other?.chapterNumber ?? parseChapterNumber(otherChapterSlug ?? "");
    return {
      workShortName: workShort,
      chapterNumber: chNum,
      cosine: r.cosine,
    };
  });

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
  const myTfMap = corpusTfMaps.get(myKey) ?? new Map<string, number>();
  const sameWorkTfMaps: Map<string, number>[] = [];
  for (const [k, m] of corpusTfMaps) {
    if (k === myKey) continue;
    if (k.startsWith(`${ch.workSlug}/`)) sameWorkTfMaps.push(m);
  }
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

function parseChapterNumber(slug: string): number {
  const m = slug.match(/^(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-work aggregates
// ─────────────────────────────────────────────────────────────────────────

function buildWorkPrimitives(
  workSlug: string,
  workTitle: string,
  workAuthor: string,
  workEra: string,
  workLanguage: string,
  workLayout: string,
  workChapters: LoadedChapter[],
  chapterEntries: WorkChapterEntry[],
  corpusVectors: Map<string, DocVector>,
  corpusByWork: Map<string, LoadedChapter[]>,
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

  // Phrases unique to this work (vs. rest of corpus): trigrams in this work
  // that don't appear in any chapter of any other work
  const otherTri = new Set<string>();
  for (const [otherSlug, chapters] of corpusByWork) {
    if (otherSlug === workSlug) continue;
    for (const ch of chapters) {
      for (const tg of ngrams(ch.tokens, 3)) otherTri.add(tg.join(" "));
    }
  }
  const uniquePhrases = [...triCounts.entries()]
    .filter(([k]) => !otherTri.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);

  // Statistically nearest works (top-4 by max chapter-pair cosine)
  const myKeys = workChapters.map((c) => `${c.workSlug}/${c.chapterSlug}`);
  const otherWorkBest = new Map<string, number>();
  for (const otherSlug of corpusByWork.keys()) {
    if (otherSlug === workSlug) continue;
    const otherChapters = corpusByWork.get(otherSlug) ?? [];
    let best = 0;
    for (const my of myKeys) {
      const myVec = corpusVectors.get(my);
      if (!myVec) continue;
      for (const oc of otherChapters) {
        const otherKey = `${oc.workSlug}/${oc.chapterSlug}`;
        const otherVec = corpusVectors.get(otherKey);
        if (!otherVec) continue;
        const c = cosine(myVec, otherVec);
        if (c > best) best = c;
      }
    }
    otherWorkBest.set(otherSlug, best);
  }
  const nearestWorks = [...otherWorkBest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([slug, c]) => ({
      workShortName: corpusByWork.get(slug)?.[0]?.workTitle ?? slug,
      cosine: c,
    }));

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
// Main
// ─────────────────────────────────────────────────────────────────────────

export interface BuildResult {
  wrote: number;
  unchanged: number;
  drift: string[]; // file paths that would change in --check mode
}

export async function buildWiki(
  corpusRoot: string,
  opts: { check?: boolean; onlyWork?: string; quiet?: boolean } = {},
): Promise<BuildResult> {
  const t0 = performance.now();
  const quiet = opts.quiet ?? false;
  log(quiet, `[build-wiki] loading corpus: ${corpusRoot}${opts.onlyWork ? ` (work=${opts.onlyWork})` : ""}`);
  const chapters = loadCorpus(corpusRoot, opts.onlyWork);
  log(quiet, `[build-wiki] loaded ${chapters.length} chapters`);

  // Corpus-wide TF-IDF over chapters (for nearest-in-corpus on chapter cards)
  const tokenLists = new Map<string, string[]>();
  const tfMaps = new Map<string, Map<string, number>>(); // for Burrows' Delta
  for (const ch of chapters) {
    const key = `${ch.workSlug}/${ch.chapterSlug}`;
    tokenLists.set(key, ch.tokens);
    const tf = new Map<string, number>();
    for (const t of ch.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const total = ch.tokens.length || 1;
    for (const [k, v] of tf) tf.set(k, v / total); // normalize to fractions
    tfMaps.set(key, tf);
  }
  const corpusVectors = buildTfIdf(tokenLists);
  log(quiet, `[build-wiki] built corpus TF-IDF index (N=${chapters.length})`);

  // Index lookups
  const chaptersByKey = new Map<string, LoadedChapter>();
  const chaptersByWork = new Map<string, LoadedChapter[]>();
  for (const ch of chapters) {
    const key = `${ch.workSlug}/${ch.chapterSlug}`;
    chaptersByKey.set(key, ch);
    if (!chaptersByWork.has(ch.workSlug)) chaptersByWork.set(ch.workSlug, []);
    chaptersByWork.get(ch.workSlug)!.push(ch);
  }

  // Per-chapter primitives + write
  let wrote = 0;
  let unchanged = 0;
  const drift: string[] = [];
  const workChapterEntries = new Map<string, WorkChapterEntry[]>();
  for (const ch of chapters) {
    const prim = buildChapterPrimitives(ch, corpusVectors, tfMaps, chaptersByKey);
    const cardMd = renderChapterCard(prim.card);
    const fullMd = renderChapterFull(prim.full);
    const wikiDir = join(corpusRoot, "works", ch.workSlug, "wiki");
    const cardPath = join(wikiDir, `${ch.chapterSlug}.card.md`);
    const fullPath = join(wikiDir, `${ch.chapterSlug}.full.md`);
    const r1 = handleWrite(cardPath, cardMd, opts.check ?? false, drift);
    const r2 = handleWrite(fullPath, fullMd, opts.check ?? false, drift);
    if (r1) wrote++;
    else unchanged++;
    if (r2) wrote++;
    else unchanged++;
    if (!workChapterEntries.has(ch.workSlug)) workChapterEntries.set(ch.workSlug, []);
    workChapterEntries.get(ch.workSlug)!.push(prim.chapterMapEntry);
  }
  log(quiet, `[build-wiki] processed ${chapters.length} chapters`);

  // Per-work aggregates + write
  for (const [workSlug, workChapters] of chaptersByWork) {
    const first = workChapters[0]!;
    const entries = workChapterEntries.get(workSlug) ?? [];
    const { card, full } = buildWorkPrimitives(
      workSlug,
      first.workTitle,
      first.workAuthor,
      first.workEra,
      first.workLanguage,
      first.workLayout,
      workChapters,
      entries,
      corpusVectors,
      chaptersByWork,
    );
    const wikiDir = join(corpusRoot, "works", workSlug, "wiki");
    const cardPath = join(wikiDir, "_work.card.md");
    const fullPath = join(wikiDir, "_work.full.md");
    const r1 = handleWrite(cardPath, renderWorkCard(card), opts.check ?? false, drift);
    const r2 = handleWrite(fullPath, renderWorkFull(full), opts.check ?? false, drift);
    if (r1) wrote++;
    else unchanged++;
    if (r2) wrote++;
    else unchanged++;
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  log(quiet, `[build-wiki] done in ${elapsed}s — wrote=${wrote} unchanged=${unchanged} drift=${drift.length}`);
  return { wrote, unchanged, drift };
}

function handleWrite(
  path: string,
  content: string,
  check: boolean,
  drift: string[],
): boolean {
  if (check) {
    if (!existsSync(path)) {
      drift.push(path);
      return false;
    }
    const existing = readFileSync(path, "utf-8");
    if (existing !== content) drift.push(path);
    return false;
  }
  return atomicWriteFile(path, content);
}

if (import.meta.main) {
  const args = parseArgs();
  const result = await buildWiki(args.corpus, {
    check: args.check,
    onlyWork: args.workSlug ?? undefined,
    quiet: args.quiet,
  });
  if (args.check && result.drift.length > 0) {
    console.error(`[build-wiki] STALE — ${result.drift.length} file(s) would change:`);
    for (const f of result.drift.slice(0, 20)) console.error(`  ${f}`);
    if (result.drift.length > 20) {
      console.error(`  ... and ${result.drift.length - 20} more`);
    }
    console.error("Run `bun run scripts/build-wiki.ts` to regenerate.");
    process.exit(1);
  }
}
