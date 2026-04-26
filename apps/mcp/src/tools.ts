/**
 * The 8 librarian tools the Falsafa MCP exposes.
 *
 * P2 invariant: tools return text + structure, never LLM-generated synthesis.
 * The host LLM does the reasoning.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
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

export function search_corpus(corpus: Corpus, query: string, options: SearchOptions = {}) {
  if (!query || !query.trim()) {
    return { query, scope: options.scope ?? "english", count: 0, results: [] };
  }
  const scope = options.scope ?? "english";
  const limit = options.limit ?? 30;
  const re = new RegExp(escapeRegex(query), options.case_sensitive ? "g" : "gi");
  const root = corpus.rootPath;
  const results: Array<{
    work_slug: string;
    work_title: string;
    chapter_number: number;
    chapter_title: string;
    chapter_slug: string;
    variant: string;
    language: string;
    snippet: string;
    paragraph_id: string | null;
  }> = [];

  const works = options.work_slug
    ? corpus.works().filter((w) => w.slug === options.work_slug)
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
          // Snippet: ~80 chars around the match
          const start = Math.max(0, matchOffset - 80);
          const end = Math.min(body.length, matchOffset + (m[0]?.length ?? 0) + 80);
          let snippet = body.slice(start, end).trim().replace(/\s+/g, " ");
          if (start > 0) snippet = "..." + snippet;
          if (end < body.length) snippet = snippet + "...";
          // Find paragraph_id by offset
          const para = paragraphs.find((p) => p.offset <= matchOffset && matchOffset < p.offset + p.text.length + 2);
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

export function find_related(corpus: Corpus, work_slug: string, chapter_number?: number, limit = 5) {
  const work = corpus.findWork(work_slug);
  if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${work_slug}`);

  // Structural relatedness: same author > same era > same genre > same language.
  // We don't have build-time TF-IDF cross-links yet (those land in cross-link.ts),
  // so this is the v0 structural fallback. Returns same-author works first,
  // then same-era works.
  const all = corpus.works().filter((w) => w.slug !== work_slug);
  const sameAuthor = all.filter((w) => w.author === work.author);
  const sameEra = all.filter((w) => w.era === work.era && w.author !== work.author);
  const sameGenre = all.filter(
    (w) => w.genre === work.genre && w.author !== work.author && w.era !== work.era,
  );
  const ranked = [...sameAuthor, ...sameEra, ...sameGenre].slice(0, limit);

  return {
    work_slug,
    chapter_number: chapter_number ?? null,
    method: "structural_v0",
    note: "Structural fallback (same-author, same-era, same-genre). Build-time TF-IDF cross-links land in scripts/cross-link.ts.",
    related: ranked.map((w) => ({
      work_slug: w.slug,
      title: w.title,
      author: w.author,
      era: w.era,
      genre: w.genre,
      relation:
        w.author === work.author ? "same_author" : w.era === work.era ? "same_era" : "same_genre",
    })),
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
