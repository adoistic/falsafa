/**
 * Atlas tool tests for the installed MCP.
 *
 * These run against a temp Atlas directory on disk (local mode), which also
 * pins the source-resolution rule: a corpus root containing graph/atlas/ is
 * used directly, no network. What's asserted is mostly honesty rather than
 * lookup — coverage is read from meta.json, and an unprocessed work reports
 * in_atlas=false with an explanation instead of an empty result that reads as
 * "this work contains nothing".
 *
 * The browser port (apps/site/src/islands/byok/__tests__/atlas.test.ts) covers
 * the same tools over HTTP; the two must stay shape-compatible.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Corpus } from "../src/corpus.ts";
import {
  Atlas,
  atlas_search,
  atlas_entity,
  atlas_work,
  atlas_citations,
  atlas_coverage,
} from "../src/atlas.ts";

let root: string;
let atlas: Atlas;

const META = {
  generated_at: "2026-07-29T19:08:33.392Z",
  ontology_version: "anchor-range-v1",
  windows_synthesized: 1614,
  windows_total: 12797,
  works_harvested: 357,
  works_total: 2018,
  kinds: { figure: 33080 },
  stances: { authority: 8070 },
  totals: { entities_merged: 36472 },
  coverage: {
    by_language: { Greek: { done: 730, total: 2656 }, Sanskrit: { done: 245, total: 245 } },
    by_era: { Ancient: { done: 276, total: 276 } },
  },
};

const ENTITIES_INDEX = [
  {
    slug: "zeus",
    kind: "figure",
    figure_kind: "deity",
    name: "Zeus",
    surfaces: ["son of Kronos"],
    works: 123,
    mentions: 309,
    evidence: 900,
    page: true,
  },
  {
    slug: "indra",
    kind: "figure",
    name: "Indra",
    surfaces: ["Śakra"],
    works: 20,
    mentions: 182,
    evidence: 944,
    page: true,
  },
];

const ZEUS = {
  slug: "zeus",
  kind: "figure",
  figure_kind: "deity",
  name: "Zeus",
  surfaces: ["son of Kronos"],
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
      description: "King of the gods on Olympus.",
      quotes: [
        {
          p: "p-35208b",
          text: "He will return to Olympus twelve days hence;",
          chapter: "01",
          variant: "translation",
        },
      ],
    },
  ],
};

const WORKS_ATLAS = [
  {
    work: "homer-iliad-056ee9",
    title: "Iliad",
    author: "homer",
    windows_done: 20,
    windows_total: 24,
    entity_rows: 400,
    kinds: { figure: 300 },
    citations_out: 5,
    quote_events: 60,
    themes: 30,
    top_entities: [{ slug: "zeus", kind: "figure", name: "Zeus", count: 25 }],
  },
];

const ILIAD = {
  work: "homer-iliad-056ee9",
  chapters: {
    "01": [
      { slug: "zeus", kind: "figure", name: "Zeus", count: 25, desc: "King of the gods.", p: ["p-35208b"], page: true },
    ],
  },
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
    cited_work: "On Providence",
    cited_author: "Chrysippus",
    stance: "refute",
    count: 3,
    to_work: null,
    quotes: [],
  },
];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "falsafa-atlas-"));
  const dir = join(root, "graph", "atlas");
  mkdirSync(join(dir, "entities"), { recursive: true });
  mkdirSync(join(dir, "works"), { recursive: true });
  const write = (rel: string, body: unknown) =>
    writeFileSync(join(dir, rel), JSON.stringify(body), "utf-8");
  write("meta.json", META);
  write("entities-index.json", ENTITIES_INDEX);
  write("citations.json", CITATIONS);
  write("works-atlas.json", WORKS_ATLAS);
  write("entities/figure--zeus.json", ZEUS);
  write("works/homer-iliad-056ee9.json", ILIAD);

  // A manifest is enough for `new Corpus(root)` to be constructible.
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ works: [] }), "utf-8");
  atlas = new Atlas(new Corpus(root));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Atlas source resolution", () => {
  test("a corpus root containing graph/atlas/ is read from disk", () => {
    expect(atlas.source).toBe(join(root, "graph", "atlas"));
    expect(atlas.source.startsWith("http")).toBe(false);
  });

  test("without a local Atlas it falls back to the public URL", () => {
    const bare = mkdtempSync(join(tmpdir(), "falsafa-bare-"));
    writeFileSync(join(bare, "manifest.json"), JSON.stringify({ works: [] }), "utf-8");
    try {
      expect(new Atlas(new Corpus(bare)).source).toBe("https://falsafa.ai/corpus/graph/atlas/");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("coverage", () => {
  test("percentages and the caveat come from meta.json", async () => {
    const out = await atlas_coverage(atlas);
    expect(out.works_in_atlas).toBe(357);
    expect(out.works_in_corpus).toBe(2018);
    expect(out.works_pct).toBe(17.7);
    expect(out.windows_pct).toBe(12.6);
    expect(out.caveat).toContain("NOT missing from the corpus");
    expect(out.by_language[0]!.language).toBe("Greek");
    expect(out.by_language[0]!.pct).toBe(27.5);
  });

  test("every tool response carries it", async () => {
    const responses = await Promise.all([
      atlas_search(atlas, { query: "Zeus" }),
      atlas_entity(atlas, { kind: "figure", slug: "zeus" }),
      atlas_work(atlas, { work_slug: "homer-iliad-056ee9" }),
      atlas_citations(atlas, {}),
    ]);
    for (const r of responses) {
      expect(r.atlas_coverage.works_pct).toBe(17.7);
    }
  });
});

describe("atlas_search", () => {
  test("matches names, aliases, and ASCII against diacritics", async () => {
    expect((await atlas_search(atlas, { query: "zeus" })).results[0]!.slug).toBe("zeus");
    expect((await atlas_search(atlas, { query: "son of kronos" })).results[0]!.slug).toBe("zeus");
    expect((await atlas_search(atlas, { query: "sakra" })).results[0]!.slug).toBe("indra");
  });

  test("rejects an unknown kind with the valid list", async () => {
    let hint = "";
    try {
      await atlas_search(atlas, { query: "zeus", kind: "deity" });
    } catch (err) {
      hint = (err as { hint?: string }).hint ?? "";
    }
    expect(hint).toContain("figure");
  });
});

describe("atlas_entity", () => {
  test("returns per-work glosses and absolute citation URLs", async () => {
    const out = await atlas_entity(atlas, { kind: "figure", slug: "zeus" });
    expect(out.name).toBe("Zeus");
    const iliad = out.works[0]!;
    expect(iliad.description).toContain("King of the gods");
    // Installed clients have no site origin to resolve against, so URLs are
    // absolute here (the browser port emits site-relative ones).
    expect(iliad.quotes[0]!.citation_url).toBe(
      "https://falsafa.ai/works/homer-iliad-056ee9/01/translation/#p-35208b",
    );
  });

  test("a missing dossier explains what to do next", async () => {
    let msg = "";
    try {
      await atlas_entity(atlas, { kind: "figure", slug: "nobody" });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain("No Atlas dossier");
  });
});

describe("atlas_work", () => {
  test("reports this work's own completeness", async () => {
    const out = await atlas_work(atlas, { work_slug: "homer-iliad-056ee9" });
    expect(out.in_atlas).toBe(true);
    expect(out.work_completeness!.windows_pct).toBe(83.3);
    expect(out.chapters[0]!.entities[0]!.name).toBe("Zeus");
  });

  test("an unprocessed work is not an error and does not imply a missing text", async () => {
    const out = await atlas_work(atlas, { work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c" });
    expect(out.in_atlas).toBe(false);
    expect(out.note).toContain("read_chapter");
  });
});

describe("atlas_citations", () => {
  test("filters by stance and flags cited works outside the corpus", async () => {
    const out = await atlas_citations(atlas, { stance: "refute" });
    expect(out.count).toBe(1);
    expect(out.edges[0]!.cited_author).toBe("Chrysippus");
    expect(out.edges[0]!.cited_work_in_corpus).toBe(false);
  });

  test("filters by citing work and carries citable quotes", async () => {
    const out = await atlas_citations(atlas, {
      work_slug: "clement-of-alexandria-stromata-694383",
    });
    expect(out.edges[0]!.stance).toBe("authority");
    expect(out.edges[0]!.quotes[0]!.citation_url).toContain("#p-d81ad5");
  });
});
