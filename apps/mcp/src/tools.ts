/**
 * The 8 librarian tools the Falsafa MCP exposes.
 *
 * P2 invariant: tools return text + structure, never LLM-generated synthesis.
 * The host LLM does the reasoning.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Corpus, MCPError, type ChapterMeta, type ChapterVariant, type ManifestWork } from "./corpus.ts";

// ─────────────────────────────────────────────────────────────────────────
// Tool 1: list_works
// ─────────────────────────────────────────────────────────────────────────

export interface ListWorksFilter {
  era?: string;
  author?: string;
  language?: string;
  genre?: string;
  difficulty?: string;
  /** Filter to only works that have a translation variant (default: true). */
  has_translation?: boolean;
  /** Filter to only works that have an original-language variant. */
  has_original?: boolean;
}

export function list_works(corpus: Corpus, filter: ListWorksFilter = {}) {
  let works = corpus.works();
  if (filter.era) {
    const e = filter.era.toLowerCase();
    works = works.filter((w) => w.era.toLowerCase() === e || w.era_slug === e);
  }
  if (filter.author) {
    const a = filter.author.toLowerCase();
    works = works.filter((w) => w.author.toLowerCase().includes(a) || w.author_slug.includes(a));
  }
  if (filter.language) {
    const l = filter.language.toLowerCase();
    works = works.filter((w) => w.language.toLowerCase() === l || w.language_slug === l);
  }
  if (filter.genre) {
    const g = filter.genre.toLowerCase();
    works = works.filter((w) => w.genre.toLowerCase() === g || w.genre_slug === g);
  }
  if (filter.difficulty) {
    const d = filter.difficulty.toLowerCase();
    works = works.filter((w) => (w.difficulty ?? "").toLowerCase() === d);
  }
  return {
    count: works.length,
    works: works.map((w) => ({
      slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      genre: w.genre,
      language: w.language,
      difficulty: w.difficulty,
      total_logical_chapters: w.total_logical_chapters,
      total_variant_entries: w.total_variant_entries,
      published_year: w.published_year,
      description: w.description,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 2: list_chapters
// ─────────────────────────────────────────────────────────────────────────

export function list_chapters(corpus: Corpus, work_slug: string) {
  const work = corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);
  const chapters = corpus.listChapters(work_slug);
  return {
    work_slug,
    work_title: work.title,
    author: work.author,
    chapter_count: chapters.length,
    chapters: chapters.map((c) => ({
      chapter_number: c.chapter_number,
      chapter_slug: c.chapter_slug,
      chapter_title: c.chapter_title,
      layout: c.layout,
      default_variant: c.default_variant,
      available_variants: c.variants.map((v) => v.content_type),
      variant_count: c.variants.length,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 3: get_metadata
// ─────────────────────────────────────────────────────────────────────────

export function get_metadata(corpus: Corpus, work_slug: string) {
  const work = corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);
  const chapters = corpus.listChapters(work_slug);
  const layoutCounts = chapters.reduce(
    (acc, c) => {
      acc[c.layout] = (acc[c.layout] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const variantTypeCounts = chapters
    .flatMap((c) => c.variants.map((v) => v.content_type))
    .reduce(
      (acc, t) => {
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  return {
    ...work,
    layouts: layoutCounts,
    variant_types: variantTypeCounts,
    chapters_overview: chapters.slice(0, 8).map((c) => ({
      chapter_number: c.chapter_number,
      chapter_title: c.chapter_title,
      layout: c.layout,
    })),
    chapter_count: chapters.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 4: read_chapter
// ─────────────────────────────────────────────────────────────────────────

export function read_chapter(
  corpus: Corpus,
  work_slug: string,
  chapter_number: number,
  variant?: "original" | "transliteration" | "translation",
) {
  const { meta, variant: v, body, frontmatter } = corpus.readChapter(work_slug, chapter_number, variant);
  return {
    work_slug,
    work_title: meta.work_title,
    chapter_number,
    chapter_title: meta.chapter_title,
    chapter_slug: meta.chapter_slug,
    variant: v.content_type,
    variant_file: v.file,
    language: v.language,
    source_language: v.source_language,
    script: v.script,
    layout: meta.layout,
    word_count: v.word_count,
    paragraph_count: v.paragraph_count,
    source_url: v.source_url,
    available_variants: meta.variants.map((vv) => vv.content_type),
    frontmatter,
    body,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 5: get_passage
// ─────────────────────────────────────────────────────────────────────────

export function get_passage(
  corpus: Corpus,
  work_slug: string,
  chapter_number: number,
  paragraph_ids?: string[],
  paragraph_range?: { start: number; end: number },
  variant?: "original" | "transliteration" | "translation",
) {
  const { meta, variant: v } = corpus.readChapter(work_slug, chapter_number, variant);
  const paragraphs = corpus.readParagraphs(work_slug, chapter_number, v.file);
  let selected: typeof paragraphs;
  if (paragraph_ids?.length) {
    const set = new Set(paragraph_ids);
    selected = paragraphs.filter((p) => set.has(p.id));
  } else if (paragraph_range) {
    if (
      paragraph_range.start < 0 ||
      paragraph_range.end >= paragraphs.length ||
      paragraph_range.start > paragraph_range.end
    ) {
      throw new MCPError(
        "PASSAGE_OUT_OF_RANGE",
        `Paragraph range [${paragraph_range.start}, ${paragraph_range.end}] is invalid`,
        `Valid range for this variant: 0 to ${paragraphs.length - 1}`,
      );
    }
    selected = paragraphs.slice(paragraph_range.start, paragraph_range.end + 1);
  } else {
    throw new MCPError(
      "BAD_QUERY",
      "get_passage requires either paragraph_ids or paragraph_range",
    );
  }
  return {
    work_slug,
    chapter_number,
    chapter_title: meta.chapter_title,
    variant: v.content_type,
    language: v.language,
    paragraph_count_total: paragraphs.length,
    passages: selected,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 6: search_corpus
// ─────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** "english" (default) limits to translation+native-English variants. "all" includes all variants. */
  scope?: "english" | "all";
  /** Case sensitivity (default: false). */
  case_sensitive?: boolean;
  /** Maximum results (default: 30). */
  limit?: number;
  /** Filter to a specific work_slug. */
  work_slug?: string;
}

interface SearchHit {
  work_slug: string;
  work_title: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  variant: string;
  language: string;
  snippet: string;
  paragraph_id: string | null;
  /** When auto-fallback is used, which of the fallback tokens matched in this hit. */
  matched_tokens?: string[];
}

/**
 * High-frequency English stopwords + filler that should never be the
 * "distinctive" token of a query when we auto-fallback to per-token
 * scanning. Kept small on purpose — overly aggressive stopword removal
 * loses too much.
 */
const QUERY_STOPWORDS = new Set([
  "the","and","of","to","a","in","that","is","was","for","it","with","as",
  "his","her","be","by","on","not","this","but","are","from","or","have",
  "an","they","which","one","you","were","all","she","there","would",
  "their","we","him","been","has","when","who","will","more","no","if",
  "out","do","what","so","up","into","your","about","just","should",
  "could","may","might","shall","must","said","says","say","i","me","my",
  "yes","also","very","like","such","than","then","now","then",
]);

/** Document-frequency index: lowercase token → number of distinct
 *  English chapters that contain it. Built lazily on first query.
 *  Used by distinctiveTokens to rank candidates by true rarity, not
 *  just length. The corpus is small (~750 English chapters), so the
 *  index fits in memory and builds in <500ms. */
let _dfIndex: Map<string, number> | null = null;
let _dfTotalChapters = 0;

function buildDfIndex(corpus: Corpus): Map<string, number> {
  const root = corpus.rootPath;
  const df = new Map<string, number>();
  let chapters = 0;
  for (const work of corpus.works()) {
    for (const meta of corpus.listChapters(work.slug)) {
      for (const v of meta.variants) {
        if (v.content_type !== "translation" && v.language !== "english") continue;
        const filePath = join(root, "works", work.slug, "chapters", meta.chapter_slug, v.file);
        const raw = readFileSync(filePath, "utf-8");
        const bodyStart = raw.indexOf("\n---") + 4;
        const body = raw.slice(bodyStart).toLowerCase();
        const tokensInChapter = new Set<string>();
        for (const m of body.matchAll(/[a-z'][a-z']+/g)) {
          const t = m[0]!;
          if (t.length >= 3) tokensInChapter.add(t);
        }
        for (const t of tokensInChapter) {
          df.set(t, (df.get(t) ?? 0) + 1);
        }
        chapters++;
      }
    }
  }
  _dfTotalChapters = chapters;
  return df;
}

function getDfIndex(corpus: Corpus): Map<string, number> {
  if (!_dfIndex) _dfIndex = buildDfIndex(corpus);
  return _dfIndex;
}

/** Tokenize a query into "distinctive" tokens, ranked by inverse-document-
 *  frequency over the corpus. Mid-sentence capitalization (proper-noun
 *  signal — "Boar", "Earth") gets a small bonus. Stopwords stripped. */
function distinctiveTokens(query: string, corpus: Corpus): string[] {
  const df = getDfIndex(corpus);
  const N = Math.max(1, _dfTotalChapters);
  const rx = /[A-Za-z][A-Za-z']+/g;
  const seen = new Set<string>();
  const candidates: Array<{ token: string; idf: number; capitalized: boolean }> = [];
  let firstWord = true;
  for (const m of query.matchAll(rx)) {
    const raw = m[0]!;
    const lower = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (lower.length < 3 || QUERY_STOPWORDS.has(lower) || seen.has(lower)) {
      firstWord = false;
      continue;
    }
    seen.add(lower);
    // Tokens not in the index are MAXIMALLY rare — give them a high IDF.
    const docFreq = df.get(lower) ?? 0.5;
    const idf = Math.log((N + 1) / (docFreq + 0.5));
    const capitalized = /^[A-Z]/.test(raw) && !firstWord;
    candidates.push({ token: lower, idf, capitalized });
    firstWord = false;
  }
  // Rank: capitalized proper nouns first (small bonus), then by IDF desc.
  candidates.sort((a, b) => {
    if (a.capitalized !== b.capitalized) return a.capitalized ? -1 : 1;
    return b.idf - a.idf;
  });
  return candidates.map((c) => c.token);
}

/** Internal: scan the corpus for a regex pattern, collect hits. */
function scanCorpus(
  corpus: Corpus,
  re: RegExp,
  scope: "english" | "all",
  limit: number,
  workSlugFilter?: string,
): SearchHit[] {
  const root = corpus.rootPath;
  const results: SearchHit[] = [];
  const works = workSlugFilter
    ? corpus.works().filter((w) => w.slug === workSlugFilter)
    : corpus.works();

  outer: for (const work of works) {
    for (const meta of corpus.listChapters(work.slug)) {
      for (const v of meta.variants) {
        if (scope === "english" && v.content_type !== "translation" && v.language !== "english") continue;
        const filePath = join(
          root,
          "works",
          work.slug,
          "chapters",
          meta.chapter_slug,
          v.file,
        );
        const raw = readFileSync(filePath, "utf-8");
        const bodyStart = raw.indexOf("\n---") + 4;
        const body = raw.slice(bodyStart);
        const matches = [...body.matchAll(re)];
        if (matches.length === 0) continue;
        const paragraphs = corpus.readParagraphs(work.slug, meta.chapter_number, v.file);
        for (const m of matches) {
          if (results.length >= limit) break outer;
          const matchOffset = m.index ?? 0;
          const start = Math.max(0, matchOffset - 80);
          const end = Math.min(body.length, matchOffset + (m[0]?.length ?? 0) + 80);
          let snippet = body.slice(start, end).trim().replace(/\s+/g, " ");
          if (start > 0) snippet = "..." + snippet;
          if (end < body.length) snippet = snippet + "...";
          const para = paragraphs.find(
            (p) => p.offset <= matchOffset && matchOffset < p.offset + p.text.length + 2,
          );
          results.push({
            work_slug: work.slug,
            work_title: work.title,
            chapter_number: meta.chapter_number,
            chapter_title: meta.chapter_title,
            chapter_slug: meta.chapter_slug,
            variant: v.content_type,
            language: v.language,
            snippet,
            paragraph_id: para?.id ?? null,
          });
        }
      }
    }
  }
  return results;
}

export function search_corpus(corpus: Corpus, query: string, options: SearchOptions = {}) {
  if (!query || !query.trim()) {
    return { query, scope: options.scope ?? "english", count: 0, results: [] };
  }
  const scope = options.scope ?? "english";
  const limit = options.limit ?? 30;
  const re = new RegExp(escapeRegex(query), options.case_sensitive ? "g" : "gi");
  const results = scanCorpus(corpus, re, scope, limit, options.work_slug);

  // Auto-fallback: when the literal-substring query returned 0 hits and
  // the query is >5 words long, retry with the 3 most-distinctive tokens
  // scanned per-chapter, ranked by how many tokens hit. This catches the
  // "LLM searched the entire long quote and one comma off" failure mode
  // without requiring the LLM to know better.
  const wordCount = query.trim().split(/\s+/).length;
  if (results.length === 0 && wordCount > 5) {
    const tokens = distinctiveTokens(query, corpus).slice(0, 3);
    if (tokens.length > 0) {
      // Per-token scan. Aggregate by (work_slug, chapter_slug, variant)
      // and rank chapters by how many tokens matched, then by total hits.
      const perTokenHits = new Map<string, { hit: SearchHit; tokens: Set<string>; total: number }>();
      for (const tok of tokens) {
        const tokRe = new RegExp("\\b" + escapeRegex(tok), "gi");
        const tokResults = scanCorpus(corpus, tokRe, scope, limit * 3, options.work_slug);
        for (const h of tokResults) {
          const key = `${h.work_slug}|${h.chapter_slug}|${h.variant}`;
          const existing = perTokenHits.get(key);
          if (existing) {
            existing.tokens.add(tok);
            existing.total += 1;
          } else {
            perTokenHits.set(key, { hit: h, tokens: new Set([tok]), total: 1 });
          }
        }
      }
      const ranked = [...perTokenHits.values()]
        .sort((a, b) => b.tokens.size - a.tokens.size || b.total - a.total)
        .slice(0, limit);
      const fallbackResults = ranked.map((r) => ({
        ...r.hit,
        matched_tokens: [...r.tokens],
      }));
      return {
        query,
        scope,
        count: fallbackResults.length,
        results: fallbackResults,
        auto_fallback: {
          reason: "literal substring of long query yielded 0 hits; retried with distinctive tokens",
          tokens_used: tokens,
          original_word_count: wordCount,
        },
      };
    }
  }

  return {
    query,
    scope,
    count: results.length,
    results,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 7: find_related
// ─────────────────────────────────────────────────────────────────────────

interface CrossLinkEntry {
  work_slug: string;
  chapter_slug: string;
  chapter_number: number;
  score: number;
}

interface CrossLinkIndexFile {
  generated_at: string;
  method: string;
  corpus_chapter_count: number;
  skipped_short_chapters: string[];
  links: Record<string, CrossLinkEntry[]>;
}

/**
 * Lazy, memoized loader for `corpus/cross-links.json`. Returns null when the
 * file is missing (pre-build, or if the user hasn't run `bun run cross-link`
 * yet) — `find_related` then falls back to the structural ranking.
 *
 * We cache against the corpus root path (a process-stable string) so test
 * suites that instantiate multiple Corpus objects don't fight each other.
 */
const crossLinkCache = new Map<string, CrossLinkIndexFile | null>();

function loadCrossLinks(corpusRoot: string): CrossLinkIndexFile | null {
  if (crossLinkCache.has(corpusRoot)) return crossLinkCache.get(corpusRoot)!;
  const path = join(corpusRoot, "cross-links.json");
  if (!existsSync(path)) {
    crossLinkCache.set(corpusRoot, null);
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as CrossLinkIndexFile;
    crossLinkCache.set(corpusRoot, parsed);
    return parsed;
  } catch {
    // Malformed file → fall back as if it weren't there. Don't crash the MCP.
    crossLinkCache.set(corpusRoot, null);
    return null;
  }
}

/** Test-only: clear the cross-link cache so a test can swap in a fresh fixture. */
export function _resetCrossLinkCache(): void {
  crossLinkCache.clear();
}

export function find_related(corpus: Corpus, work_slug: string, chapter_number?: number, limit = 5) {
  const work = corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);

  // Content-similar matches from the build-time TF-IDF index, when:
  //   - cross-links.json exists,
  //   - chapter_number is provided (otherwise we have no chapter to key on),
  //   - the index has an entry for this chapter (skipped if body was too short).
  // Each TF-IDF hit becomes a `content_similar` related entry. We dedupe on
  // work_slug — if the index returns 3 chapters from the same other work,
  // we surface that work once with its best-scoring chapter pointer.
  const contentRelated: Array<{
    work_slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    relation: "content_similar";
    chapter_number: number;
    chapter_slug: string;
    score: number;
  }> = [];
  const contentWorkSlugs = new Set<string>();

  const xlinks = loadCrossLinks(corpus.rootPath);
  if (xlinks && chapter_number !== undefined) {
    // Resolve chapter_slug from chapter_number.
    const chapters = corpus.listChapters(work_slug);
    const meta = chapters.find((c) => c.chapter_number === chapter_number);
    if (meta) {
      const key = `${work_slug}/${meta.chapter_slug}`;
      const links = xlinks.links[key] ?? [];
      for (const l of links) {
        if (contentWorkSlugs.has(l.work_slug)) continue; // dedupe by work
        const otherWork = corpus.findWork(l.work_slug);
        if (!otherWork) continue;
        contentWorkSlugs.add(l.work_slug);
        contentRelated.push({
          work_slug: otherWork.slug,
          title: otherWork.title,
          author: otherWork.author,
          era: otherWork.era,
          genre: otherWork.genre,
          relation: "content_similar",
          chapter_number: l.chapter_number,
          chapter_slug: l.chapter_slug,
          score: l.score,
        });
      }
    }
  }

  // Structural relatedness: same author > same era > same genre. Used to fill
  // out the response up to `limit` when content matches don't fully cover, and
  // as the sole signal when chapter_number is missing or the chapter wasn't
  // indexed (empty body, or pre-cross-link build).
  const all = corpus.works().filter((w) => w.slug !== work_slug);
  const sameAuthor = all.filter((w) => w.author === work.author);
  const sameEra = all.filter((w) => w.era === work.era && w.author !== work.author);
  const sameGenre = all.filter(
    (w) => w.genre === work.genre && w.author !== work.author && w.era !== work.era,
  );
  const structuralRanked = [...sameAuthor, ...sameEra, ...sameGenre];

  // Merge: content-similar first (highest signal — actual word overlap), then
  // structural fillers, skipping any work already represented in content_related.
  const merged: Array<{
    work_slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    relation: "content_similar" | "same_author" | "same_era" | "same_genre";
    chapter_number?: number;
    chapter_slug?: string;
    score?: number;
  }> = [...contentRelated];
  for (const w of structuralRanked) {
    if (merged.length >= limit) break;
    if (contentWorkSlugs.has(w.slug)) continue;
    merged.push({
      work_slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      genre: w.genre,
      relation:
        w.author === work.author ? "same_author" : w.era === work.era ? "same_era" : "same_genre",
    });
  }

  const final = merged.slice(0, limit);
  const usedContent = contentRelated.length > 0;

  return {
    work_slug,
    chapter_number: chapter_number ?? null,
    method: usedContent ? "tfidf_v1+structural" : "structural_v0",
    note: usedContent
      ? "Mix of content-based (TF-IDF cosine over English chapter bodies) and structural fallback."
      : xlinks
        ? "Structural fallback (chapter not indexed or chapter_number missing)."
        : "Structural fallback (cross-links index not built — run `bun run cross-link`).",
    related: final,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool 8: compare_works
// ─────────────────────────────────────────────────────────────────────────

export function compare_works(corpus: Corpus, work_slug_a: string, work_slug_b: string, topic?: string) {
  const a = corpus.findWork(work_slug_a);
  const b = corpus.findWork(work_slug_b);
  if (!a) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug_a}`);
  if (!b) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug_b}`);

  const aChapters = corpus.listChapters(work_slug_a);
  const bChapters = corpus.listChapters(work_slug_b);

  // If a topic is provided, run search within each work and return matching chapters
  let matchingA: typeof aChapters = aChapters.slice(0, 5);
  let matchingB: typeof bChapters = bChapters.slice(0, 5);
  if (topic) {
    const aHits = search_corpus(corpus, topic, { scope: "english", limit: 5, work_slug: work_slug_a });
    const bHits = search_corpus(corpus, topic, { scope: "english", limit: 5, work_slug: work_slug_b });
    const aSet = new Set(aHits.results.map((r) => r.chapter_number));
    const bSet = new Set(bHits.results.map((r) => r.chapter_number));
    matchingA = aChapters.filter((c) => aSet.has(c.chapter_number));
    matchingB = bChapters.filter((c) => bSet.has(c.chapter_number));
    if (matchingA.length === 0) matchingA = aChapters.slice(0, 3);
    if (matchingB.length === 0) matchingB = bChapters.slice(0, 3);
  }

  return {
    topic: topic ?? null,
    note: "Returns relevant chapter pointers and metadata for both works. The host LLM does the actual comparison.",
    work_a: {
      slug: a.slug,
      title: a.title,
      author: a.author,
      era: a.era,
      genre: a.genre,
      language: a.language,
      relevant_chapters: matchingA.map((c) => ({
        chapter_number: c.chapter_number,
        chapter_title: c.chapter_title,
        layout: c.layout,
        default_variant: c.default_variant,
      })),
    },
    work_b: {
      slug: b.slug,
      title: b.title,
      author: b.author,
      era: b.era,
      genre: b.genre,
      language: b.language,
      relevant_chapters: matchingB.map((c) => ({
        chapter_number: c.chapter_number,
        chapter_title: c.chapter_title,
        layout: c.layout,
        default_variant: c.default_variant,
      })),
    },
  };
}
