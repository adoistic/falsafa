/**
 * citation-budget — how much apparatus one citations page may print.
 *
 * The distribution the page has to survive is p50 = 8 edges and max = 748,
 * on works whose chapter counts run from 1 to 124. A fixed row cap starves
 * the median work and still blows up the tail, so the page composes what it
 * wants, ESTIMATES the bytes, and steps down a ladder of named cuts until
 * it is under the ceiling or the ladder is spent.
 *
 * THE METRIC IS THE WIRE, NOT THE MARKUP. The first ceiling here was
 * 160,000 bytes of un-compressed <article>, and it was pricing something no
 * reader pays for. The Worker hands R2 bytes to Cloudflare, which
 * compresses every text/html response at the edge; `curl -I` on a live page
 * comes back `content-encoding: br`. Across the 594 built pages the
 * markup-to-gzip ratio runs from 2.6:1 on a run of proper names to 11.5:1
 * on a superscript count carrying a paragraph-anchored href, so a markup
 * ceiling cuts hardest exactly where the wire cost is lowest: it spent the
 * whole ladder on twelve pages, of which one was genuinely heavy.
 *
 * So COST prices the markup, PACK converts each part of it to the wire, and
 * CEILING is a gzip figure. Both tables were refitted by least squares
 * against all 594 emitted pages rather than the six the first version used;
 * against the same build the estimate now reads +4.4% at the median, +0.1%
 * at p10 and +9.6% at p90, and it agreed with `gzip -9` on every one of the
 * 594 pages about which side of the ceiling they fall.
 *
 * Lives here rather than in the page's frontmatter so the ladder can be
 * tested against synthetic works at both ends of that distribution.
 */

import { allocateSpecimens, type CitationRow } from "./atlas-citations";

/**
 * The budget for one served page, in gzipped bytes.
 *
 * Set from the floor of the heaviest apparatus in the library rather than
 * from a round number. Gaius names 133 sources it draws on repeatedly and
 * 393 it names once; printing all of them with every locus linked, twelve
 * specimens, and no per-chapter count the index above already carries costs
 * 52 KB gzipped and cannot cost less without withholding a source, a locus
 * or an anchor. A ceiling under that floor is a rule the page could only
 * keep by breaking the rule above it, so the ceiling is the floor plus the
 * margin the estimate errs high by at this end, which is 3–21%.
 *
 * For scale: the median citations page is 9,460 bytes gzipped and the
 * median page of reading in this library is 9,805, so the ceiling is a
 * weight no page but Gaius has ever come near. It is a guard on the tail
 * and on corpus growth, not a rule the common page has to live under.
 *
 * gzip rather than brotli, which is what most readers actually get — Gaius
 * is 39,897 under brotli — because gzip is the floor of what any client is
 * guaranteed, and the ceiling should bind on the worse case.
 */
export const CEILING = 56_000;

/**
 * Markup bytes. Refitted by least squares against the 594 emitted pages:
 * each movement's real byte count regressed on the counts the page fed it,
 * with an intercept for the movement's own running head and note.
 */
export const COST = {
  /** everything outside <article>, plus the masthead: head, nav, fonts,
   *  JSON-LD, footer. Measured at 35,225 bytes on every one of the 594
   *  pages, where the first version charged 5,000 and so under-priced the
   *  one part of the page that is on all of them. */
  chrome: 35_200,
  /** a running head and the note under it, charged once per movement */
  movement: 1_800,
  entry: 880,
  entryLocus: 340,
  specimen: 435,
  indexRow: 355,
  indexLocus: 270,
  name: 55,
  chapHead: 415,
  /** a name and its link in a reading-order run */
  pair: 57,
  /** the superscript count beside that name, and the paragraph-anchored
   *  href behind it. Three times the name it hangs on, which is why the
   *  last rung is about counts and not about names. */
  pairCount: 189,
  inEntry: 1_305,
  inLocus: 335,
} as const;

/**
 * Markup → gzip, one divisor per kind of markup, measured on the real build
 * as raw bytes over gzipped bytes. The heavy pages are the sample where
 * there are enough of them, because they are the only pages the ceiling
 * binds on and a movement compresses better the more of it there is: the
 * entries block runs 5.66 over all 482 pages that have one and 7.62 over
 * the 45 heavy ones. Where the heavy sample is too thin to trust — one page
 * for `once`, twelve for `inbound` — the all-pages figure is used instead,
 * which prices those movements high.
 *
 * The split between `chapter` and `count` is the one that matters. Stripping
 * the count links out of Gaius's reading-order movement and re-compressing
 * it takes 28,952 gzipped bytes to 11,305: the names are 39% of that
 * movement on the wire and the counts are 61%, though the names are three
 * quarters of the elements. Fitted: 4.28 / 7.62 / 11.03 / 5.80 / 11.46 /
 * 2.62 / 4.14.
 */
export const PACK = {
  chrome: 4.2,
  /** the full entries: heading, loci, and the verbatim specimen under them */
  entry: 7.4,
  /** the index of sources — a page of hrefs sharing one long prefix */
  index: 11.0,
  /** the reading-order runs, once their count links are taken out */
  chapter: 5.8,
  /** a count link: the most repetitive markup on the page */
  count: 11.0,
  /** runs of proper names, which is the least compressible thing here */
  once: 2.6,
  /** the inbound entries, each carrying a quotation from the citing work */
  inbound: 5.5,
} as const;

/** The rungs, in the order they are spent. `counts` is the last resort. */
export type Rung = "specimen" | "once" | "full" | "counts";

/** A row in a reading-order run, identified so the ladder can tell whether
 *  it also stands in the index above. */
export interface RunRow {
  key: string;
}

export interface LadderInput {
  /** the work these rows belong to — specimens carry it for their link */
  work: string;
  /** ranked outbound rows that earn a full entry or an index line */
  standing: CitationRow[];
  /** the once-named tail, already grouped by the chapter that names it */
  onceGroups: { names: CitationRow[] }[];
  /** whether the `named once` list is printed at all */
  showNamedOnce: boolean;
  /** once-named rows with no recovered locus; always printed, never capped */
  orphanOnce: CitationRow[];
  /** the reading-order movement, when it is printed */
  chapters: { rows: RunRow[] }[];
  showByChapter: boolean;
  /** inbound rows, printed whole or not at all */
  inbound: CitationRow[];
}

/** Which names in a reading-order run keep the count beside them. */
export type RunCounts = "all" | "once-named";

export interface LadderResult {
  /** rows that get a full entry with loci and a specimen */
  top: CitationRow[];
  /** rows that get an index line */
  rest: CitationRow[];
  /** the final estimate, in gzipped bytes */
  bytes: number;
  /** the cap the `named once` runs are printed under — Infinity until the
   *  second rung is spent. The page truncates with this, so it is a
   *  rendering dial as much as a pricing one. */
  onceCap: number;
  /** "all" until the last rung is spent. Same contract as onceCap: the page
   *  renders under it and must say in print that it did. */
  runCounts: RunCounts;
  /** rungs spent, in order — empty when the page fitted as composed */
  spent: Rung[];
  /** true when the ladder ran out and the page ships over the ceiling */
  over: boolean;
  /** what each spent rung bought, for the build log */
  log: { rung: Rung; before: number; after: number }[];
}

/**
 * Everything the ladder cannot move: the chrome is on every page, and the
 * inbound entries are printed whole or not at all because for a work with
 * no outbound harvest they are the only thing it has to show.
 */
function fixedCost(inp: LadderInput): number {
  if (inp.inbound.length === 0) return COST.chrome / PACK.chrome;
  return (
    COST.chrome / PACK.chrome +
    (COST.movement +
      inp.inbound.length * COST.inEntry +
      inp.inbound.reduce(
        (s, r) => s + r.loci.length * COST.inLocus + (r.specimen?.quote.text.length ?? 0),
        0,
      )) /
      PACK.inbound
  );
}

/**
 * The reading-order movement. Its names are fixed; only the counts beside
 * them are a dial, and they are 61% of what the movement costs on the wire.
 */
function chapterCost(inp: LadderInput, runCounts: RunCounts): number {
  if (!inp.showByChapter) return 0;
  const standing = new Set(inp.standing.map((r) => r.key));
  let pairs = 0;
  let counted = 0;
  for (const c of inp.chapters)
    for (const r of c.rows) {
      pairs++;
      if (runCounts === "all" || !standing.has(r.key)) counted++;
    }
  return (
    (COST.movement + inp.chapters.length * COST.chapHead + pairs * COST.pair) / PACK.chapter +
    (counted * COST.pairCount) / PACK.count
  );
}

/**
 * Compose the page at one setting of the four dials and price it.
 * allocateSpecimens mutates, and the work view is memoized for the whole
 * build, so a lower rung must first clear what a higher one attached.
 */
function compose(
  inp: LadderInput,
  fixed: number,
  specimenBudget: number,
  onceCap: number,
  topCount: number,
  runCounts: RunCounts,
): { top: CitationRow[]; rest: CitationRow[]; bytes: number } {
  for (const r of inp.standing) delete r.specimen;
  allocateSpecimens(inp.work, inp.standing, specimenBudget);
  const top = inp.standing.slice(0, topCount);
  const rest = inp.standing.slice(topCount);
  const bytes =
    fixed +
    chapterCost(inp, runCounts) +
    (top.length === 0
      ? 0
      : COST.movement +
        top.length * COST.entry +
        top.reduce((s, r) => s + r.loci.length * COST.entryLocus, 0) +
        top.reduce(
          (s, r) => s + (r.specimen ? COST.specimen + r.specimen.quote.text.length : 0),
          0,
        )) /
      PACK.entry +
    (rest.length === 0
      ? 0
      : COST.movement +
        rest.length * COST.indexRow +
        rest.reduce((s, r) => s + r.loci.length * COST.indexLocus, 0)) /
      PACK.index +
    ((inp.showNamedOnce && inp.onceGroups.length > 0
      ? COST.movement +
        inp.onceGroups.reduce((s, g) => s + Math.min(g.names.length, onceCap) * COST.name, 0)
      : 0) +
      (inp.orphanOnce.length > 0 ? COST.movement + inp.orphanOnce.length * COST.name : 0)) /
      PACK.once;
  return { top, rest, bytes: Math.round(bytes) };
}

/**
 * Run the ladder. The four rungs, in order:
 *
 *   1. specimen budget 24 KB → 8 KB — tail protection; it rarely binds
 *      inside the first 24 rows, so on most large works it buys nothing
 *   2. named-once runs capped at 200 per chapter
 *   3. full entries 24 → 12 — twelve sources lose their quotation and drop
 *      to an index line that still carries every locus
 *   4. the reading-order runs stop counting the sources that stand in the
 *      index above
 *
 * The last rung is the only cut here that withholds no apparatus. #cites and
 * #by-chapter are two arrangements of the same edges: a source cited twice
 * or more, or held by the library, has a full entry or an index line above
 * with every chapter it is named in, linked. Printing the count again beside
 * its name in each chapter run is the third printing of a link the page has
 * already made twice, and on Gaius it is 61% of that movement's wire weight.
 * A source named once has no entry and no index line, so its count in the
 * run is the only anchor the page gives it, and it keeps it.
 *
 * A rung that does not move the estimate is not reported as spent, because
 * announcing a cut that was not made is a false report. When all four are
 * spent and the page is still over, it ships whole: the alternative is
 * withholding apparatus, and a citation number with no way to reach its
 * passages is the one thing this feature may not do.
 */
export function runBudgetLadder(inp: LadderInput): LadderResult {
  const fixed = fixedCost(inp);
  const INF = Number.POSITIVE_INFINITY;
  const rungs: { rung: Rung; specimen: number; once: number; top: number }[] = [
    { rung: "specimen", specimen: 8_000, once: INF, top: 24 },
    { rung: "once", specimen: 8_000, once: 200, top: 24 },
    { rung: "full", specimen: 8_000, once: 200, top: 12 },
  ];

  let comp = compose(inp, fixed, 24_000, INF, 24, "all");
  let onceCap = INF;
  let runCounts: RunCounts = "all";
  const spent: Rung[] = [];
  const log: { rung: Rung; before: number; after: number }[] = [];

  for (const r of rungs) {
    if (comp.bytes <= CEILING) break;
    const before = comp.bytes;
    comp = compose(inp, fixed, r.specimen, r.once, r.top, runCounts);
    onceCap = r.once;
    if (comp.bytes < before) {
      spent.push(r.rung);
      log.push({ rung: r.rung, before, after: comp.bytes });
    }
  }

  if (comp.bytes > CEILING && inp.showByChapter) {
    const before = comp.bytes;
    const cut = compose(inp, fixed, 8_000, onceCap, comp.top.length, "once-named");
    if (cut.bytes < before) {
      runCounts = "once-named";
      comp = cut;
      spent.push("counts");
      log.push({ rung: "counts", before, after: comp.bytes });
    }
  }

  // Specimens are allocated over the whole standing set; only the full
  // entries print one, and the index must not be charged for the rest.
  for (const r of comp.rest) delete r.specimen;

  return { ...comp, onceCap, runCounts, spent, over: comp.bytes > CEILING, log };
}

/** The build-log line for one spent rung, in kilobytes where it has one. */
export function rungLabel(rung: Rung): string {
  return rung === "specimen"
    ? "specimen budget 24 KB → 8 KB"
    : rung === "once"
      ? "named-once runs capped at 200 per chapter"
      : rung === "full"
        ? "full entries 24 → 12"
        : "reading-order counts kept only where they are the only anchor";
}
