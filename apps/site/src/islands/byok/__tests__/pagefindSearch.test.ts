/**
 * Pagefind passage-search tests.
 *
 * The behaviour worth pinning down is the anchor→paragraph mapping: Pagefind
 * gives word locations for matches and word locations for `p-` anchors, and a
 * search hit is only citable if we pick the paragraph that actually contains
 * the match. Fixtures below mirror the real fragment shape (verified against
 * the live index: /pagefind/ on falsafa.ai).
 */

import { describe, test, expect } from "bun:test";
import { searchPassages, type PagefindApi } from "../pagefindSearch";

function fragment(over: Partial<Record<string, unknown>> = {}) {
  return {
    url: "/works/callimachus-hymn-to-zeus-5e3bd2/01-hymn-to-zeus/translation/",
    excerpt: "his birth is disputed. <mark>Zeus,</mark> some say you were born",
    plain_excerpt: "his birth is disputed. Zeus, some say you were born",
    meta: { title: "Hymn to Zeus", work: "Hymn to Zeus" },
    filters: { language: ["Greek"], author: ["Callimachus"], era: ["Hellenistic"] },
    word_count: 1001,
    locations: [410],
    weighted_locations: [{ weight: 1, balanced_score: 1, location: 410 }],
    anchors: [
      { element: "p", id: "p-first", location: 0 },
      { element: "p", id: "p-second", location: 404 },
      { element: "p", id: "p-third", location: 937 },
    ],
    ...over,
  };
}

function apiWith(fragments: unknown[], onQuery?: (q: string) => void): PagefindApi {
  return {
    options: async () => {},
    search: async (q: string) => {
      onQuery?.(q);
      return {
        results: fragments.map((f, i) => ({ id: String(i), data: async () => f as never })),
      };
    },
  } as PagefindApi;
}

const loaderFor = (api: PagefindApi | null) => async () => api;

describe("searchPassages", () => {
  test("maps a match to the paragraph that contains it", async () => {
    const result = await searchPassages("Zeus", { loader: loaderFor(apiWith([fragment()])) });

    expect(result).not.toBeNull();
    const hit = result!.hits[0]!;
    // Match at word 410 sits inside the paragraph anchored at 404, not the
    // one at 0 and not the one at 937.
    expect(hit.paragraph_id).toBe("p-second");
    expect(hit.work_slug).toBe("callimachus-hymn-to-zeus-5e3bd2");
    expect(hit.chapter_slug).toBe("01-hymn-to-zeus");
    expect(hit.variant).toBe("translation");
    expect(hit.citation_url).toBe(
      "/works/callimachus-hymn-to-zeus-5e3bd2/01-hymn-to-zeus/translation/#p-second",
    );
  });

  test("a match before the first anchor belongs to the first paragraph", async () => {
    const result = await searchPassages("Zeus", {
      loader: loaderFor(apiWith([fragment({ locations: [0], weighted_locations: undefined })])),
    });
    expect(result!.hits[0]!.paragraph_id).toBe("p-first");
  });

  test("strips markup from the snippet", async () => {
    const result = await searchPassages("Zeus", {
      loader: loaderFor(apiWith([fragment({ plain_excerpt: undefined })])),
    });
    expect(result!.hits[0]!.snippet).not.toContain("<mark>");
    expect(result!.hits[0]!.snippet).toContain("Zeus,");
  });

  test("english scope drops source-language variants but keeps English works", async () => {
    const greekOriginal = fragment({
      url: "/works/callimachus-hymn-to-zeus-5e3bd2/01-hymn-to-zeus/original/",
    });
    const englishNative = fragment({
      url: "/works/a-v-dicey-lectures-340c4e/01-preface/original/",
      filters: { language: ["English"] },
    });
    const result = await searchPassages("Zeus", {
      loader: loaderFor(apiWith([greekOriginal, englishNative])),
    });

    expect(result!.hits).toHaveLength(1);
    expect(result!.hits[0]!.work_slug).toBe("a-v-dicey-lectures-340c4e");
  });

  test("scope=all keeps source-language variants", async () => {
    const greekOriginal = fragment({
      url: "/works/callimachus-hymn-to-zeus-5e3bd2/01-hymn-to-zeus/original/",
    });
    const result = await searchPassages("Zeus", {
      scope: "all",
      loader: loaderFor(apiWith([greekOriginal])),
    });
    expect(result!.hits).toHaveLength(1);
    expect(result!.hits[0]!.variant).toBe("original");
  });

  test("work_slug restricts results to one work", async () => {
    const other = fragment({ url: "/works/homer-iliad-056ee9/01/translation/" });
    const result = await searchPassages("Zeus", {
      work_slug: "homer-iliad-056ee9",
      loader: loaderFor(apiWith([fragment(), other])),
    });
    expect(result!.hits).toHaveLength(1);
    expect(result!.hits[0]!.work_slug).toBe("homer-iliad-056ee9");
  });

  test("non-chapter pages are ignored", async () => {
    const atlasPage = fragment({ url: "/atlas/figures/zeus/" });
    const result = await searchPassages("Zeus", { loader: loaderFor(apiWith([atlasPage])) });
    expect(result!.hits).toHaveLength(0);
  });

  test("resolves chapter_number through the supplied resolver", async () => {
    const result = await searchPassages("Zeus", {
      loader: loaderFor(apiWith([fragment()])),
      resolveChapterNumber: async (work, chapter) =>
        work === "callimachus-hymn-to-zeus-5e3bd2" && chapter === "01-hymn-to-zeus" ? 1 : null,
    });
    expect(result!.hits[0]!.chapter_number).toBe(1);
  });

  test("a long query that misses is retried with its rarest tokens", async () => {
    const asked: string[] = [];
    const api: PagefindApi = {
      options: async () => {},
      search: async (q: string) => {
        asked.push(q);
        // Only the short retry finds anything.
        const hits = q.split(/\s+/).length <= 3 ? [fragment()] : [];
        return { results: hits.map((f, i) => ({ id: String(i), data: async () => f as never })) };
      },
    } as PagefindApi;

    const result = await searchPassages(
      "we have heard of heroes in ages past of twelve true thanes",
      { loader: loaderFor(api) },
    );

    expect(asked).toHaveLength(2);
    expect(result!.auto_fallback).toBeDefined();
    expect(result!.auto_fallback!.retried_with.split(/\s+/)).toHaveLength(3);
    expect(result!.hits).toHaveLength(1);
  });

  test("returns null when the index cannot be loaded", async () => {
    expect(await searchPassages("Zeus", { loader: loaderFor(null) })).toBeNull();
  });

  test("one unreadable fragment does not sink the query", async () => {
    const api: PagefindApi = {
      options: async () => {},
      search: async () => ({
        results: [
          {
            id: "0",
            data: async () => {
              throw new Error("chunk 404");
            },
          },
          { id: "1", data: async () => fragment() as never },
        ],
      }),
    } as PagefindApi;

    const result = await searchPassages("Zeus", { loader: loaderFor(api) });
    expect(result!.hits).toHaveLength(1);
  });
});
