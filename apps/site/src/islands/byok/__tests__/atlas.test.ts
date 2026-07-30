/**
 * Atlas tool tests.
 *
 * Two things matter most here and both are about honesty rather than lookup:
 *   1. Coverage is READ, never remembered — the caveat text and the percentages
 *      must come out of meta.json, so a test that changes meta.json must see
 *      the numbers change.
 *   2. A work the Atlas hasn't processed returns in_atlas=false with an
 *      explanation, not an error and not an empty result that reads as
 *      "this work has no figures in it".
 *
 * Fixtures mirror the real generated files (corpus/graph/atlas/*).
 */

import { describe, test, expect } from "bun:test";
import { createAtlasClient, atlasCoverage } from "../atlas";

const META = {
  generated_at: "2026-07-29T19:08:33.392Z",
  ontology_version: "anchor-range-v1",
  windows_synthesized: 1614,
  windows_total: 12797,
  works_harvested: 357,
  works_total: 2018,
  kinds: { figure: 33080, place: 10365 },
  stances: { authority: 8070, refute: 1151 },
  totals: { entities_merged: 36472 },
  coverage: {
    by_language: {
      Greek: { done: 730, total: 2656 },
      Sanskrit: { done: 245, total: 245 },
      Urdu: { done: 0, total: 12 },
    },
    by_era: { Ancient: { done: 276, total: 276 } },
  },
};

const ENTITIES_INDEX = [
  {
    slug: "zeus",
    kind: "figure",
    figure_kind: "deity",
    name: "Zeus",
    surfaces: ["father Zeus", "son of Kronos"],
    works: 123,
    mentions: 309,
    evidence: 900,
    page: true,
  },
  {
    slug: "indra",
    kind: "figure",
    figure_kind: "deity",
    name: "Indra",
    surfaces: ["Śakra", "Vṛtra-slayer"],
    works: 20,
    mentions: 182,
    evidence: 944,
    page: true,
  },
  {
    slug: "zeuxis",
    kind: "figure",
    name: "Zeuxis",
    surfaces: [],
    works: 1,
    mentions: 2,
    evidence: 3,
    page: false,
  },
  {
    slug: "olympus",
    kind: "place",
    name: "Olympus",
    surfaces: [],
    works: 40,
    mentions: 90,
    evidence: 120,
    page: true,
  },
];

const ZEUS = {
  slug: "zeus",
  kind: "figure",
  figure_kind: "deity",
  name: "Zeus",
  surfaces: ["father Zeus", "son of Kronos"],
  mentions: 309,
  evidence: 900,
  works: [
    {
      work: "homer-iliad-056ee9",
      title: "Iliad",
      author: "homer",
      era: "Classical",
      language: "Greek",
      count: 25,
      description: "King of the gods, persuaded by Thetis to favour the Trojans.",
      quotes: [
        { p: "p-35208b", text: "He will return to Olympus twelve days hence;", chapter: "01", variant: "translation" },
        { p: "p-aaaaaa", text: "second quote", chapter: "02", variant: "translation" },
        { p: "p-bbbbbb", text: "third quote — should be trimmed", chapter: "03", variant: "translation" },
      ],
    },
    {
      work: "callimachus-hymn-to-zeus-5e3bd2",
      title: "Hymn to Zeus",
      count: 12,
      quotes: [],
    },
  ],
};

const CITATIONS = [
  {
    from: "clement-of-alexandria-stromata-694383",
    cited_work: "Psalms",
    cited_author: "David",
    stance: "authority",
    count: 24,
    to_work: "old-testament-psalms-3a8fd1",
    quotes: [
      { p: "p-d81ad5", text: "after the manner of blessed David", chapter: "01-book-1", variant: "translation" },
    ],
  },
  {
    from: "cicero-de-natura-deorum-111111",
    cited_work: "On the Nature of Things",
    cited_author: "Chrysippus",
    stance: "refute",
    count: 3,
    to_work: null,
    quotes: [],
  },
];

const WORKS_ATLAS = [
  {
    work: "homer-iliad-056ee9",
    title: "Iliad",
    author: "homer",
    windows_done: 20,
    windows_total: 24,
    entity_rows: 400,
    kinds: { figure: 300, place: 100 },
    citations_out: 5,
    quote_events: 60,
    themes: 30,
    top_entities: [{ slug: "zeus", kind: "figure", name: "Zeus", count: 25 }],
  },
];

const ILIAD_ONTOLOGY = {
  work: "homer-iliad-056ee9",
  chapters: {
    "01": [
      { slug: "zeus", kind: "figure", name: "Zeus", count: 25, desc: "King of the gods.", p: ["p-35208b"], page: true },
      { slug: "achilles", kind: "figure", name: "Achilles", count: 40, desc: "The hero.", p: ["p-111111"], page: true },
    ],
  },
};

const FILES: Record<string, unknown> = {
  "meta.json": META,
  "entities-index.json": ENTITIES_INDEX,
  "citations.json": CITATIONS,
  "works-atlas.json": WORKS_ATLAS,
  "entities/figure--zeus.json": ZEUS,
  "works/homer-iliad-056ee9.json": ILIAD_ONTOLOGY,
};

let fetchCount = 0;

const fakeFetch = ((input: RequestInfo | URL) => {
  fetchCount++;
  const rel = String(input).replace("/corpus/graph/atlas/", "");
  const body = FILES[rel];
  if (body === undefined) return Promise.resolve(new Response("nope", { status: 404 }));
  return Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
}) as typeof fetch;

const client = () => createAtlasClient("/corpus/graph/atlas/", fakeFetch);

describe("atlas coverage", () => {
  test("percentages and caveat are computed from meta.json", async () => {
    const c = await atlasCoverage("/corpus/graph/atlas/", fakeFetch);
    expect(c.works_in_atlas).toBe(357);
    expect(c.works_in_corpus).toBe(2018);
    expect(c.works_pct).toBe(17.7);
    expect(c.windows_pct).toBe(12.6);
    expect(c.caveat).toContain("357 of 2018 works");
    expect(c.caveat).toContain("17.7%");
    // The guard that keeps a model from inventing absences.
    expect(c.caveat).toContain("NOT missing from the corpus");
    expect(c.caveat).toContain("search_corpus");
  });

  test("atlas_coverage reports per-language and per-era breakdowns", async () => {
    const out = (await client().dispatch("atlas_coverage", {})) as {
      by_language: { language: string; pct: number | null }[];
      by_era: { era: string }[];
      entity_counts_by_kind: Record<string, number>;
    };
    const greek = out.by_language.find((l) => l.language === "Greek")!;
    expect(greek.pct).toBe(27.5);
    const urdu = out.by_language.find((l) => l.language === "Urdu")!;
    expect(urdu.pct).toBe(0);
    expect(out.by_era[0]!.era).toBe("Ancient");
    expect(out.entity_counts_by_kind["figure"]).toBe(33080);
  });

  test("every tool response carries live coverage", async () => {
    const c = client();
    for (const [name, args] of [
      ["atlas_search", { query: "Zeus" }],
      ["atlas_entity", { kind: "figure", slug: "zeus" }],
      ["atlas_work", { work_slug: "homer-iliad-056ee9" }],
      ["atlas_citations", {}],
    ] as const) {
      const out = (await c.dispatch(name, args)) as { atlas_coverage?: { works_pct: number } };
      expect(out.atlas_coverage?.works_pct).toBe(17.7);
    }
  });
});

describe("atlas_search", () => {
  test("finds an entity by name and reports whether a dossier exists", async () => {
    const out = (await client().dispatch("atlas_search", { query: "zeus" })) as {
      results: { slug: string; has_dossier: boolean }[];
    };
    expect(out.results[0]!.slug).toBe("zeus");
    expect(out.results[0]!.has_dossier).toBe(true);
  });

  test("a partial name returns both candidates, exact-and-prominent first", async () => {
    const out = (await client().dispatch("atlas_search", { query: "zeu" })) as {
      results: { slug: string; has_dossier: boolean }[];
    };
    expect(out.results.map((r) => r.slug)).toEqual(["zeus", "zeuxis"]);
    // has_dossier is what tells the model whether atlas_entity will work.
    expect(out.results[1]!.has_dossier).toBe(false);
  });

  test("finds an entity by the alias the texts use", async () => {
    const out = (await client().dispatch("atlas_search", { query: "son of Kronos" })) as {
      results: { slug: string }[];
    };
    expect(out.results[0]!.slug).toBe("zeus");
  });

  test("matches ASCII input against diacritics in the harvest", async () => {
    const out = (await client().dispatch("atlas_search", { query: "sakra" })) as {
      results: { slug: string }[];
    };
    expect(out.results[0]!.slug).toBe("indra");
  });

  test("kind filter narrows the search", async () => {
    const out = (await client().dispatch("atlas_search", {
      query: "olympus",
      kind: "figure",
    })) as { results: unknown[] };
    expect(out.results).toHaveLength(0);
  });
});

describe("atlas_entity", () => {
  test("returns per-work glosses and citable quotes", async () => {
    const out = (await client().dispatch("atlas_entity", { kind: "figure", slug: "zeus" })) as {
      name: string;
      works_total: number;
      works: {
        work_slug: string;
        mentions: number;
        description: string | null;
        quotes: { paragraph_id: string; citation_url: string }[];
      }[];
    };
    expect(out.name).toBe("Zeus");
    expect(out.works_total).toBe(2);
    // Sorted by mention count, so the Iliad leads.
    const iliad = out.works[0]!;
    expect(iliad.work_slug).toBe("homer-iliad-056ee9");
    expect(iliad.description).toContain("King of the gods");
    // Quotes are trimmed to keep the payload sane.
    expect(iliad.quotes).toHaveLength(2);
    expect(iliad.quotes[0]!.citation_url).toBe(
      "/works/homer-iliad-056ee9/01/translation/#p-35208b",
    );
  });

  test("an entity with no dossier explains itself instead of 404-ing blankly", async () => {
    let error = "";
    try {
      await client().dispatch("atlas_entity", { kind: "figure", slug: "zeuxis" });
    } catch (err) {
      error = (err as Error).message;
    }
    expect(error).toContain("No Atlas dossier");
  });
});

describe("atlas_work", () => {
  test("reports per-work completeness alongside the chapter roster", async () => {
    const out = (await client().dispatch("atlas_work", {
      work_slug: "homer-iliad-056ee9",
    })) as {
      in_atlas: boolean;
      work_completeness: { windows_pct: number | null };
      chapters: { chapter_slug: string; entities: { name: string; paragraph_ids: string[] }[] }[];
    };
    expect(out.in_atlas).toBe(true);
    expect(out.work_completeness.windows_pct).toBe(83.3);
    expect(out.chapters[0]!.chapter_slug).toBe("01");
    // Sorted by mentions: Achilles (40) before Zeus (25).
    expect(out.chapters[0]!.entities[0]!.name).toBe("Achilles");
    expect(out.chapters[0]!.entities[1]!.paragraph_ids).toEqual(["p-35208b"]);
  });

  test("an unprocessed work says so without implying the text is missing", async () => {
    const out = (await client().dispatch("atlas_work", {
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
    })) as { in_atlas: boolean; note: string };
    expect(out.in_atlas).toBe(false);
    expect(out.note).toContain("has not been through ontology extraction");
    expect(out.note).toContain("read_chapter");
  });
});

describe("atlas_citations", () => {
  test("filters by citing work and marks whether the cited text is in the corpus", async () => {
    const out = (await client().dispatch("atlas_citations", {
      work_slug: "clement-of-alexandria-stromata-694383",
    })) as {
      count: number;
      edges: {
        stance: string;
        cited_work_in_corpus: boolean;
        quotes: { citation_url: string }[];
      }[];
    };
    expect(out.count).toBe(1);
    expect(out.edges[0]!.stance).toBe("authority");
    expect(out.edges[0]!.cited_work_in_corpus).toBe(true);
    expect(out.edges[0]!.quotes[0]!.citation_url).toBe(
      "/works/clement-of-alexandria-stromata-694383/01-book-1/translation/#p-d81ad5",
    );
  });

  test("flags a cited work that the corpus does not hold", async () => {
    const out = (await client().dispatch("atlas_citations", { stance: "refute" })) as {
      edges: { cited_work_in_corpus: boolean; cited_author: string | null }[];
    };
    expect(out.edges[0]!.cited_work_in_corpus).toBe(false);
    expect(out.edges[0]!.cited_author).toBe("Chrysippus");
  });

  test("cited_work matches title, author, or slug", async () => {
    const byAuthor = (await client().dispatch("atlas_citations", {
      cited_work: "chrysippus",
    })) as { count: number };
    expect(byAuthor.count).toBe(1);
  });
});

describe("atlas reader", () => {
  test("indexes are fetched once per client, not per call", async () => {
    const c = client();
    fetchCount = 0;
    await c.dispatch("atlas_search", { query: "zeus" });
    await c.dispatch("atlas_search", { query: "indra" });
    await c.dispatch("atlas_search", { query: "olympus" });
    // meta.json + entities-index.json — and nothing re-fetched.
    expect(fetchCount).toBe(2);
  });

  test("a missing Atlas explains that the corpus tools still work", async () => {
    const empty = createAtlasClient(
      "/corpus/graph/atlas/",
      (async () => new Response("nope", { status: 404 })) as typeof fetch,
    );
    let error = "";
    try {
      await empty.dispatch("atlas_coverage", {});
    } catch (err) {
      error = (err as Error).message;
    }
    expect(error).toContain("Atlas file not found");
  });
});
