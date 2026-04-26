/**
 * MCP smoke test — verifies that all 8 tools execute without errors against
 * the actual corpus. Not a full eval suite (that's the V1 black-box eval),
 * just structural sanity.
 */

import { describe, expect, test } from "bun:test";
import { Corpus } from "../src/corpus.ts";
import {
  list_works,
  list_chapters,
  get_metadata,
  read_chapter,
  get_passage,
  search_corpus,
  find_related,
  compare_works,
} from "../src/tools.ts";

const corpus = new Corpus();

describe("MCP smoke tests", () => {
  test("corpus loads with 38 works", () => {
    const w = corpus.works();
    expect(w.length).toBe(38);
  });

  test("list_works returns all 38 with no filter", () => {
    const r = list_works(corpus);
    expect(r.count).toBe(38);
  });

  test("list_works filters by author", () => {
    const r = list_works(corpus, { author: "cynewulf" });
    expect(r.count).toBe(3);
    expect(r.works.map((w) => w.title).sort()).toEqual(["Andreas", "Elene", "Juliana"]);
  });

  test("list_works filters by language", () => {
    const r = list_works(corpus, { language: "urdu" });
    // Iqbal x3 + Ghalib + Zauq = 5
    expect(r.count).toBe(5);
  });

  test("list_chapters returns chapters for Andreas", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const r = list_chapters(corpus, andreas.slug);
    expect(r.chapter_count).toBeGreaterThan(0);
    expect(r.chapters[0]!.layout).toBe("verse");
  });

  test("list_chapters throws on missing work", () => {
    expect(() => list_chapters(corpus, "no-such-work-xyz")).toThrow();
  });

  test("get_metadata returns author bio", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const m = get_metadata(corpus, andreas.slug);
    expect(m.author).toBe("Cynewulf");
    expect(m.layouts).toBeDefined();
  });

  test("read_chapter returns body with frontmatter", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const r = read_chapter(corpus, andreas.slug, 1);
    expect(r.body.length).toBeGreaterThan(100);
    expect(r.frontmatter["work_title"]).toBe("Andreas");
  });

  test("read_chapter respects variant parameter", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const orig = read_chapter(corpus, andreas.slug, 1, "original");
    const trans = read_chapter(corpus, andreas.slug, 1, "translation");
    expect(orig.variant).toBe("original");
    expect(trans.variant).toBe("translation");
    expect(orig.body).not.toBe(trans.body);
  });

  test("read_chapter throws on out-of-range chapter", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    expect(() => read_chapter(corpus, andreas.slug, 999)).toThrow();
  });

  test("get_passage returns specific paragraphs by range", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const r = get_passage(corpus, andreas.slug, 1, undefined, { start: 0, end: 0 }, "original");
    expect(r.passages.length).toBe(1);
  });

  test("search_corpus finds matches in English variants by default", () => {
    const r = search_corpus(corpus, "philosophy", { limit: 5 });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0]!.variant).toMatch(/translation|original/);
  });

  test("search_corpus returns paragraph_id when matched within a paragraph", () => {
    const r = search_corpus(corpus, "the", { limit: 1 });
    expect(r.results[0]!.paragraph_id).toBeTruthy();
  });

  test("search_corpus empty query returns empty", () => {
    const r = search_corpus(corpus, "");
    expect(r.count).toBe(0);
  });

  test("find_related returns same-author works first", () => {
    const andreas = corpus.works().find((w) => w.title === "Andreas")!;
    const r = find_related(corpus, andreas.slug);
    expect(r.related.length).toBeGreaterThan(0);
    expect(r.related[0]!.relation).toBe("same_author");
  });

  test("compare_works returns relevant chapters for both works", () => {
    const a = corpus.works().find((w) => w.title === "Andreas")!;
    const b = corpus.works().find((w) => w.title === "Bang-E-Dara Part 1")!;
    const r = compare_works(corpus, a.slug, b.slug, "courage");
    expect(r.work_a.relevant_chapters.length).toBeGreaterThan(0);
    expect(r.work_b.relevant_chapters.length).toBeGreaterThan(0);
  });

  test("error format is structured", () => {
    try {
      list_chapters(corpus, "no-such-work");
    } catch (err) {
      expect(err).toMatchObject({ code: "WORK_NOT_FOUND" });
    }
  });
});
