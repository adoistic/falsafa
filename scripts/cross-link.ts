#!/usr/bin/env bun
/**
 * Build-time TF-IDF cross-link index for the Falsafa corpus.
 *
 * Reads every English chapter (`content_type: translation` or
 * native-English variant), tokenizes the body, computes a TF-IDF vector
 * per chapter, then writes the top-K most-similar peers per chapter to
 * `corpus/cross-links.json`. The MCP `find_related` tool reads this file
 * at runtime to surface content-based matches.
 *
 * Pure-JS implementation — no embeddings, no external libs. The corpus is
 * small enough that pairwise cosine over ~600 chapters is well under
 * 5 seconds in Bun.
 *
 * CLI:
 *   bun run scripts/cross-link.ts             # build index → corpus/cross-links.json
 *   bun run scripts/cross-link.ts --dry-run   # report stats + sample relateds
 *   bun run scripts/cross-link.ts --top-k 8   # override default K=5
 *
 * Algorithm:
 *   1. Tokenize: lowercase, split on [^a-z']+, drop tokens < 3 chars,
 *      drop ~50 high-frequency English stopwords.
 *   2. Skip chapters with < 50 tokens after filtering (regression guard
 *      against empty/near-empty chapters polluting the index).
 *   3. TF-IDF: tf = raw count, idf = log(N / df), vector = tf * idf per term.
 *   4. Cosine similarity pairwise; for each chapter take top-K (excl. self)
 *      above 0.05 cosine.
 *   5. Output deterministic JSON (sorted keys, sorted ties by slug) so the
 *      file is byte-stable across runs.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CORPUS = resolve(ROOT, "corpus");
const OUTPUT_PATH = resolve(CORPUS, "cross-links.json");

// ─────────────────────────────────────────────────────────────────────────
// Tokenization
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reused from scripts/reclassify-variants.ts so the two scripts agree on
 * what counts as English noise. ~50 high-frequency Modern-English words.
 */
const STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "that", "is", "was", "for",
  "it", "with", "as", "his", "be", "by", "on", "not", "this", "but",
  "are", "from", "or", "have", "an", "they", "which", "one", "you",
  "were", "her", "all", "she", "there", "would", "their", "we", "him",
  "been", "has", "when", "who", "will", "more", "no", "if", "out",
  "do", "what", "so", "up", "into", "your", "about", "just",
  "should", "could", "may", "might", "shall", "must",
  "had", "its", "our", "them", "than", "then", "where", "these", "those",
  "some", "any", "such", "only", "also", "now", "over", "very",
]);

/** Minimum tokens after filtering for a chapter to be indexed. */
export const MIN_TOKENS = 50;

/** Minimum cosine similarity for a pair to count as a "related" link. */
export const MIN_COSINE = 0.05;

/** Default top-K relateds per chapter. */
export const DEFAULT_TOP_K = 5;

/**
 * Tokenize an English-language body. Drops YAML frontmatter expected to
 * already be stripped by the caller (we receive `body` not the raw `.md`).
 * Returns lowercased tokens of length >= 3 with stopwords removed.
 */
export function tokenize(body: string): string[] {
  const lowered = body.toLowerCase();
  const raw = lowered.split(/[^a-z']+/);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter strip (minimal — body-only is what we need)
// ─────────────────────────────────────────────────────────────────────────

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;
  return raw.slice(end + 4).replace(/^\n+/, "");
}

// ─────────────────────────────────────────────────────────────────────────
// TF-IDF + cosine
// ─────────────────────────────────────────────────────────────────────────

export interface ChapterDoc {
  /** "<work_slug>/<chapter_slug>" — the index key. */
  key: string;
  work_slug: string;
  chapter_slug: string;
  chapter_number: number;
  /** Sparse vector: term → tf-idf weight. */
  vector: Map<string, number>;
  /** Pre-computed L2 norm for cosine. */
  norm: number;
}

/**
 * Build a TF map from a token list. Raw counts (no sublinear scaling) — the
 * corpus is small and chapters are short, so log-scaling muddies signal.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * Compute TF-IDF vectors + cosine norms for every input doc. `tokenLists` is
 * keyed by doc identifier; `df` is the document-frequency map shared across
 * the corpus. We return Map<key, {vector, norm}> for fast pairwise scoring.
 */
export function buildTfIdf(
  tokenLists: Map<string, string[]>,
): Map<string, { vector: Map<string, number>; norm: number }> {
  const N = tokenLists.size;
  // Document frequency: distinct chapters each term appears in.
  const df = new Map<string, number>();
  for (const tokens of tokenLists.values()) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  // Build TF-IDF vectors + norms.
  const out = new Map<string, { vector: Map<string, number>; norm: number }>();
  for (const [key, tokens] of tokenLists) {
    const tf = termFrequency(tokens);
    const vector = new Map<string, number>();
    let sumSq = 0;
    for (const [term, count] of tf) {
      const dfTerm = df.get(term) ?? 1;
      // log(N/df). When dfTerm == N (term in every doc), idf == 0 → drops out.
      const idf = Math.log(N / dfTerm);
      if (idf <= 0) continue;
      const w = count * idf;
      vector.set(term, w);
      sumSq += w * w;
    }
    out.set(key, { vector, norm: Math.sqrt(sumSq) });
  }
  return out;
}

/**
 * Cosine similarity over sparse maps. We iterate the smaller vector for the
 * dot product — typical chapters share only a few hundred terms.
 */
export function cosine(
  a: { vector: Map<string, number>; norm: number },
  b: { vector: Map<string, number>; norm: number },
): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] = a.vector.size <= b.vector.size ? [a.vector, b.vector] : [b.vector, a.vector];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += w * other;
  }
  return dot / (a.norm * b.norm);
}

// ─────────────────────────────────────────────────────────────────────────
// Corpus walk
// ─────────────────────────────────────────────────────────────────────────

interface ManifestWork {
  slug: string;
  title: string;
}

interface ChapterMeta {
  work_slug: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  default_variant: string;
  variants: Array<{
    file: string;
    content_type: string;
    language: string;
  }>;
}

/**
 * Locate the English variant for a chapter. Preference order:
 *   1. content_type === "translation" (the curated English)
 *   2. language === "english" + script === "latin" + content_type !== "transliteration"
 *      (covers native-English works like Smith/Comte/Dunoyer that ship without
 *      a separate translation variant — the "original" IS English).
 * We deliberately skip transliterations (romanized non-English).
 */
function pickEnglishVariant(meta: ChapterMeta): { file: string; content_type: string } | null {
  const trans = meta.variants.find((v) => v.content_type === "translation");
  if (trans) return { file: trans.file, content_type: trans.content_type };
  const nativeEng = meta.variants.find(
    (v) => v.language === "english" && v.content_type !== "transliteration",
  );
  if (nativeEng) return { file: nativeEng.file, content_type: nativeEng.content_type };
  return null;
}

interface LoadedChapter {
  key: string;
  work_slug: string;
  chapter_slug: string;
  chapter_number: number;
  body: string;
}

function loadAllEnglishChapters(corpusRoot: string): LoadedChapter[] {
  const manifestPath = join(corpusRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    works: ManifestWork[];
  };
  const out: LoadedChapter[] = [];
  for (const w of manifest.works) {
    const chaptersDir = join(corpusRoot, "works", w.slug, "chapters");
    if (!existsSync(chaptersDir)) continue;
    const chapterDirs = readdirSync(chaptersDir)
      .filter((d) => statSync(join(chaptersDir, d)).isDirectory())
      .sort();
    for (const cd of chapterDirs) {
      const metaPath = join(chaptersDir, cd, "meta.json");
      if (!existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as ChapterMeta;
      const eng = pickEnglishVariant(meta);
      if (!eng) continue;
      const filePath = join(chaptersDir, cd, eng.file);
      if (!existsSync(filePath)) continue;
      const raw = readFileSync(filePath, "utf-8");
      const body = stripFrontmatter(raw);
      out.push({
        key: `${w.slug}/${meta.chapter_slug}`,
        work_slug: w.slug,
        chapter_slug: meta.chapter_slug,
        chapter_number: meta.chapter_number,
        body,
      });
    }
  }
  // Stable order: work_slug then chapter_number.
  out.sort((a, b) => {
    if (a.work_slug !== b.work_slug) return a.work_slug < b.work_slug ? -1 : 1;
    return a.chapter_number - b.chapter_number;
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Index build
// ─────────────────────────────────────────────────────────────────────────

export interface RelatedLink {
  work_slug: string;
  chapter_slug: string;
  chapter_number: number;
  score: number;
}

export interface CrossLinkIndex {
  generated_at: string;
  method: "tfidf_v1";
  corpus_chapter_count: number;
  skipped_short_chapters: string[];
  links: Record<string, RelatedLink[]>;
}

export interface BuildOptions {
  topK?: number;
  /** Stable timestamp for deterministic output (test fixtures use this). */
  generatedAt?: string;
}

export interface BuildInput {
  /** Map<key, body> — body is the markdown body with frontmatter already stripped. */
  chapters: Array<{
    key: string;
    work_slug: string;
    chapter_slug: string;
    chapter_number: number;
    body: string;
  }>;
}

/**
 * Build a cross-link index from in-memory chapter bodies. Pure function (no
 * disk I/O) — tests use this entrypoint to fixture data through.
 */
export function buildIndex(input: BuildInput, options: BuildOptions = {}): CrossLinkIndex {
  const topK = options.topK ?? DEFAULT_TOP_K;

  // Tokenize + skip-short pass
  const tokenLists = new Map<string, string[]>();
  const chapterMeta = new Map<string, { work_slug: string; chapter_slug: string; chapter_number: number }>();
  const skipped: string[] = [];
  for (const ch of input.chapters) {
    const tokens = tokenize(ch.body);
    if (tokens.length < MIN_TOKENS) {
      skipped.push(ch.key);
      continue;
    }
    tokenLists.set(ch.key, tokens);
    chapterMeta.set(ch.key, {
      work_slug: ch.work_slug,
      chapter_slug: ch.chapter_slug,
      chapter_number: ch.chapter_number,
    });
  }

  // TF-IDF + norms
  const vectors = buildTfIdf(tokenLists);

  // Pairwise cosine. Sort keys for deterministic iteration order.
  const keys = [...vectors.keys()].sort();
  const links: Record<string, RelatedLink[]> = {};

  for (const k of keys) {
    const me = vectors.get(k)!;
    const myMeta = chapterMeta.get(k)!;
    const candidates: Array<{ key: string; score: number }> = [];
    for (const other of keys) {
      if (other === k) continue;
      const them = vectors.get(other)!;
      const score = cosine(me, them);
      if (score < MIN_COSINE) continue;
      candidates.push({ key: other, score });
    }
    // Sort by score desc, then key asc for stable ties.
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.key < b.key ? -1 : 1;
    });
    const top = candidates.slice(0, topK).map((c) => {
      const meta = chapterMeta.get(c.key)!;
      return {
        work_slug: meta.work_slug,
        chapter_slug: meta.chapter_slug,
        chapter_number: meta.chapter_number,
        // Round to 4 decimals for stable JSON output.
        score: Math.round(c.score * 10000) / 10000,
      };
    });
    // Self-exclusion sanity (defense in depth — `if (other === k) continue` above already excludes self)
    if (top.some((t) => `${t.work_slug}/${t.chapter_slug}` === k)) {
      throw new Error(`self-link leaked into related list for ${k}`);
    }
    void myMeta;
    links[k] = top;
  }

  // Sort skipped list for determinism.
  skipped.sort();

  return {
    generated_at: options.generatedAt ?? new Date().toISOString(),
    method: "tfidf_v1",
    corpus_chapter_count: tokenLists.size,
    skipped_short_chapters: skipped,
    links,
  };
}

/**
 * Serialize the index with stable, human-friendly formatting. Object keys are
 * already inserted in sorted order during build, so JSON.stringify preserves
 * that — giving us byte-identical output across runs (with a fixed timestamp).
 */
export function serializeIndex(idx: CrossLinkIndex): string {
  return JSON.stringify(idx, null, 2) + "\n";
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  topK: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, topK: DEFAULT_TOP_K };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--top-k") {
      const next = argv[++i];
      if (!next) throw new Error("--top-k requires a value");
      const n = parseInt(next, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--top-k expects positive integer, got ${next}`);
      out.topK = n;
    } else if (a?.startsWith("--top-k=")) {
      const n = parseInt(a.slice("--top-k=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--top-k expects positive integer, got ${a}`);
      out.topK = n;
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();

  console.log(`[cross-link] loading English chapters from ${CORPUS}...`);
  const chapters = loadAllEnglishChapters(CORPUS);
  console.log(`[cross-link] loaded ${chapters.length} English chapter(s)`);

  const idx = buildIndex({ chapters }, { topK: args.topK });
  const t1 = performance.now();

  console.log(
    `[cross-link] indexed ${idx.corpus_chapter_count} chapter(s) ` +
      `(skipped ${idx.skipped_short_chapters.length} short) ` +
      `in ${((t1 - t0) / 1000).toFixed(2)}s`,
  );
  if (idx.skipped_short_chapters.length > 0) {
    console.log(`[cross-link] skipped chapters (<${MIN_TOKENS} tokens after stopword filter):`);
    for (const k of idx.skipped_short_chapters.slice(0, 20)) console.log(`   - ${k}`);
    if (idx.skipped_short_chapters.length > 20) {
      console.log(`   ...and ${idx.skipped_short_chapters.length - 20} more`);
    }
  }

  // Sample 3 chapters' relateds for a sanity look.
  const allKeys = Object.keys(idx.links);
  const sampleKeys = pickSpread(allKeys, 3);
  console.log(`\n[cross-link] sample relateds (top-${args.topK}):`);
  for (const k of sampleKeys) {
    console.log(`\n  ${k}`);
    const rel = idx.links[k] ?? [];
    if (rel.length === 0) console.log("    (no above-threshold matches)");
    for (const r of rel) {
      console.log(`    → ${r.work_slug}/${r.chapter_slug}  score=${r.score.toFixed(4)}`);
    }
  }

  if (args.dryRun) {
    console.log(`\n[cross-link] DRY-RUN — not writing ${OUTPUT_PATH}`);
    return;
  }

  const json = serializeIndex(idx);
  writeFileSync(OUTPUT_PATH, json, "utf-8");
  const sizeKb = (Buffer.byteLength(json, "utf-8") / 1024).toFixed(1);
  console.log(`\n[cross-link] wrote ${OUTPUT_PATH} (${sizeKb} KB)`);
}

/**
 * Pick `n` evenly-spread items from a sorted list — gives a sample that spans
 * the corpus instead of clustering on the first author alphabetically.
 */
function pickSpread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items.slice();
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(i * step);
    out.push(items[idx]!);
  }
  return out;
}

// Entrypoint — only run when executed directly, not when imported by tests.
if (import.meta.main) {
  main();
}
