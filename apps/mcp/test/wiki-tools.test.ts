import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Corpus, MCPError } from "../src/corpus";
import { read_wiki, read_wiki_full } from "../src/tools";

/**
 * Build a tiny fixture corpus on a tmp dir so the wiki tools can be exercised.
 *
 * read_wiki / read_wiki_full now COMPUTE the card/full sheet on demand from the
 * chapter content (no pre-built wiki/*.md files are read), so these tests
 * assert against the shape the real renderers produce rather than hand-written
 * fixture files.
 *
 * Layout:
 *   <tmp>/
 *     manifest.json
 *     works/<slug>/
 *       chapters/01-intro/
 *         meta.json
 *         translation.md
 *         translation.paragraphs.json
 */

let fixtureRoot: string;
const SLUG = "fixture-work-aaa111";
const CHAPTER_SLUG = "01-intro";

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "falsafa-wiki-tools-"));

  // manifest.json
  const manifest = {
    works: [
      {
        slug: SLUG,
        title: "Fixture Work",
        author: "Test Author",
        author_slug: "test-author",
        era: "Modern",
        era_slug: "modern",
        genre: "Test",
        genre_slug: "test",
        language: "english",
        language_slug: "english",
        language_direction: "ltr",
        total_logical_chapters: 1,
        total_variant_entries: 1,
        published_year: 2026,
        difficulty: "Beginner",
        description: "Test fixture",
        thothica_role: "test",
      },
    ],
    counts: { works: 1, authors: 1, eras: 1, genres: 1, languages: 1 },
    authors: { "test-author": { name: "Test Author", works: [SLUG] } },
    eras: { modern: { name: "Modern", works: [SLUG] } },
    genres: { test: { name: "Test", works: [SLUG] } },
    languages: { english: { name: "English", works: [SLUG] } },
  };
  writeFileSync(join(fixtureRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  // chapter dir
  const chDir = join(fixtureRoot, "works", SLUG, "chapters", CHAPTER_SLUG);
  mkdirSync(chDir, { recursive: true });
  writeFileSync(
    join(chDir, "meta.json"),
    JSON.stringify({
      work_slug: SLUG,
      work_title: "Fixture Work",
      chapter_number: 1,
      chapter_title: "Intro",
      chapter_slug: CHAPTER_SLUG,
      layout: "prose",
      layouts_in_variants: ["prose"],
      default_variant: "translation.md",
      variants: [
        {
          file: "translation.md",
          content_type: "translation",
          variant_id: "v1",
          language: "english",
          source_language: "English",
          script: "latin",
          word_count: 10,
          paragraph_count: 1,
          has_image: false,
          source_url: null,
        },
      ],
    }, null, 2),
  );
  writeFileSync(join(chDir, "translation.md"), "# Intro\n\nFixture body.\n");
  writeFileSync(
    join(chDir, "translation.paragraphs.json"),
    JSON.stringify([{ id: "p-aaaaaa", text: "Fixture body.", offset: 0 }]),
  );
});

afterAll(() => {
  if (fixtureRoot && existsSync(fixtureRoot)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("read_wiki", () => {
  test("returns work card markdown when chapter_number is omitted", () => {
    const corpus = new Corpus(fixtureRoot);
    const out = read_wiki(corpus, SLUG);
    expect(out.markdown).toContain("# Fixture Work");
    expect(out.markdown).toContain("## Chapter map");
    expect(out.path).toBe("works/fixture-work-aaa111/wiki/_work.card.md");
  });

  test("returns chapter card markdown when chapter_number is given", () => {
    const corpus = new Corpus(fixtureRoot);
    const out = read_wiki(corpus, SLUG, 1);
    expect(out.markdown).toMatch(/^---\ntextrank_confidence: (low|medium|high)\n---/);
    expect(out.markdown).toContain("# Fixture Work · ch.1");
    expect(out.markdown).toContain("[p-aaaaaa]");
    expect(out.path).toBe(`works/${SLUG}/wiki/${CHAPTER_SLUG}.card.md`);
  });

  test("throws MCPError WORK_NOT_FOUND for unknown slug", () => {
    const corpus = new Corpus(fixtureRoot);
    expect(() => read_wiki(corpus, "no-such-slug")).toThrow(MCPError);
  });

  test("throws when the work has no English chapters to summarize", () => {
    // A work whose chapters dir is empty has no English body to compute from.
    const noWiki = mkdtempSync(join(tmpdir(), "falsafa-no-wiki-"));
    try {
      const m = {
        works: [
          {
            slug: "no-wiki-work-bbb222",
            title: "No Wiki Work",
            author: "X",
            author_slug: "x",
            era: "Modern",
            era_slug: "modern",
            genre: "Test",
            genre_slug: "test",
            language: "english",
            language_slug: "english",
            language_direction: "ltr",
            total_logical_chapters: 0,
            total_variant_entries: 0,
            published_year: null,
            difficulty: null,
            description: "",
            thothica_role: "test",
          },
        ],
        counts: { works: 1, authors: 1, eras: 1, genres: 1, languages: 1 },
        authors: {},
        eras: {},
        genres: {},
        languages: {},
      };
      writeFileSync(join(noWiki, "manifest.json"), JSON.stringify(m));
      mkdirSync(join(noWiki, "works", "no-wiki-work-bbb222", "chapters"), {
        recursive: true,
      });
      const corpus = new Corpus(noWiki);
      expect(() => read_wiki(corpus, "no-wiki-work-bbb222")).toThrow(/no english wiki available/i);
    } finally {
      rmSync(noWiki, { recursive: true, force: true });
    }
  });

  test("throws CHAPTER_OUT_OF_RANGE for unknown chapter number", () => {
    const corpus = new Corpus(fixtureRoot);
    expect(() => read_wiki(corpus, SLUG, 99)).toThrow(MCPError);
  });
});

describe("read_wiki_full", () => {
  test("returns work full sheet when chapter_number omitted", () => {
    const corpus = new Corpus(fixtureRoot);
    const out = read_wiki_full(corpus, SLUG);
    expect(out.markdown).toContain("# Fixture Work");
    expect(out.markdown).toContain("## Work-level top-50 unigrams");
  });

  test("returns chapter full sheet when chapter_number given", () => {
    const corpus = new Corpus(fixtureRoot);
    const out = read_wiki_full(corpus, SLUG, 1);
    expect(out.markdown).toContain("# Fixture Work · ch.1");
    expect(out.markdown).toContain("## Top-20 unigrams");
  });

  test("returns longer content than the card (full sheet > card)", () => {
    const corpus = new Corpus(fixtureRoot);
    const card = read_wiki(corpus, SLUG, 1);
    const full = read_wiki_full(corpus, SLUG, 1);
    expect(full.markdown.length).toBeGreaterThan(card.markdown.length);
  });

  test("throws WORK_NOT_FOUND on unknown slug", () => {
    const corpus = new Corpus(fixtureRoot);
    expect(() => read_wiki_full(corpus, "no-such-slug")).toThrow(MCPError);
  });
});
