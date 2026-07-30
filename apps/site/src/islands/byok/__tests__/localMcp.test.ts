/**
 * Browser-local MCP client tests.
 *
 * The regression these guard is browser-only and invisible to Node/Bun:
 * Chrome brand-checks `fetch`'s receiver, so invoking a stored reference as
 * `this.fetchImpl(url)` throws "Failed to execute 'fetch' on 'Window':
 * Illegal invocation". BrowserCorpus swallows fetch throws (a 404 and a
 * network failure both mean "no file"), so the whole demo degraded to
 * "manifest.json not found at /corpus/" on every tool call.
 *
 * `brandCheckedFetch` below reproduces that check in Bun: it throws unless it
 * is called with an undefined/global receiver, exactly as the browser does.
 */

import { describe, test, expect } from "bun:test";
import { createLocalMcpClient } from "../localMcp";

const MANIFEST = {
  works: [
    {
      slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
      title: "Diwan-E-Ghalib",
      author: "Mirza Ghalib",
      author_slug: "mirza-ghalib",
      era: "19th Century",
      era_slug: "19th-century",
      genre: "Literature",
      genre_slug: "literature",
      language: "Urdu",
      language_slug: "urdu",
      language_direction: "rtl",
      total_logical_chapters: 1,
      total_variant_entries: 1,
      published_year: 1841,
      difficulty: "Intermediate",
      description: "Ghazals.",
      thothica_role: "primary",
    },
  ],
};

const MCP_INDEX = {
  chapters_by_work: {
    "mirza-ghalib-diwan-e-ghalib-74ed4c": [
      { n: 1, slug: "01-ghazal", def: "translation-1.md", wiki: false, variants: [] },
    ],
  },
};

const CHAPTER_META = {
  work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
  work_title: "Diwan-E-Ghalib",
  chapter_number: 1,
  chapter_title: "Ghazal",
  chapter_slug: "01-ghazal",
  layout: "verse",
  layouts_in_variants: ["verse"],
  default_variant: "translation-1.md",
  variants: [
    {
      file: "translation-1.md",
      content_type: "translation",
      variant_id: "t1",
      language: "eng",
      source_language: "urd",
      script: "Latin",
      word_count: 10,
      paragraph_count: 1,
      has_image: false,
      source_url: null,
    },
  ],
};

const FILES: Record<string, unknown> = {
  "manifest.json": MANIFEST,
  "mcp-index.json": MCP_INDEX,
  "works/mirza-ghalib-diwan-e-ghalib-74ed4c/chapters/01-ghazal/meta.json": CHAPTER_META,
};

/**
 * A fetch double with the browser's receiver brand check. `this` is undefined
 * for a plain call in a strict-mode module and `globalThis` for `window.fetch(…)`;
 * anything else is the illegal-invocation case.
 */
function brandCheckedFetch(this: unknown, input: string | URL | Request): Promise<Response> {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  }
  const url = String(input);
  const relPath = url.replace(/^\/corpus\//, "");
  const body = FILES[relPath];
  if (body === undefined) return Promise.resolve(new Response("not found", { status: 404 }));
  return Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
}

describe("localMcp — fetch receiver", () => {
  test("tools work with a fetch that brand-checks its receiver (the browser case)", async () => {
    const client = createLocalMcpClient("/corpus/", brandCheckedFetch as typeof fetch);

    const result = await client.invoke("list_works", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.output as { count: number }).count).toBe(1);
    }
  });

  test("chapter listing also survives the brand check", async () => {
    const client = createLocalMcpClient("/corpus/", brandCheckedFetch as typeof fetch);

    const result = await client.invoke("list_chapters", {
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.output as { chapter_count: number }).chapter_count).toBe(1);
    }
  });

  test("a fetch that throws names the transport failure in the error", async () => {
    const exploding = (() => {
      throw new TypeError("Load failed");
    }) as unknown as typeof fetch;
    const client = createLocalMcpClient("/corpus/", exploding);

    const result = await client.invoke("list_works", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("manifest.json not found");
      expect(result.error).toContain("Load failed");
    }
  });

  test("a missing manifest (404) still reports plainly", async () => {
    const notFound = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const client = createLocalMcpClient("/corpus/", notFound);

    const result = await client.invoke("list_works", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("manifest.json not found at /corpus/");
    }
  });
});

describe("localMcp — search_corpus", () => {
  const fragment = {
    url: "/works/mirza-ghalib-diwan-e-ghalib-74ed4c/01-ghazal/translation/",
    excerpt: "the <mark>lamp</mark> of the assembly",
    plain_excerpt: "the lamp of the assembly",
    meta: { title: "Ghazal", work: "Diwan-E-Ghalib" },
    filters: { language: ["Urdu"] },
    word_count: 100,
    locations: [10],
    anchors: [{ element: "p", id: "p-8c8b08", location: 0 }],
  };

  test("routes through Pagefind and resolves chapter_number from mcp-index", async () => {
    const loader = async () =>
      ({
        options: async () => {},
        search: async () => ({ results: [{ id: "0", data: async () => fragment }] }),
      }) as never;

    const client = createLocalMcpClient("/corpus/", brandCheckedFetch as typeof fetch, {
      pagefindLoader: loader,
    });
    const result = await client.invoke("search_corpus", { query: "lamp" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.output as {
      engine: string;
      results: { paragraph_id: string; chapter_number: number | null; citation_url: string }[];
    };
    expect(out.engine).toBe("pagefind");
    expect(out.results[0]!.paragraph_id).toBe("p-8c8b08");
    // The slug→number hop is what lets the model follow up with read_chapter.
    expect(out.results[0]!.chapter_number).toBe(1);
    expect(out.results[0]!.citation_url).toContain("#p-8c8b08");
  });

  test("falls back to metadata search and says so when the index is absent", async () => {
    const client = createLocalMcpClient("/corpus/", brandCheckedFetch as typeof fetch, {
      pagefindLoader: async () => null,
    });
    const result = await client.invoke("search_corpus", { query: "Ghalib" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.output as { engine: string; note: string; count: number };
    expect(out.engine).toBe("metadata");
    expect(out.count).toBe(1);
    // The model must know these are catalog matches, not passage text.
    expect(out.note).toContain("METADATA");
    expect(out.note).toContain("NOT passage text");
  });
});
