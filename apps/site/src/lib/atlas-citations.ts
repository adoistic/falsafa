/**
 * atlas-citations — build-time reader for the citation loci layer.
 *
 *   corpus/graph/atlas/citations/index.json          the spine
 *   corpus/graph/atlas/citations/works/<slug>.json   per citing work
 *   corpus/graph/atlas/citations/targets/<file>.json the reverse index
 *
 * Author scope is DERIVED from the work files — no fourth artifact.
 *
 * Graceful-absent, exactly like atlas-graph: artifacts are derived and
 * gitignored. When they are missing every getter returns an empty shape,
 * citationsAvailable() is false, no route is generated, and the site builds.
 *
 * SCOPE NOTE THE UI MUST RESPECT: the harvest records NO locus inside the
 * CITED work — only the passage in the CITING text that does the citing.
 * Nothing here may ever produce "Iliad VI.146"; the data cannot support it.
 *
 * THREE UNITS, AND NO PAGE MAY CONFLATE THEM:
 *   citations — harvest RECORDS. The headline of every row and every total;
 *               the unit the stance maps and the reverse index are keyed in.
 *   passages  — distinct anchored PARAGRAPHS of the citing text. One record's
 *               evidence can quote several, so the two diverge on 5,038 of
 *               13,236 edges. This is what a chapter run adds up to.
 *   anchors   — (source, passage) pairs, used only where a chapter is summed
 *               across several sources. One paragraph naming two sources is
 *               two anchors and one passage, which is why it needs its own
 *               name: 982 of the 2,405 chapters that cite have such a pair.
 *
 * Written pure-first: hydrateEdge, rankRows, splitStandingAndOnce,
 * allocateSpecimens, groupOnceByChapter and indexLetter take plain values
 * plus an injected Deps, so they are testable against fixtures without the
 * ~13 MB of artifacts. The fs wrappers sit on top — the same split
 * works-filter.ts (pure, tested) and corpus.ts (I/O) already use.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ATLAS_ROOT, type Stance } from "./atlas-graph";
import {
  chapterExists,
  chapterNumberOf,
  chapterTitleOf,
  locusLabel,
  bestWorkHref,
} from "./corpus";
import { urlForCitation } from "./citation-url";

// ───────────────────────────────────────────────────────────── artifact types

export type TargetKey = string; // "w:<slug>" | "a:<slug>" | "l:<slug>"
export type TargetKind = "work" | "author" | "label";

export interface CitationQuote {
  p: string;
  text: string;
}

export interface ChapterCitation {
  chapter: string;
  variant: string;
  /** distinct anchored PARAGRAPHS of the citing work in this chapter; the
   *  synthesizer derives it from the array beside it, so `count === p.length`
   *  holds for all 15,252 chapter slots and `p` is uncapped and deduped. */
  count: number;
  p: string[];
  quotes: CitationQuote[];
  hint?: string;
  role?: string;
}

export interface WorkCitationEdge {
  target: TargetKey;
  label: string;
  author_label?: string;
  to_work?: string;
  to_author?: string;
  /** citation RECORDS in the harvest — one per thing the citing text says. */
  count: number;
  /**
   * Distinct anchored PARAGRAPHS across every chapter of this edge. A second
   * unit, not a second spelling of `count`: one record's evidence can quote
   * several paragraphs, so the two diverge on 5,038 of 13,236 edges (Euclid
   * in Proclus: 397 records, 1,326 paragraphs). This is the number the
   * chapter run adds up to — `passages === sum(chapters[].count)` holds for
   * every edge, and no paragraph appears in two chapters of one edge.
   */
  passages: number;
  stances: Partial<Record<Stance, number>>;
  why?: string;
  chapters: ChapterCitation[];
  unanchored: number;
}

export interface WorkCitationsFile {
  version: 1;
  work: string;
  edges: WorkCitationEdge[];
  by_chapter: Record<string, number[]>;
  totals: {
    citations: number;
    /**
     * Sum of edges[].passages, which makes it an ANCHOR total and not a
     * passage total: the edges share one work's paragraphs, so a paragraph
     * naming two sources is counted twice. Measured across the library it is
     * 32,676 against 26,110 distinct (chapter, paragraph) pairs, and the two
     * differ in 299 of the 482 citing works. No page may print it under the
     * word "passages".
     */
    passages: number;
    edges: number;
    targets: number;
    chapters: number;
    stances: Partial<Record<Stance, number>>;
    in_library_works: number;
    in_library_authors: number;
    unresolved: number;
    chapterless: number;
  };
}

export interface CitedByRow {
  from: string;
  from_author?: string;
  count: number;
  /** anchored paragraphs of the citing work; `sum(chapters[].count)` */
  passages: number;
  stances: Partial<Record<Stance, number>>;
  why?: string;
  chapters: { chapter: string; variant: string; count: number; p: string[] }[];
  quote?: (CitationQuote & { chapter: string; variant: string }) | undefined;
}

export interface CitedTargetFile {
  version: 1;
  key: TargetKey;
  kind: TargetKind;
  slug: string;
  label: string;
  author_label?: string;
  to_work?: string;
  to_author?: string;
  total: number;
  /** Sum of by[].passages. A true passage total, unlike the work file's
   *  field of the same name: each `by` row is a different citing work, so
   *  no paragraph can be counted in two of them. */
  passages: number;
  citing_works: number;
  stances: Partial<Record<Stance, number>>;
  by: CitedByRow[];
}

export interface IndexTarget {
  key: TargetKey;
  kind: TargetKind;
  slug: string;
  file?: string;
  label: string;
  author_label?: string;
  to_work?: string;
  to_author?: string;
  total: number;
  /** anchored paragraphs across every work that cites this target */
  passages: number;
  citing_works: number;
  stances: Partial<Record<Stance, number>>;
}

export interface CitationsIndexFile {
  version: 1;
  generated_at: string;
  works: string[];
  targets: IndexTarget[];
  totals: Record<string, number>;
}

// ───────────────────────────────────────────────────────────── view types

/** One chapter of a citing work, hydrated for display. */
export interface Locus {
  chapter: string;
  variant: string;
  /** short citation form for a run: "book 1", "letter 108", "ch. 12" */
  label: string;
  /** the chapter's own title, for section heads */
  title: string;
  /** distinct anchored PARAGRAPHS of this chapter — never citation records.
   *  Off hydrateEdge it equals `anchors.length` by construction, which is
   *  what lets a page print the run and the row total in units that
   *  reconcile. A synthetic Locus standing for a whole work carries no
   *  paragraph run, but still counts in paragraphs. */
  count: number;
  /** cross-page deep link, lighting every anchored paragraph at once */
  href: string | null;
  /** every anchored paragraph id, uncapped — for the reader panel. A caller
   *  that prints one mark per id caps the RENDER, never the list: the list
   *  is what `count` counts, and the two must not drift. */
  anchors: string[];
  quotes: CitationQuote[];
  // explicit `| undefined`: hydrateEdge carries these straight off the
  // artifact, which omits them when the harvest recorded no hint or role,
  // and the root tsconfig runs exactOptionalPropertyTypes.
  hint?: string | undefined;
  role?: string | undefined;
}

export interface CitationRow {
  key: TargetKey;
  label: string;
  author_label?: string | undefined;
  /** roman when the library holds it, italic when it does not */
  inLibrary: boolean;
  href: string | null;
  /** citation RECORDS — the row's headline, and the unit every stance map,
   *  target total and corpus total on this layer is keyed in. */
  count: number;
  /**
   * Anchored PARAGRAPHS actually reachable from this row: the sum of the
   * loci printed beneath it. Derived here rather than copied off the
   * artifact so it cannot drift from the run a reader adds up — a chapter
   * dropped below leaves this figure, and the run, correspondingly shorter.
   */
  passages: number;
  stances: Partial<Record<Stance, number>>;
  why?: string | undefined;
  loci: Locus[];
  /** citation RECORDS the harvest could not place in any chapter */
  lost: number;
  /** anchored paragraphs stranded by a chapter the manifest no longer holds.
   *  A second unit from `lost`, so it is counted apart rather than added to
   *  it; both make the row print "locus not recovered". */
  lostPassages: number;
  /** the specimen, when this row is allowed one by the byte budget */
  specimen?: {
    work: string;
    quote: CitationQuote;
    chapter: string;
    variant: string;
    note?: string | undefined;
  };
}

export interface WorkCitationsView {
  work: string;
  rows: CitationRow[]; // count DESC, in-library first on ties, label ASC
  standing: CitationRow[]; // ≥2 in this work, or in the library
  once: CitationRow[]; // named exactly once and not held
  /**
   * Reading order; each row carries its FULL loci run, so a consumer that
   * wants only this chapter's paragraphs reads `row.loci.find(...)`.
   *
   * `anchors` is a THIRD unit and is named as one: the sum, over the sources
   * in this chapter, of the paragraphs anchored to each. It is not a count
   * of the chapter's paragraphs — one paragraph may name two sources, and
   * 982 of the 2,405 chapters that cite have at least one that does — but it
   * is exactly the figure the run of superscripts beneath it adds up to.
   */
  chapters: { chapter: string; title: string; anchors: number; rows: CitationRow[] }[];
  /** `lost` and `lostPassages` are summed apart for the same reason they are
   *  kept apart on a row: records and paragraphs do not add. */
  totals: WorkCitationsFile["totals"] & { lost: number; lostPassages: number };
}

// ───────────────────────────────────────────────────────────── loaders

function readJSON<T>(rel: string): T | null {
  const p = join(ATLAS_ROOT, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

let _index: CitationsIndexFile | null | undefined;
/** The spine. Lazy-memoized, mirroring atlasMeta() in atlas-graph.ts. */
export function citationsIndex(): CitationsIndexFile | null {
  if (_index === undefined) _index = readJSON<CitationsIndexFile>("citations/index.json");
  return _index;
}

export function citationsAvailable(): boolean {
  return citationsIndex() !== null;
}

const _workFiles = new Map<string, WorkCitationsFile | null>();
/** Raw per-work artifact. Memoized per slug; ~482 files, loaded on demand. */
export function workCitationsFile(slug: string): WorkCitationsFile | null {
  if (!_workFiles.has(slug))
    _workFiles.set(slug, readJSON<WorkCitationsFile>(join("citations", "works", `${slug}.json`)));
  return _workFiles.get(slug)!;
}

let _targetsByKey: Map<TargetKey, IndexTarget> | undefined;
export function targetIndexRow(key: TargetKey): IndexTarget | null {
  if (_targetsByKey === undefined)
    _targetsByKey = new Map((citationsIndex()?.targets ?? []).map((t) => [t.key, t]));
  return _targetsByKey.get(key) ?? null;
}

const _targetFiles = new Map<TargetKey, CitedTargetFile | null>();
/** Raw reverse-index artifact for one page-worthy target. */
export function citedTargetFile(key: TargetKey): CitedTargetFile | null {
  if (!_targetFiles.has(key)) {
    const row = targetIndexRow(key);
    _targetFiles.set(
      key,
      row?.file ? readJSON<CitedTargetFile>(join("citations", "targets", `${row.file}.json`)) : null,
    );
  }
  return _targetFiles.get(key)!;
}

// ───────────────────────────────────────────────────────────── getStaticPaths gates

let _citing: Set<string> | undefined;
/** Work slugs that cite something (have a works/<slug>.json). */
export function citingWorkSlugs(): Set<string> {
  if (_citing === undefined) _citing = new Set(citationsIndex()?.works ?? []);
  return _citing;
}

let _citedW: Set<string> | undefined;
/** In-corpus work slugs that RECEIVE citations. */
export function citedWorkSlugs(): Set<string> {
  if (_citedW === undefined)
    _citedW = new Set(
      (citationsIndex()?.targets ?? []).filter((t) => t.to_work).map((t) => t.to_work!),
    );
  return _citedW;
}

let _citedA: Set<string> | undefined;
/** In-corpus author slugs that RECEIVE citations. */
export function citedAuthorSlugs(): Set<string> {
  if (_citedA === undefined)
    _citedA = new Set(
      (citationsIndex()?.targets ?? []).filter((t) => t.to_author).map((t) => t.to_author!),
    );
  return _citedA;
}

/** Out-of-corpus labels that earned a page (≥2 distinct citing works). */
export function wantedTargets(): IndexTarget[] {
  return (citationsIndex()?.targets ?? []).filter((t) => t.kind === "label" && t.file);
}

// ───────────────────────────────────────────────────────────── link resolution

/**
 * Canonical destination for a citation target, in resolution order:
 *   in-corpus work   → /works/<slug>/citations/#cited-by
 *   in-corpus author → /authors/<slug>/citations/#cited-by
 *   paged label      → /atlas/citations/<slug>/
 *   otherwise        → null (render in italic, unlinked)
 */
export function targetHref(t: {
  target?: TargetKey;
  key?: TargetKey;
  to_work?: string;
  to_author?: string;
}): string | null {
  if (t.to_work) return `/works/${t.to_work}/citations/#cited-by`;
  if (t.to_author) return `/authors/${t.to_author}/citations/#cited-by`;
  const key = t.target ?? t.key;
  const row = key ? targetIndexRow(key) : null;
  return row?.kind === "label" && row.file ? `/atlas/citations/${row.slug}/` : null;
}

/** A stable in-page id for one citation row: "t-w-homer-iliad-056ee9". */
export function targetAnchor(key: TargetKey): string {
  return `t-${key.replace(":", "-")}`;
}

// ───────────────────────────────────────────────────────────── pure aggregation

export interface Deps {
  exists: (work: string, chapter: string) => boolean;
  order: (work: string, chapter: string) => number;
  short: (work: string, chapter: string) => string;
  title: (work: string, chapter: string) => string | null;
  href: (work: string, chapter: string, variant: string, ps: string[]) => string | null;
}

/** Production wiring of Deps — injected so the pure folds stay testable. */
export const liveDeps: Deps = {
  exists: chapterExists,
  order: chapterNumberOf,
  short: locusLabel,
  title: chapterTitleOf,
  href: (work, chapterSlug, variant, ps) => {
    const base = bestWorkHref(work, chapterSlug, variant);
    if (!base) return null;
    // The anchors are only meaningful on the exact chapter page they were
    // harvested from; a degraded fallback drops them.
    if (base !== `/works/${work}/${chapterSlug}/${variant}/`) return base;
    // Uncapped, so the link lights exactly the number printed beside it. The
    // old 24-id cap made a superscript of 438 open a page showing 24; the
    // whole tail costs 2,455 ids over 73 of 15,252 chapter slots — about
    // 22 KB of URL text across the site, which buys an exact link.
    return urlForCitation({ workSlug: work, chapterSlug, variant, paragraphIds: ps });
  },
};

/**
 * Hydrate one artifact edge into a display row.
 *
 * Chapters that no longer exist in the manifest are DROPPED — never rendered
 * as a phantom heading. Their anchored paragraphs are counted in
 * `lostPassages` rather than added to `lost`: `lost` is a tally of citation
 * RECORDS and the two units do not sum. The harvest predates the next
 * re-split, so the guard has to stand even though it drops nothing today
 * (0 of 2,405 (work, chapter) pairs are dead).
 *
 * `passages` is summed from the loci that survive that guard, not read off
 * `e.passages`, so the figure a row prints is by construction the figure its
 * own run adds up to.
 */
export function hydrateEdge(work: string, e: WorkCitationEdge, d: Deps): CitationRow {
  let lostPassages = 0;
  let passages = 0;
  const loci: Locus[] = [];
  for (const ch of e.chapters) {
    if (!d.exists(work, ch.chapter)) {
      lostPassages += ch.count;
      continue;
    }
    passages += ch.count;
    loci.push({
      chapter: ch.chapter,
      variant: ch.variant,
      label: d.short(work, ch.chapter),
      title: d.title(work, ch.chapter) ?? d.short(work, ch.chapter),
      count: ch.count,
      href: d.href(work, ch.chapter, ch.variant, ch.p),
      anchors: ch.p,
      quotes: ch.quotes,
      hint: ch.hint,
      role: ch.role,
    });
  }
  loci.sort((a, b) => d.order(work, a.chapter) - d.order(work, b.chapter));
  return {
    key: e.target,
    label: e.label,
    author_label: e.author_label,
    inLibrary: Boolean(e.to_work || e.to_author),
    href: targetHref(e),
    count: e.count,
    passages,
    // copied, not aliased: the artifact object behind `e` is memoized for
    // the whole build and the author fold accumulates into stance maps.
    stances: { ...e.stances },
    why: e.why,
    loci,
    lost: e.unanchored,
    lostPassages,
  };
}

/** count DESC → in-library before wanted on ties → label ASC. Deterministic. */
export function rankRows(rows: CitationRow[]): CitationRow[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(b.inLibrary) - Number(a.inLibrary) ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
    );
}

/**
 * The editorial fold, not a cap: a target earns a full entry when it is
 * cited twice or more, or the library holds it. Everything else was named
 * once and belongs in the chapter-grouped run. 79.5% of all edges are a
 * once-named target the library does not hold — a ledger row for each is
 * not apparatus, it is noise.
 */
export function splitStandingAndOnce(rows: CitationRow[]): [CitationRow[], CitationRow[]] {
  const standing: CitationRow[] = [],
    once: CitationRow[] = [];
  for (const r of rows) (r.count >= 2 || r.inLibrary ? standing : once).push(r);
  return [standing, once];
}

/**
 * Attach specimens by BYTE BUDGET, not by row count. Walks rows in rank
 * order, taking each row's best quote (from its densest chapter) until
 * `budget` bytes of quote text are spent. The distribution is p50=8 edges,
 * max=748: a fixed row cap would starve the median work and still blow up
 * the tail. Mutates and returns `rows`.
 */
export function allocateSpecimens(
  work: string,
  rows: CitationRow[],
  budget = 24_000,
): CitationRow[] {
  let spent = 0;
  for (const r of rows) {
    if (spent >= budget) break;
    const best = r.loci.slice().sort((a, b) => b.count - a.count)[0];
    // a sub-70-character quote is an OCR fragment, not a specimen; take it
    // only when the locus has nothing longer to offer.
    const q = best?.quotes.find((x) => x.text.length >= 70) ?? best?.quotes[0];
    if (!best || !q) continue;
    r.specimen = {
      work,
      quote: q,
      chapter: best.chapter,
      variant: best.variant,
      note: best.role ?? best.hint,
    };
    spent += q.text.length;
  }
  return rows;
}

/** The once-named tail, grouped by the chapter that names them. */
export function groupOnceByChapter(
  once: CitationRow[],
): { chapter: string; label: string; href: string | null; names: CitationRow[] }[] {
  const m = new Map<string, { chapter: string; label: string; href: string | null; names: CitationRow[] }>();
  for (const r of once) {
    const l = r.loci[0];
    const key = l?.chapter ?? "";
    const g = m.get(key) ?? { chapter: key, label: l?.label ?? "", href: l?.href ?? null, names: [] };
    g.names.push(r);
    m.set(key, g);
  }
  return [...m.values()];
}

/** Index bucket letter, leading articles stripped: "The Federalist" → F. */
export function indexLetter(label: string): string {
  const s = label.replace(/^(the|a|an|de|la|le|el|il)\s+/i, "").trim();
  const c = s[0]?.toUpperCase() ?? "—";
  return /[A-Z]/.test(c) ? c : "—";
}

// ───────────────────────────────────────────────────────────── scope selectors

const _workViews = new Map<string, WorkCitationsView | null>();

/** WORK SCOPE — what this book cites, arranged both ways. */
export function workCitations(slug: string, d: Deps = liveDeps): WorkCitationsView | null {
  // Only the production wiring is memoized: a test that injects fixture
  // Deps must not be served a view hydrated against the real corpus.
  const memo = d === liveDeps;
  if (memo && _workViews.has(slug)) return _workViews.get(slug)!;
  const f = workCitationsFile(slug);
  if (!f) {
    if (memo) _workViews.set(slug, null);
    return null;
  }
  const rows = rankRows(f.edges.map((e) => hydrateEdge(slug, e, d)));
  const [standing, once] = splitStandingAndOnce(rows);
  // by-chapter arrangement: reading order, targets ranked within a chapter
  const chMap = new Map<string, CitationRow[]>();
  for (const r of rows)
    for (const l of r.loci) {
      const bucket = chMap.get(l.chapter);
      if (bucket) bucket.push(r);
      else chMap.set(l.chapter, [r]);
    }
  const chapters = [...chMap.entries()]
    .sort((a, b) => d.order(slug, a[0]) - d.order(slug, b[0]))
    .map(([chapter, rs]) => ({
      chapter,
      title: d.title(slug, chapter) ?? d.short(slug, chapter),
      anchors: rs.reduce((s, r) => s + (r.loci.find((l) => l.chapter === chapter)?.count ?? 0), 0),
      rows: rankRows(rs),
    }));
  const view: WorkCitationsView = {
    work: slug,
    rows,
    standing,
    once,
    chapters,
    totals: {
      ...f.totals,
      lost: rows.reduce((s, r) => s + r.lost, 0),
      lostPassages: rows.reduce((s, r) => s + r.lostPassages, 0),
    },
  };
  if (memo) _workViews.set(slug, view);
  return view;
}

/** CHAPTER SCOPE — the rows that fire in one chapter, for the reader panel. */
export function chapterCitations(work: string, chapter: string, d: Deps = liveDeps): CitationRow[] {
  const v = workCitations(work, d);
  if (!v) return [];
  return v.chapters.find((c) => c.chapter === chapter)?.rows ?? [];
}

/** REVERSE, WORK — who cites this book. */
export function workCitedBy(slug: string): CitedTargetFile | null {
  return citedTargetFile(`w:${slug}`);
}

/** REVERSE, AUTHOR — merges citations aimed at the author's NAME with those
 *  aimed at any of the author's in-corpus WORKS. Homer's page must show the
 *  262 citations of "Homer" and the 45 of the Iliad in one view. */
export function authorCitedBy(
  authorSlug: string,
  authorWorkSlugs: string[],
): {
  total: number;
  /** anchored paragraphs, deduped across the merged files — see below */
  passages: number;
  citingWorks: number;
  stances: Partial<Record<Stance, number>>;
  by: (CitedByRow & { via: string[] })[];
} | null {
  const files = [
    citedTargetFile(`a:${authorSlug}`),
    ...authorWorkSlugs.map((w) => citedTargetFile(`w:${w}`)),
  ].filter((f): f is CitedTargetFile => f !== null);
  if (files.length === 0) return null;
  const merged = new Map<string, CitedByRow & { via: string[] }>();
  const stances: Partial<Record<Stance, number>> = {};
  let total = 0;
  for (const f of files) {
    for (const [s, n] of Object.entries(f.stances))
      stances[s as Stance] = (stances[s as Stance] ?? 0) + (n ?? 0);
    total += f.total;
    for (const r of f.by) {
      let cur = merged.get(r.from);
      if (!cur) {
        // deep enough to own every field this fold adds into: the artifact
        // behind `r` is memoized for the whole build, and Homer's name file
        // and Iliad file both contribute to the same citing work.
        cur = {
          ...r,
          stances: { ...r.stances },
          // `p` is copied, not aliased: the union below pushes into it and
          // the array behind it belongs to an artifact memoized for the
          // whole build, read again by every other page that cites this work.
          chapters: r.chapters.map((ch) => ({ ...ch, p: [...ch.p] })),
          via: [],
        };
        merged.set(r.from, cur);
      } else {
        cur.count += r.count;
        for (const [s, n] of Object.entries(r.stances))
          cur.stances[s as Stance] = (cur.stances[s as Stance] ?? 0) + (n ?? 0);
        for (const ch of r.chapters) {
          const slot: CitedByRow["chapters"][number] | undefined = cur.chapters.find(
            (x) => x.chapter === ch.chapter,
          );
          // Paragraph ids are UNIONED, not added. The files merged here are
          // views of one author — "Homer", the Iliad, the Odyssey — and a
          // single paragraph of Aristotle can name two of them, so adding
          // the slot sizes would count that paragraph twice and the run
          // would out-total the passages the reader can actually open.
          if (slot) {
            const seen = new Set(slot.p);
            for (const id of ch.p)
              if (!seen.has(id)) {
                seen.add(id);
                slot.p.push(id);
              }
            slot.count = slot.p.length;
          } else cur.chapters.push({ ...ch, p: [...ch.p] });
        }
        if (!cur.quote) cur.quote = r.quote;
      }
      cur.via.push(f.label);
    }
  }
  // Re-derived after the union rather than summed off the artifact rows, for
  // the same reason: only the merged chapter run knows what overlapped.
  for (const r of merged.values()) r.passages = r.chapters.reduce((s, ch) => s + ch.count, 0);
  const by = [...merged.values()].sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1));
  const passages = by.reduce((s, r) => s + r.passages, 0);
  return { total, passages, citingWorks: by.length, stances, by };
}

/** AUTHOR SCOPE, OUT — "across the works, whom has this author cited?"
 *  Derived by unioning the author's works' files. Worst case today is
 *  Demosthenes at 62 files; each is memoized and most are already loaded. */
export interface AuthorTargetRow {
  key: TargetKey;
  label: string;
  author_label?: string;
  inLibrary: boolean;
  href: string | null;
  /** citation RECORDS across every work of the author's */
  total: number;
  /** anchored paragraphs across those same works. Safe to add across works:
   *  a paragraph belongs to exactly one of them. */
  passages: number;
  stances: Partial<Record<Stance, number>>;
  works: { work: string; count: number; passages: number; loci: Locus[] }[]; // count DESC
  specimen?: { work: string; quote: CitationQuote; chapter: string };
}

export function authorCitationsOut(
  authorWorkSlugs: string[],
  d: Deps = liveDeps,
): {
  targets: AuthorTargetRow[];
  standing: AuthorTargetRow[];
  once: AuthorTargetRow[];
  totals: {
    citations: number;
    /** ANCHORS, not passages: summed over every target of every work, so a
     *  paragraph naming two sources lands in it twice. */
    anchors: number;
    targets: number;
    works: number;
    stances: Partial<Record<Stance, number>>;
  };
} | null {
  const views = authorWorkSlugs
    .map((w) => workCitations(w, d))
    .filter((v): v is WorkCitationsView => v !== null);
  if (views.length === 0) return null;
  const m = new Map<TargetKey, AuthorTargetRow>();
  const stances: Partial<Record<Stance, number>> = {};
  let citations = 0;
  let anchors = 0;
  for (const v of views) {
    for (const r of v.rows) {
      citations += r.count;
      anchors += r.passages;
      for (const [s, n] of Object.entries(r.stances))
        stances[s as Stance] = (stances[s as Stance] ?? 0) + (n ?? 0);
      const t =
        m.get(r.key) ??
        ({
          key: r.key,
          label: r.label,
          author_label: r.author_label,
          inLibrary: r.inLibrary,
          href: r.href,
          total: 0,
          passages: 0,
          stances: {},
          works: [],
        } as AuthorTargetRow);
      t.total += r.count;
      t.passages += r.passages;
      for (const [s, n] of Object.entries(r.stances))
        t.stances[s as Stance] = (t.stances[s as Stance] ?? 0) + (n ?? 0);
      t.works.push({ work: v.work, count: r.count, passages: r.passages, loci: r.loci });
      m.set(r.key, t);
    }
  }
  const targets = [...m.values()].sort(
    (a, b) => b.works.length - a.works.length || b.total - a.total || (a.label < b.label ? -1 : 1),
  );
  for (const t of targets) t.works.sort((a, b) => b.count - a.count);
  // an author's canon vs his incidental references
  const held = (t: AuthorTargetRow) => t.works.length >= 2 || t.total >= 3 || t.inLibrary;
  const standing = targets.filter(held);
  const once = targets.filter((t) => !held(t));
  return {
    targets,
    standing,
    once,
    totals: { citations, anchors, targets: targets.length, works: views.length, stances },
  };
}
