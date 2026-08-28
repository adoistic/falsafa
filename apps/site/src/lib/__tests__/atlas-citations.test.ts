// apps/site/src/lib/__tests__/atlas-citations.test.ts
//
// The citation reader is the layer every citation surface stands on, and the
// numbers it produces are printed as claims: "31 citations across six books".
// These tests hold the folds to that standard on data small enough to count
// by hand.
//
// Two things make the module hard to test naively, and both are handled here
// rather than worked around. First, ATLAS_ROOT is derived from the module's
// own location, so the reader always finds the shipped 13 MB artifacts; the
// fixture instance is a COPY of the same source run from a synthetic root.
// Second, the loaders memoize per build, so a fold that aliased an artifact
// object instead of copying it would double its own counts on the second
// call — `foldsTwiceWithoutDoubling` exists for exactly that.
//
// Run from apps/site/src, never from apps/site: the site tsconfig includes
// **/* and a bare `bun test` walks the 120k-file public/corpus symlink into
// EMFILE.

import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type * as AC from "../atlas-citations";
import { liveDeps } from "../atlas-citations";

// ───────────────────────────────────────────────────────── fixture loader

const LIB = dirname(fileURLToPath(new URL("../atlas-citations.ts", import.meta.url)));
const SOURCES = ["atlas-citations.ts", "atlas-graph.ts", "corpus.ts", "citation-url.ts"];

/**
 * A second instance of the real module, reading a corpus root that holds only
 * the given artifacts. The sources are copied rather than symlinked because
 * Bun resolves a symlinked module to its realpath, which would put the module
 * back beside the shipped corpus.
 */
async function loadWith(artifacts: Record<string, unknown>): Promise<typeof AC> {
  const root = mkdtempSync(join(tmpdir(), "falsafa-citations-"));
  const lib = join(root, "apps", "site", "src", "lib");
  mkdirSync(lib, { recursive: true });
  mkdirSync(join(root, "corpus"), { recursive: true });
  for (const f of SOURCES) copyFileSync(join(LIB, f), join(lib, f));
  for (const [rel, body] of Object.entries(artifacts)) {
    const p = join(root, "corpus", "graph", "atlas", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body));
  }
  return (await import(join(lib, "atlas-citations.ts"))) as typeof AC;
}

// ───────────────────────────────────────────────────────── fixture artifacts

const chapterOrder: Record<string, number> = {
  "01-real": 1,
  "01-a": 1,
  "01-b": 1,
  "02-b": 2,
  "05-e": 5,
  "16-vi-de-la-liberte": 16,
};

/** Deps that answer for the fixture chapters and reject everything else. */
function deps(over: Partial<AC.Deps> = {}): AC.Deps {
  return {
    exists: (_w, c) => c in chapterOrder,
    order: (_w, c) => chapterOrder[c] ?? Number.MAX_SAFE_INTEGER,
    short: (_w, c) => `locus ${c}`,
    title: (_w, c) => `Title of ${c}`,
    href: (w, c, v) => `/works/${w}/${c}/${v}/`,
    ...over,
  };
}

function chapter(
  slug: string,
  count: number,
  over: Partial<AC.ChapterCitation> = {},
): AC.ChapterCitation {
  return { chapter: slug, variant: "translation", count, p: [`p-${slug}`], quotes: [], ...over };
}

function edge(over: Partial<AC.WorkCitationEdge> = {}): AC.WorkCitationEdge {
  const base: AC.WorkCitationEdge = {
    target: "l:fixture",
    label: "A Fixture Source",
    count: 1,
    passages: 0,
    stances: {},
    chapters: [],
    unanchored: 0,
    ...over,
  };
  // The synthesizer derives `passages` from the run it serialises beside it,
  // so a fixture that set the two independently would let a page pass here
  // and print an unbalanced row against the real artifact.
  return { ...base, passages: base.chapters.reduce((n, c) => n + c.count, 0) };
}

function row(over: Partial<AC.CitationRow> = {}): AC.CitationRow {
  return {
    key: "l:fixture",
    label: "A Fixture Source",
    inLibrary: false,
    href: null,
    count: 1,
    passages: 0,
    stances: {},
    loci: [],
    lost: 0,
    lostPassages: 0,
    ...over,
  };
}

function locus(over: Partial<AC.Locus> = {}): AC.Locus {
  return {
    chapter: "01-a",
    variant: "translation",
    label: "locus 01-a",
    title: "Title of 01-a",
    count: 1,
    href: "/works/fx-alpha/01-a/translation/",
    anchors: ["p-01-a"],
    quotes: [],
    ...over,
  };
}

const INDEX: AC.CitationsIndexFile = {
  version: 1,
  generated_at: "2026-08-22T00:00:00Z",
  works: ["fx-alpha", "fx-beta"],
  targets: [
    {
      key: "w:fx-held",
      kind: "work",
      slug: "fx-held",
      label: "The Held Work",
      to_work: "fx-held",
      total: 6,
      passages: 8,
      citing_works: 2,
      stances: { authority: 6 },
    },
    {
      key: "a:fx-homer",
      kind: "author",
      slug: "fx-homer",
      file: "a-fx-homer",
      label: "Homerus",
      to_author: "fx-homer",
      total: 4,
      passages: 5,
      citing_works: 2,
      stances: { authority: 2, neutral: 2 },
    },
    {
      key: "w:fx-iliad",
      kind: "work",
      slug: "fx-iliad",
      file: "w-fx-iliad",
      label: "Ilias",
      to_work: "fx-iliad",
      to_author: "fx-homer",
      total: 3,
      passages: 3,
      citing_works: 1,
      stances: { neutral: 3 },
    },
    {
      key: "w:fx-odyssey",
      kind: "work",
      slug: "fx-odyssey",
      file: "w-fx-odyssey",
      label: "Odysseia",
      to_work: "fx-odyssey",
      to_author: "fx-homer",
      total: 1,
      passages: 1,
      citing_works: 1,
      stances: { refute: 1 },
    },
    {
      key: "l:wanted-paged",
      kind: "label",
      slug: "wanted-paged",
      file: "l-wanted-paged",
      label: "A Wanted Book",
      total: 5,
      passages: 6,
      citing_works: 2,
      stances: {},
    },
    {
      key: "l:wanted-alone",
      kind: "label",
      slug: "wanted-alone",
      label: "Named Once Only",
      total: 1,
      passages: 1,
      citing_works: 1,
      stances: {},
    },
  ],
  totals: { edges: 3 },
};

const EMPTY_TOTALS: AC.WorkCitationsFile["totals"] = {
  citations: 0,
  passages: 0,
  edges: 0,
  targets: 0,
  chapters: 0,
  stances: {},
  in_library_works: 0,
  in_library_authors: 0,
  unresolved: 0,
  chapterless: 0,
};

/** Two works by one author, sharing one target — the author-fold fixture. */
const WORK_ALPHA: AC.WorkCitationsFile = {
  version: 1,
  work: "fx-alpha",
  edges: [
    edge({
      target: "l:shared",
      label: "Shared Source",
      count: 3,
      stances: { authority: 2, refute: 1 },
      chapters: [chapter("01-a", 3, { quotes: [{ p: "p-01-a", text: "A".repeat(90) }] })],
    }),
    edge({
      target: "l:only-alpha",
      label: "Alpha Only",
      count: 1,
      stances: { neutral: 1 },
      chapters: [chapter("01-a", 1)],
    }),
  ],
  by_chapter: { "01-a": [0, 1] },
  totals: { ...EMPTY_TOTALS, citations: 4, edges: 2, targets: 2, chapters: 1 },
};

const WORK_BETA: AC.WorkCitationsFile = {
  version: 1,
  work: "fx-beta",
  edges: [
    edge({
      target: "l:shared",
      label: "Shared Source",
      count: 5,
      stances: { authority: 5 },
      chapters: [chapter("01-b", 5)],
    }),
  ],
  by_chapter: { "01-b": [0] },
  totals: { ...EMPTY_TOTALS, citations: 5, edges: 1, targets: 1, chapters: 1 },
};

function citedBy(over: Partial<AC.CitedByRow> = {}): AC.CitedByRow {
  const base: AC.CitedByRow = {
    from: "fx-citer",
    count: 1,
    passages: 0,
    stances: {},
    chapters: [],
    ...over,
  };
  return { ...base, passages: base.chapters.reduce((n, c) => n + c.count, 0) };
}

/** Homer's three reverse files: the name, and two of his works. */
const TARGET_HOMER: AC.CitedTargetFile = {
  version: 1,
  key: "a:fx-homer",
  kind: "author",
  slug: "fx-homer",
  label: "Homerus",
  to_author: "fx-homer",
  total: 4,
  passages: 5,
  citing_works: 2,
  stances: { authority: 2, neutral: 2 },
  by: [
    citedBy({
      from: "fx-citer",
      count: 2,
      stances: { authority: 2 },
      chapters: [{ chapter: "01-a", variant: "translation", count: 2, p: ["p-01-a"] }],
      quote: { p: "p-01-a", text: "B".repeat(90), chapter: "01-a", variant: "translation" },
    }),
    citedBy({ from: "fx-other", count: 2, stances: { neutral: 2 } }),
  ],
};

const TARGET_ILIAD: AC.CitedTargetFile = {
  version: 1,
  key: "w:fx-iliad",
  kind: "work",
  slug: "fx-iliad",
  label: "Ilias",
  to_work: "fx-iliad",
  total: 3,
  passages: 3,
  citing_works: 1,
  stances: { neutral: 3 },
  by: [
    citedBy({
      from: "fx-citer",
      count: 3,
      stances: { neutral: 3 },
      chapters: [{ chapter: "02-b", variant: "translation", count: 3, p: ["p-02-b"] }],
    }),
  ],
};

const TARGET_ODYSSEY: AC.CitedTargetFile = {
  version: 1,
  key: "w:fx-odyssey",
  kind: "work",
  slug: "fx-odyssey",
  label: "Odysseia",
  to_work: "fx-odyssey",
  total: 1,
  passages: 0,
  citing_works: 1,
  stances: { refute: 1 },
  by: [citedBy({ from: "fx-third", count: 1, stances: { refute: 1 } })],
};

const fx = await loadWith({
  "citations/index.json": INDEX,
  "citations/works/fx-alpha.json": WORK_ALPHA,
  "citations/works/fx-beta.json": WORK_BETA,
  "citations/targets/a-fx-homer.json": TARGET_HOMER,
  "citations/targets/w-fx-iliad.json": TARGET_ILIAD,
  "citations/targets/w-fx-odyssey.json": TARGET_ODYSSEY,
});

/** The same source with no artifacts under it at all. */
const absent = await loadWith({});

// ───────────────────────────────────────────────────────── hydrateEdge

describe("hydrateEdge", () => {
  test("drops a chapter the manifest no longer has and counts it apart", () => {
    // The drift pin. The harvest predates the next chapter re-split, so a
    // (work, chapter) pair can go dead between harvest and build; a dropped
    // locus must still be COUNTED, never silently lost and never rendered as
    // a heading that links nowhere. Its paragraphs are counted in
    // lostPassages and NOT added to `lost`, which is a tally of records.
    const r = fx.hydrateEdge(
      "fx-alpha",
      edge({
        count: 9,
        chapters: [chapter("01-real", 5), chapter("16-vi-de-la-liberte", 4)],
      }),
      deps({ exists: (_w, c) => c === "01-real" }),
    );
    expect(r.loci.length).toBe(1);
    expect(r.loci[0]!.chapter).toBe("01-real");
    expect(r.lostPassages).toBe(4);
    expect(r.lost).toBe(0);
    // and the surviving run is what `passages` totals, not the artifact's 9
    expect(r.passages).toBe(5);
  });

  test("keeps unanchored records and dropped paragraphs in separate units", () => {
    const r = fx.hydrateEdge(
      "fx-alpha",
      edge({ chapters: [chapter("16-vi-de-la-liberte", 4)], unanchored: 3 }),
      deps({ exists: () => false }),
    );
    expect(r.lost).toBe(3);
    expect(r.lostPassages).toBe(4);
    expect(r.passages).toBe(0);
  });

  test("totals passages as the sum of the run a reader can add up", () => {
    const r = fx.hydrateEdge(
      "fx-alpha",
      edge({ count: 3, chapters: [chapter("01-a", 5), chapter("02-b", 7)] }),
      deps(),
    );
    expect(r.count).toBe(3);
    expect(r.passages).toBe(12);
    expect(r.loci.reduce((n, l) => n + l.count, 0)).toBe(r.passages);
  });

  test("sorts loci by reading order, not by artifact order and not by count", () => {
    const r = fx.hydrateEdge(
      "fx-alpha",
      edge({ chapters: [chapter("05-e", 9), chapter("02-b", 1)] }),
      deps(),
    );
    expect(r.loci.map((l) => l.chapter)).toEqual(["02-b", "05-e"]);
  });

  test("an edge with no chapters yields no loci and lost === unanchored", () => {
    const r = fx.hydrateEdge("fx-alpha", edge({ count: 7, unanchored: 7 }), deps());
    expect(r.loci).toEqual([]);
    expect(r.lost).toBe(7);
    // 42 standing rows site-wide are in exactly this state. They must still
    // carry their count, because the page prints "locus not recovered" beside
    // it rather than hiding the row.
    expect(r.count).toBe(7);
  });

  test("passes every paragraph id of a chapter to href, so the multi-¶ grammar fires", () => {
    const ps = Array.from({ length: 30 }, (_, i) => `p-${i}`);
    const seen: string[][] = [];
    fx.hydrateEdge(
      "fx-alpha",
      edge({ chapters: [chapter("01-a", 30, { p: ps })] }),
      deps({
        href: (_w, _c, _v, got) => {
          seen.push(got);
          return "/x/";
        },
      }),
    );
    expect(seen).toEqual([ps]);
  });

  test("liveDeps.href lists every paragraph it was given, uncapped", () => {
    // The link has to light exactly what the number beside it claims. The old
    // 24-id cap made a superscript of 40 open a page showing 24; across the
    // library it withheld 2,455 ids on 73 of 15,252 chapter slots, which is
    // about 22 KB of query string for an exact link.
    const ps = Array.from({ length: 40 }, (_, i) => `p-${String(i).padStart(4, "0")}`);
    const href = liveDeps.href(
      "clement-of-alexandria-stromata-694383",
      "01-book-1",
      "translation",
      ps,
    );
    expect(href).toStartWith("/works/clement-of-alexandria-stromata-694383/01-book-1/translation/?");
    const listed = new URL(href!, "https://falsafa.ai").searchParams.get("paragraphs")!.split(",");
    expect(listed).toEqual(ps);
    expect(href).toEndWith("#p-0000");
  });

  test("carries every anchor through, so count and the list cannot drift", () => {
    // The RENDER caps — the reader panel prints six marks and a linked
    // remainder. The list may not, or the number printed beside it would be
    // a claim about paragraphs the page no longer holds.
    const ps = Array.from({ length: 30 }, (_, i) => `p-${i}`);
    const r = fx.hydrateEdge(
      "fx-alpha",
      edge({ chapters: [chapter("01-a", 30, { p: ps })] }),
      deps(),
    );
    expect(r.loci[0]!.anchors).toEqual(ps);
    expect(r.loci[0]!.anchors.length).toBe(r.loci[0]!.count);
  });

  test("copies the stance map so an author fold cannot mutate the memoized artifact", () => {
    const e = edge({ stances: { authority: 2 } });
    const r = fx.hydrateEdge("fx-alpha", e, deps());
    r.stances.authority = 99;
    expect(e.stances.authority).toBe(2);
  });

  test("marks in-library by resolution, not by kind, and links accordingly", () => {
    const held = fx.hydrateEdge("fx-alpha", edge({ target: "w:fx-held", to_work: "fx-held" }), deps());
    expect(held.inLibrary).toBe(true);
    expect(held.href).toBe("/works/fx-held/citations/#cited-by");

    const wanted = fx.hydrateEdge("fx-alpha", edge({ target: "l:wanted-paged" }), deps());
    expect(wanted.inLibrary).toBe(false);
    expect(wanted.href).toBe("/atlas/citations/wanted-paged/");

    const unpaged = fx.hydrateEdge("fx-alpha", edge({ target: "l:wanted-alone" }), deps());
    expect(unpaged.inLibrary).toBe(false);
    expect(unpaged.href).toBeNull();
  });
});

// ───────────────────────────────────────────────────────── ranking + folds

describe("rankRows", () => {
  const rows = [
    row({ key: "l:zeta", label: "Zeta", count: 4 }),
    row({ key: "w:beta", label: "Beta", count: 4, inLibrary: true }),
    row({ key: "l:alpha", label: "Alpha", count: 4 }),
    row({ key: "l:solo", label: "Solo", count: 9 }),
  ];

  test("orders count DESC, then in-library, then label ASC", () => {
    expect(fx.rankRows(rows).map((r) => r.label)).toEqual(["Solo", "Beta", "Alpha", "Zeta"]);
  });

  test("is deterministic under a shuffled input — a locus run is not a race", () => {
    const shuffled = [rows[2]!, rows[0]!, rows[3]!, rows[1]!];
    const a = fx.rankRows(shuffled).map((r) => r.key);
    const b = fx.rankRows(shuffled.slice().reverse()).map((r) => r.key);
    expect(a).toEqual(b);
    expect(a).toEqual(["l:solo", "w:beta", "l:alpha", "l:zeta"]);
  });

  test("does not mutate its input", () => {
    const input = rows.slice();
    fx.rankRows(input);
    expect(input.map((r) => r.label)).toEqual(["Zeta", "Beta", "Alpha", "Solo"]);
  });
});

describe("splitStandingAndOnce", () => {
  test("standing = cited twice, or held by the library, whichever comes first", () => {
    const [standing, once] = fx.splitStandingAndOnce([
      row({ key: "a", count: 2 }),
      row({ key: "b", count: 1, inLibrary: true }),
      row({ key: "c", count: 1 }),
      row({ key: "d", count: 9, inLibrary: true }),
    ]);
    expect(standing.map((r) => r.key)).toEqual(["a", "b", "d"]);
    expect(once.map((r) => r.key)).toEqual(["c"]);
  });

  test("preserves rank order inside each half", () => {
    const [standing] = fx.splitStandingAndOnce([
      row({ key: "hi", count: 9 }),
      row({ key: "mid", count: 5 }),
      row({ key: "lo", count: 2 }),
    ]);
    expect(standing.map((r) => r.key)).toEqual(["hi", "mid", "lo"]);
  });
});

// ───────────────────────────────────────────────────────── specimens

describe("allocateSpecimens", () => {
  test("stops at the byte budget: 40 rows of 1,000 chars against 24 KB gives 24", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({
        key: `k${i}`,
        loci: [locus({ quotes: [{ p: `p-${i}`, text: "x".repeat(1_000) }] })],
      }),
    );
    fx.allocateSpecimens("fx-alpha", rows, 24_000);
    expect(rows.filter((r) => r.specimen).length).toBe(24);
    expect(rows[23]!.specimen).toBeDefined();
    expect(rows[24]!.specimen).toBeUndefined();
  });

  test("prefers a substantive quote to an OCR fragment in the same locus", () => {
    const rows = [
      row({
        loci: [
          locus({
            quotes: [
              { p: "p-frag", text: "These are good reasons for remonstrating with Edition:" },
              { p: "p-real", text: "C".repeat(80) },
            ],
          }),
        ],
      }),
    ];
    fx.allocateSpecimens("fx-alpha", rows);
    expect(rows[0]!.specimen!.quote.p).toBe("p-real");
  });

  test("falls back to a short quote when the locus has nothing longer", () => {
    const rows = [row({ loci: [locus({ quotes: [{ p: "p-frag", text: "Too short." }] })] })];
    fx.allocateSpecimens("fx-alpha", rows);
    expect(rows[0]!.specimen!.quote.p).toBe("p-frag");
  });

  test("takes the quote from the densest locus, not the first in reading order", () => {
    const rows = [
      row({
        loci: [
          locus({ chapter: "01-a", count: 1, quotes: [{ p: "p-thin", text: "D".repeat(90) }] }),
          locus({ chapter: "05-e", count: 9, quotes: [{ p: "p-dense", text: "E".repeat(90) }] }),
        ],
      }),
    ];
    fx.allocateSpecimens("fx-alpha", rows);
    expect(rows[0]!.specimen!.chapter).toBe("05-e");
    expect(rows[0]!.specimen!.quote.p).toBe("p-dense");
  });

  test("carries the harvest's role, falling back to its hint, as the caption", () => {
    const rows = [
      row({ loci: [locus({ quotes: [{ p: "p", text: "F".repeat(90) }], hint: "h", role: "r" })] }),
      row({ loci: [locus({ quotes: [{ p: "p", text: "G".repeat(90) }], hint: "h" })] }),
    ];
    fx.allocateSpecimens("fx-alpha", rows);
    expect(rows[0]!.specimen!.note).toBe("r");
    expect(rows[1]!.specimen!.note).toBe("h");
  });

  test("a row whose loci hold no quote gets no specimen and spends no budget", () => {
    // 42 standing rows site-wide have no locus at all and can never carry a
    // specimen. They must not consume the budget that the rows after them
    // depend on — the page renders them as "locus not recovered" instead.
    const rows = [
      row({ key: "no-locus" }),
      row({ key: "no-quote", loci: [locus()] }),
      row({ key: "has-quote", loci: [locus({ quotes: [{ p: "p", text: "H".repeat(90) }] })] }),
    ];
    fx.allocateSpecimens("fx-alpha", rows, 100);
    expect(rows[0]!.specimen).toBeUndefined();
    expect(rows[1]!.specimen).toBeUndefined();
    expect(rows[2]!.specimen).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────── grouping + index

describe("groupOnceByChapter", () => {
  test("buckets each name under the one chapter that names it, in rank order", () => {
    const groups = fx.groupOnceByChapter([
      row({ key: "first", loci: [locus({ chapter: "01-a", label: "book 1" })] }),
      row({ key: "other", loci: [locus({ chapter: "02-b", label: "book 2" })] }),
      row({ key: "second", loci: [locus({ chapter: "01-a", label: "book 1" })] }),
    ]);
    expect(groups.map((g) => g.chapter)).toEqual(["01-a", "02-b"]);
    expect(groups[0]!.names.map((r) => r.key)).toEqual(["first", "second"]);
    expect(groups[0]!.label).toBe("book 1");
  });

  test("a name with no recovered locus lands in the empty-key group, not a blank heading", () => {
    // 369 rows site-wide have zero loci and 101 works carry such a group.
    // The empty chapter/label/href is the signal the pages branch on to print
    // "locus not recovered"; if this ever became "01-a" the page would print
    // a heading that lies.
    const groups = fx.groupOnceByChapter([row({ key: "orphan" })]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.chapter).toBe("");
    expect(groups[0]!.label).toBe("");
    expect(groups[0]!.href).toBeNull();
    expect(groups[0]!.names.map((r) => r.key)).toEqual(["orphan"]);
  });
});

describe("indexLetter", () => {
  test("strips a leading article before bucketing", () => {
    expect(fx.indexLetter("The Federalist")).toBe("F");
    expect(fx.indexLetter("a Treatise")).toBe("T");
  });

  test("buckets a plain title on its own first letter", () => {
    expect(fx.indexLetter("Psalms")).toBe("P");
  });

  test("sends a non-Latin title to the catch-all bucket rather than inventing one", () => {
    expect(fx.indexLetter("Ἰλιάς")).toBe("—");
    expect(fx.indexLetter("")).toBe("—");
  });
});

describe("targetAnchor", () => {
  test("mints the id the pages link to", () => {
    expect(fx.targetAnchor("w:homer-iliad-056ee9")).toBe("t-w-homer-iliad-056ee9");
  });

  test("is a valid, selector-safe HTML id", () => {
    expect(fx.targetAnchor("l:twelve-tables")).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  test("keeps the three namespaces distinct, so two rows cannot collide on one id", () => {
    const keys = ["w:plato", "a:plato", "l:plato"];
    expect(new Set(keys.map(fx.targetAnchor)).size).toBe(3);
  });
});

// ───────────────────────────────────────────────────────── work scope

describe("workCitations", () => {
  test("leaves every row without a specimen — the page owns the budget", () => {
    // 2,313 standing rows site-wide reach the page with specimen: undefined.
    // A page that forgot to call allocateSpecimens would show no quotations
    // at all, so this contract is load-bearing.
    const v = fx.workCitations("fx-alpha", deps())!;
    expect(v.rows.length).toBe(2);
    expect(v.rows.every((r) => r.specimen === undefined)).toBe(true);
  });

  test("does not memoize a view hydrated against injected Deps", () => {
    const a = fx.workCitations("fx-alpha", deps({ short: () => "FIRST" }))!;
    const b = fx.workCitations("fx-alpha", deps({ short: () => "SECOND" }))!;
    expect(a.rows[0]!.loci[0]!.label).toBe("FIRST");
    expect(b.rows[0]!.loci[0]!.label).toBe("SECOND");
  });

  test("arranges chapters in reading order and totals each chapter's anchors", () => {
    const v = fx.workCitations("fx-alpha", deps())!;
    expect(v.chapters.map((c) => c.chapter)).toEqual(["01-a"]);
    // 3 from the shared source and 1 from the alpha-only one: the sum of the
    // superscripts the run prints, which is what the folio must say.
    expect(v.chapters[0]!.anchors).toBe(4);
    expect(v.chapters[0]!.anchors).toBe(
      v.chapters[0]!.rows.reduce(
        (n, r) => n + (r.loci.find((l) => l.chapter === "01-a")?.count ?? 0),
        0,
      ),
    );
    expect(v.chapters[0]!.title).toBe("Title of 01-a");
  });

  test("reports what was lost in both units, without adding them together", () => {
    const v = fx.workCitations("fx-alpha", deps({ exists: () => false }))!;
    // every chapter dropped: the paragraphs are stranded, but no citation
    // record went unanchored in the harvest, so `lost` stays at zero.
    expect(v.totals.lostPassages).toBe(4);
    expect(v.totals.lost).toBe(0);
    expect(v.chapters).toEqual([]);
  });

  test("returns null for a work that cites nothing", () => {
    expect(fx.workCitations("fx-not-a-work", deps())).toBeNull();
    expect(fx.chapterCitations("fx-not-a-work", "01-a", deps())).toEqual([]);
  });
});

describe("chapterCitations", () => {
  test("returns the rows that fire in one chapter, each carrying its full run", () => {
    const rows = fx.chapterCitations("fx-alpha", "01-a", deps());
    expect(rows.map((r) => r.key)).toEqual(["l:shared", "l:only-alpha"]);
    expect(rows[0]!.loci.length).toBe(1);
  });

  test("returns nothing for a chapter that cites nothing", () => {
    expect(fx.chapterCitations("fx-alpha", "05-e", deps())).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────── author scope

describe("authorCitationsOut", () => {
  test("folds one target across two works, sums the stances, orders works count DESC", () => {
    const out = fx.authorCitationsOut(["fx-alpha", "fx-beta"], deps())!;
    const shared = out.targets.find((t) => t.key === "l:shared")!;
    expect(shared.total).toBe(8);
    expect(shared.works.map((w) => `${w.work}:${w.count}`)).toEqual(["fx-beta:5", "fx-alpha:3"]);
    expect(shared.stances).toEqual({ authority: 7, refute: 1 });
    expect(out.totals).toMatchObject({ citations: 9, targets: 2, works: 2 });
  });

  test("ranks a target that spans more works above one that is cited more often in a single work", () => {
    const out = fx.authorCitationsOut(["fx-alpha", "fx-beta"], deps())!;
    expect(out.targets.map((t) => t.key)).toEqual(["l:shared", "l:only-alpha"]);
  });

  test("folds twice without doubling, though the work files are memoized", () => {
    const first = fx.authorCitationsOut(["fx-alpha", "fx-beta"], deps())!;
    const second = fx.authorCitationsOut(["fx-alpha", "fx-beta"], deps())!;
    expect(second.targets.find((t) => t.key === "l:shared")!.total).toBe(
      first.targets.find((t) => t.key === "l:shared")!.total,
    );
    expect(second.totals.citations).toBe(9);
  });

  test("separates an author's canon from his incidental references", () => {
    const out = fx.authorCitationsOut(["fx-alpha", "fx-beta"], deps())!;
    expect(out.standing.map((t) => t.key)).toEqual(["l:shared"]);
    expect(out.once.map((t) => t.key)).toEqual(["l:only-alpha"]);
  });

  test("returns null for an author whose works cite nothing", () => {
    expect(fx.authorCitationsOut(["fx-not-a-work"], deps())).toBeNull();
  });
});

describe("authorCitedBy", () => {
  test("merges the name file with the work files into one row per citing work", () => {
    const inbound = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!;
    expect(inbound.total).toBe(8);
    expect(inbound.by.map((r) => r.from)).toEqual(["fx-citer", "fx-other", "fx-third"]);
    expect(inbound.citingWorks).toBe(3);
  });

  test("a work that cites both the name and a work is ONE row whose count is the sum", () => {
    const citer = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!.by.find(
      (r) => r.from === "fx-citer",
    )!;
    expect(citer.count).toBe(5);
    expect(citer.via).toEqual(["Homerus", "Ilias"]);
    expect(citer.stances).toEqual({ authority: 2, neutral: 3 });
    expect(citer.chapters.map((c) => c.chapter)).toEqual(["01-a", "02-b"]);
  });

  test("merges twice without doubling, though the target files are memoized", () => {
    // The reverse files are read once per build and handed to every author
    // page that touches them. A shallow merge would make Homer's second
    // render claim ten citations where the first claimed five.
    const a = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!;
    const b = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!;
    expect(b.total).toBe(a.total);
    expect(b.by.find((r) => r.from === "fx-citer")!.count).toBe(5);
    expect(b.by.find((r) => r.from === "fx-citer")!.via).toEqual(["Homerus", "Ilias"]);
  });

  test("keeps the first verbatim specimen it finds for a merged row", () => {
    const citer = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!.by.find(
      (r) => r.from === "fx-citer",
    )!;
    expect(citer.quote?.chapter).toBe("01-a");
  });

  test("passages are the sum of the merged run, in a unit of their own", () => {
    const citer = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!.by.find(
      (r) => r.from === "fx-citer",
    )!;
    // 5 records, 2 paragraphs in 01-a and 3 in 02-b — the two units differ
    // and the run adds to the second, never to the first.
    expect(citer.count).toBe(5);
    expect(citer.passages).toBe(5);
    expect(citer.chapters.reduce((n, c) => n + c.count, 0)).toBe(citer.passages);
  });

  test("a paragraph naming the author AND one of his works counts once", async () => {
    // Homer's name file and his Iliad file are two views of one author. A
    // paragraph of the citing work that names both appears in both files,
    // and adding the slot sizes would promise the reader a passage twice.
    const shared = await loadWith({
      "citations/index.json": {
        ...INDEX,
        targets: INDEX.targets.map((t) =>
          t.key === "a:fx-homer" || t.key === "w:fx-iliad" ? { ...t } : t,
        ),
      },
      "citations/targets/a-fx-homer.json": {
        ...TARGET_HOMER,
        by: [
          citedBy({
            from: "fx-citer",
            count: 2,
            chapters: [
              { chapter: "01-a", variant: "translation", count: 2, p: ["p-shared", "p-name"] },
            ],
          }),
        ],
      },
      "citations/targets/w-fx-iliad.json": {
        ...TARGET_ILIAD,
        by: [
          citedBy({
            from: "fx-citer",
            count: 3,
            chapters: [
              { chapter: "01-a", variant: "translation", count: 2, p: ["p-shared", "p-work"] },
            ],
          }),
        ],
      },
    });
    const citer = shared.authorCitedBy("fx-homer", ["fx-iliad"])!.by[0]!;
    expect(citer.count).toBe(5); // records DO add
    expect(citer.chapters[0]!.p).toEqual(["p-shared", "p-name", "p-work"]);
    expect(citer.chapters[0]!.count).toBe(3); // paragraphs do NOT
    expect(citer.passages).toBe(3);
  });

  test("the union does not write into the memoized artifact", () => {
    // The chapter arrays behind these rows are read once per build and handed
    // to every author page that touches them; pushing an id into one would
    // grow the next page's run by an id it never earned.
    const before = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!;
    const firstRun = before.by.map((r) => r.chapters.map((c) => c.p.length));
    const after = fx.authorCitedBy("fx-homer", ["fx-iliad", "fx-odyssey"])!;
    expect(after.by.map((r) => r.chapters.map((c) => c.p.length))).toEqual(firstRun);
    expect(after.passages).toBe(before.passages);
  });

  test("returns null when neither the name nor any work is ever cited", () => {
    expect(fx.authorCitedBy("fx-nobody", ["fx-nothing"])).toBeNull();
  });
});

// ───────────────────────────────────────────────────────── gates + links

describe("getStaticPaths gates", () => {
  test("names the works that cite, the works and authors that are cited", () => {
    expect([...fx.citingWorkSlugs()].sort()).toEqual(["fx-alpha", "fx-beta"]);
    expect([...fx.citedWorkSlugs()].sort()).toEqual(["fx-held", "fx-iliad", "fx-odyssey"]);
    expect([...fx.citedAuthorSlugs()].sort()).toEqual(["fx-homer"]);
  });

  test("wantedTargets is out-of-corpus labels that earned a file, and only those", () => {
    expect(fx.wantedTargets().map((t) => t.key)).toEqual(["l:wanted-paged"]);
  });

  test("targetHref resolves work, then author, then paged label, then nothing", () => {
    expect(fx.targetHref({ to_work: "fx-held" })).toBe("/works/fx-held/citations/#cited-by");
    expect(fx.targetHref({ to_author: "fx-homer" })).toBe("/authors/fx-homer/citations/#cited-by");
    expect(fx.targetHref({ key: "l:wanted-paged" })).toBe("/atlas/citations/wanted-paged/");
    expect(fx.targetHref({ key: "l:wanted-alone" })).toBeNull();
    expect(fx.targetHref({})).toBeNull();
  });

  test("a work resolution wins over an author one, so a titled row links to the title", () => {
    expect(fx.targetHref({ to_work: "fx-iliad", to_author: "fx-homer" })).toBe(
      "/works/fx-iliad/citations/#cited-by",
    );
  });
});

// ───────────────────────────────────────────────────────── graceful absence

describe("with the artifacts absent", () => {
  test("reports itself unavailable instead of throwing", () => {
    expect(absent.citationsAvailable()).toBe(false);
    expect(absent.citationsIndex()).toBeNull();
  });

  test("every getStaticPaths gate yields nothing, so no citation route is generated", () => {
    expect(absent.citingWorkSlugs().size).toBe(0);
    expect(absent.citedWorkSlugs().size).toBe(0);
    expect(absent.citedAuthorSlugs().size).toBe(0);
    expect(absent.wantedTargets()).toEqual([]);
  });

  test("every scope selector returns an empty shape", () => {
    expect(absent.workCitations("fx-alpha", deps())).toBeNull();
    expect(absent.chapterCitations("fx-alpha", "01-a", deps())).toEqual([]);
    expect(absent.workCitedBy("fx-iliad")).toBeNull();
    expect(absent.authorCitedBy("fx-homer", ["fx-iliad"])).toBeNull();
    expect(absent.authorCitationsOut(["fx-alpha"], deps())).toBeNull();
  });

  test("targetHref falls back to unlinked rather than minting a 404", () => {
    expect(absent.targetHref({ key: "l:wanted-paged" })).toBeNull();
    // A resolved in-corpus target still links: the destination is a work page
    // that exists whether or not the citation layer was built.
    expect(absent.targetHref({ to_work: "fx-held" })).toBe("/works/fx-held/citations/#cited-by");
  });
});
