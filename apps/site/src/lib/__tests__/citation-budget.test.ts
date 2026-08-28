// apps/site/src/lib/__tests__/citation-budget.test.ts
//
// The ladder decides how much apparatus a citations page prints. It runs on
// every one of the 594 built pages and its inputs span three orders of
// magnitude — 2 edges to 748 — so the cases that matter are the two ends and
// the order of the cuts in between.
//
// The rule the ladder exists to protect: a page may shrink its apparatus, but
// it may never print a citation number with no way to reach the passages
// behind it. That is why the last state is "ship whole and say so" rather
// than "withhold rows".
//
// The ceiling is a GZIP figure, because Cloudflare compresses every page the
// Worker serves. Fixtures are sized against that, so the numbers below are
// three to eleven times the markup they stand for.
//
// Run from apps/site/src, never apps/site (EMFILE on the corpus symlink).

import { describe, expect, test } from "bun:test";
import {
  CEILING,
  COST,
  PACK,
  runBudgetLadder,
  rungLabel,
  type LadderInput,
} from "../citation-budget";
import type { CitationRow, Locus } from "../atlas-citations";

// ───────────────────────────────────────────────────────── synthetic works

function locus(chapter: string, count: number, quote?: string): Locus {
  return {
    chapter,
    variant: "translation",
    label: `book ${chapter}`,
    title: `Book ${chapter}`,
    count,
    href: `/works/fx/${chapter}/translation/#p-1`,
    anchors: ["p-1"],
    quotes: quote === undefined ? [] : [{ p: "p-1", text: quote }],
  };
}

/** A row with `nLoci` chapters, each carrying a quotable specimen. */
function row(i: number, nLoci = 3, quoteLen = 160): CitationRow {
  return {
    key: `l:t${i}`,
    label: `Target ${String(i).padStart(3, "0")}`,
    inLibrary: false,
    href: null,
    count: 9,
    stances: { authority: 9 },
    loci: Array.from({ length: nLoci }, (_, j) =>
      locus(`0${j + 1}`, nLoci - j, "q".repeat(quoteLen)),
    ),
    lost: 0,
    lostPassages: 0,
    // the sum of the run above, so the fixture obeys the same identity the
    // ladder's real rows do: 3 + 2 + 1 for the default three loci.
    passages: (nLoci * (nLoci + 1)) / 2,
  };
}

function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    work: "fx-work",
    standing: [],
    onceGroups: [],
    showNamedOnce: false,
    orphanOnce: [],
    chapters: [],
    showByChapter: false,
    inbound: [],
    ...over,
  };
}

/**
 * The stress case: Viramitrodaya's shape — 748 edges on a SINGLE-chapter
 * work, so the whole apparatus lands in one movement with a 600-name
 * once-run under it. Quotes are long enough that the specimen budget
 * genuinely binds, which is what makes this the only fixture that spends
 * all three of the rungs available to it. The fourth is not: a single-
 * chapter work prints no reading-order movement, so there are no counts to
 * give up.
 */
function hugeWork(): LadderInput {
  return input({
    standing: Array.from({ length: 748 }, (_, i) => row(i, 1, 1_500)),
    onceGroups: [{ names: Array.from({ length: 600 }, (_, i) => row(i, 1, 0)) }],
    showNamedOnce: true,
  });
}

/** The median citing work: 8 edges, one chapter each. */
function medianWork(): LadderInput {
  return input({ standing: Array.from({ length: 8 }, (_, i) => row(i, 1)) });
}

// ───────────────────────────────────────────────────────── the median case

describe("the median citing work", () => {
  test("triggers no rung at all", () => {
    const r = runBudgetLadder(medianWork());
    expect(r.spent).toEqual([]);
    expect(r.log).toEqual([]);
    expect(r.over).toBe(false);
    expect(r.bytes).toBeLessThan(CEILING);
  });

  test("gives every standing row a full entry and a specimen", () => {
    const r = runBudgetLadder(medianWork());
    expect(r.top.length).toBe(8);
    expect(r.rest).toEqual([]);
    expect(r.top.every((x) => x.specimen !== undefined)).toBe(true);
  });

  test("a work with more than 24 sources still indexes the tail, never drops it", () => {
    const inp = input({ standing: Array.from({ length: 40 }, (_, i) => row(i, 1)) });
    const r = runBudgetLadder(inp);
    expect(r.top.length + r.rest.length).toBe(40);
    // The index line is the cheap form, not the withheld one: 16 rows moved
    // out of full entries are still on the page with their loci.
    expect(r.rest.every((x) => x.loci.length > 0)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────── rung order

describe("the ladder fires its rungs in order", () => {
  test("the specimen budget alone rescues a page whose weight is quotations", () => {
    // Twenty-four sources quoted at a thousand characters each, over a tail
    // of 700 that only ever get an index line. The entries all fit and the
    // index is nearly incompressible prefix-shared markup; the only dial
    // that can move is the quotation budget, and 16 KB of markup is 2.2 KB
    // on the wire, which is enough. The rungs below it are never reached.
    const inp = input({
      standing: [
        ...Array.from({ length: 24 }, (_, i) => row(i, 1, 1_000)),
        ...Array.from({ length: 700 }, (_, i) => row(100 + i, 1, 0)),
      ],
    });
    const r = runBudgetLadder(inp);
    expect(r.spent).toEqual(["specimen"]);
    expect(r.top.length).toBe(24);
    expect(r.over).toBe(false);
  });

  test("the named-once cap is spent before the top-24 reduction", () => {
    // A page whose weight is a single enormous once-named run: capping the
    // run at 200 names is enough, so the entries are never cut back.
    const inp = input({
      standing: [row(0, 1, 0)],
      onceGroups: [{ names: Array.from({ length: 6_000 }, (_, i) => row(i, 0, 0)) }],
      showNamedOnce: true,
    });
    const r = runBudgetLadder(inp);
    expect(r.spent).toEqual(["once"]);
    expect(r.top.length).toBe(1);
  });

  test("hands back the once-cap it settled on, because the page prints under it", () => {
    // The cap is a rendering dial as well as a pricing one: the template
    // slices each once-run at it and prints "… and N more". A ladder that
    // priced the cut without reporting it would print the whole run and
    // undercount its own page.
    expect(runBudgetLadder(medianWork()).onceCap).toBe(Number.POSITIVE_INFINITY);
    expect(runBudgetLadder(hugeWork()).onceCap).toBe(200);
  });

  test("the three rungs a single-chapter work has are spent in order", () => {
    const r = runBudgetLadder(hugeWork());
    expect(r.spent).toEqual(["specimen", "once", "full"]);
    expect(r.log.map((l) => l.rung)).toEqual(["specimen", "once", "full"]);
  });

  test("every logged rung actually lowered the estimate", () => {
    const r = runBudgetLadder(hugeWork());
    for (const l of r.log) expect(l.after).toBeLessThan(l.before);
  });

  test("a rung that buys nothing is not reported as spent", () => {
    // Clement is the real case: its top-24 quotes total 2,818 characters, so
    // the specimen budget never binds, and `showNamedOnce` is false, so the
    // cap has nothing to cap. Only the third rung moves the page — and the
    // build log must say so rather than claiming three cuts.
    const inp = input({ standing: Array.from({ length: 400 }, (_, i) => row(i, 6, 40)) });
    const r = runBudgetLadder(inp);
    expect(r.spent).toEqual(["full"]);
    expect(r.top.length).toBe(12);
  });
});

// ───────────────────────────────────────────────────────── the stress case

describe("the 748-edge stress case", () => {
  test("spends every rung open to it and reports that it is still over", () => {
    const r = runBudgetLadder(hugeWork());
    expect(r.spent).toEqual(["specimen", "once", "full"]);
    expect(r.runCounts).toBe("all");
    expect(r.over).toBe(true);
  });

  test("ships whole rather than withholding rows — every row is still on the page", () => {
    const inp = hugeWork();
    const r = runBudgetLadder(inp);
    expect(r.top.length + r.rest.length).toBe(inp.standing.length);
  });

  test("the ladder is monotone: each rung leaves the estimate no larger", () => {
    const r = runBudgetLadder(hugeWork());
    let last = Number.POSITIVE_INFINITY;
    for (const l of r.log) {
      expect(l.before).toBeLessThanOrEqual(last);
      last = l.after;
    }
  });

  test("a heavy page that the ladder CAN rescue lands under the ceiling", () => {
    // 530 rows across two chapters each: the third rung takes it from over to
    // under, which is the outcome the ladder is for.
    const inp = input({ standing: Array.from({ length: 530 }, (_, i) => row(i, 2, 300)) });
    const r = runBudgetLadder(inp);
    expect(r.spent).toContain("full");
    expect(r.bytes).toBeLessThan(CEILING);
    expect(r.over).toBe(false);
  });
});

// ───────────────────────────────────────────────────────── the last rung

/**
 * Gaius's shape, which is the only page in the library the last rung has
 * ever fired on: 133 sources drawn on repeatedly, 393 named once, and a
 * reading-order movement of 101 chapters in which both kinds stand side by
 * side. The standing rows are the redundant ones — each has an entry or an
 * index line above carrying every chapter it is named in — so their counts
 * in the runs are the third printing of a link already made twice.
 */
function readingHeavyWork(): LadderInput {
  const standing = Array.from({ length: 133 }, (_, i) => row(i, 4, 120));
  const once = Array.from({ length: 393 }, (_, i) => ({ key: `l:o${i}` }));
  return input({
    standing,
    showByChapter: true,
    chapters: Array.from({ length: 101 }, (_, k) => ({
      rows: [...standing.slice(0, 5).map((r) => ({ key: r.key })), ...once.slice(k * 4, k * 4 + 4)],
    })),
  });
}

describe("the reading-order counts", () => {
  test("stand until the ladder has spent everything above them", () => {
    const r = runBudgetLadder(readingHeavyWork());
    expect(r.spent).toEqual(["full", "counts"]);
    expect(r.runCounts).toBe("once-named");
    expect(r.bytes).toBeLessThan(CEILING);
    expect(r.over).toBe(false);
  });

  test("a page that fits keeps every count it composed", () => {
    expect(runBudgetLadder(medianWork()).runCounts).toBe("all");
    const easy = input({
      standing: Array.from({ length: 30 }, (_, i) => row(i, 1)),
      showByChapter: true,
      chapters: Array.from({ length: 4 }, () => ({ rows: [{ key: "l:t0" }, { key: "l:t1" }] })),
    });
    expect(runBudgetLadder(easy).runCounts).toBe("all");
  });

  test("the rung drops no name, no row and no chapter — only a repeated count", () => {
    const inp = readingHeavyWork();
    const r = runBudgetLadder(inp);
    expect(r.top.length + r.rest.length).toBe(inp.standing.length);
    // The movement itself is untouched: the ladder has no dial that can
    // shorten it, because a chapter run is where a once-named source has its
    // only anchor on this page.
    expect(inp.chapters.length).toBe(101);
    expect(inp.chapters.reduce((s, c) => s + c.rows.length, 0)).toBe(101 * 5 + 393);
  });

  test("is not spent when every name in the runs is named once", () => {
    // Nothing in these runs stands anywhere else on the page, so there is no
    // repeated count to give up. The page goes over rather than take an
    // anchor away, and the ladder does not claim a cut it could not make.
    const standing = Array.from({ length: 600 }, (_, i) => row(i, 3, 200));
    const once = Array.from({ length: 400 }, (_, i) => ({ key: `l:o${i}` }));
    const inp = input({
      standing,
      showByChapter: true,
      chapters: Array.from({ length: 40 }, (_, k) => ({ rows: once.slice(k * 10, k * 10 + 10) })),
    });
    const r = runBudgetLadder(inp);
    expect(r.over).toBe(true);
    expect(r.spent).not.toContain("counts");
    expect(r.runCounts).toBe("all");
  });

  test("cannot fire on a work that prints no reading-order movement", () => {
    const r = runBudgetLadder(hugeWork());
    expect(r.spent).not.toContain("counts");
    expect(r.runCounts).toBe("all");
  });
});

// ───────────────────────────────────────────────────────── specimen hygiene

describe("specimens across rungs", () => {
  test("only full entries carry a specimen; the index is never charged for one", () => {
    const inp = input({ standing: Array.from({ length: 60 }, (_, i) => row(i, 1)) });
    const r = runBudgetLadder(inp);
    expect(r.rest.length).toBeGreaterThan(0);
    expect(r.rest.every((x) => x.specimen === undefined)).toBe(true);
  });

  test("a lower rung clears what a higher one attached, since the view is memoized", () => {
    // allocateSpecimens mutates rows that the work view holds for the whole
    // build. Without the clear, the 8 KB rung would inherit the 24 KB rung's
    // specimens and price a page it is not printing.
    const inp = input({ standing: Array.from({ length: 400 }, (_, i) => row(i, 6, 4_000)) });
    const r = runBudgetLadder(inp);
    const spentOnQuotes = r.top.reduce((s, x) => s + (x.specimen?.quote.text.length ?? 0), 0);
    expect(spentOnQuotes).toBeLessThanOrEqual(8_000 + 4_000);
  });

  test("re-running the ladder on the same rows gives the same answer", () => {
    // The page runs once per build, but the rows come out of a memoized view
    // and a second surface may hold the same objects.
    const inp = hugeWork();
    const a = runBudgetLadder(inp);
    const b = runBudgetLadder(inp);
    expect(b.bytes).toBe(a.bytes);
    expect(b.spent).toEqual(a.spent);
    expect(b.top.length).toBe(a.top.length);
  });
});

// ───────────────────────────────────────────────────────── the constants

describe("the fitted constants", () => {
  test("an index line is cheaper than a full entry, or the last rung is pointless", () => {
    expect(COST.indexRow).toBeLessThan(COST.entry);
    expect(COST.indexLocus).toBeLessThan(COST.entryLocus);
  });

  test("an empty page costs only the chrome, compressed", () => {
    expect(runBudgetLadder(input()).bytes).toBe(Math.round(COST.chrome / PACK.chrome));
  });

  test("the ceiling is a gzip figure, not a markup one", () => {
    // The guard against the metric silently reverting. 35,200 bytes of head,
    // nav, fonts and footer sit on every page; as markup that is two thirds
    // of the ceiling, and on the wire it is a seventh of it. A ceiling read
    // against the wrong one of those two numbers is the defect this table
    // was rewritten to close.
    expect(COST.chrome).toBeGreaterThan(CEILING / 2);
    expect(COST.chrome / PACK.chrome).toBeLessThan(CEILING / 5);
  });

  test("every divisor compresses rather than expands", () => {
    for (const [part, d] of Object.entries(PACK)) {
      expect(d).toBeGreaterThan(1);
      expect(`${part} ${d}`).toBeTruthy();
    }
  });

  test("a count link costs more than the name it hangs on", () => {
    // Measured on the build: stripping the count links out of Gaius's
    // reading-order movement took it from 28,952 gzipped bytes to 11,305.
    // The names are three quarters of the elements and 39% of the weight,
    // which is why the last rung is about counts and not about names.
    expect(COST.pairCount / PACK.count).toBeGreaterThan(COST.pair / PACK.chapter);
  });

  test("the inbound direction is priced but never cut", () => {
    const bare = runBudgetLadder(input()).bytes;
    const withInbound = runBudgetLadder(input({ inbound: [row(0, 2, 100)] }));
    expect(withInbound.bytes).toBeGreaterThan(bare);
    expect(withInbound.spent).toEqual([]);
  });

  test("each rung has a build-log label", () => {
    expect(rungLabel("specimen")).toContain("24 KB");
    expect(rungLabel("once")).toContain("200");
    expect(rungLabel("full")).toContain("24 → 12");
    expect(rungLabel("counts")).toContain("anchor");
  });
});
