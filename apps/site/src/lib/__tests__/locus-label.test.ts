// apps/site/src/lib/__tests__/locus-label.test.ts
//
// A locus label is the shortest true name for a chapter: what an apparatus
// prints in a run of six, where "book 1 · book 2 · book 5" has to fit on a
// line. Before these helpers existed the atlas printed raw slugs — the live
// defect was `capvt viii iure gentium inter quosvis liberam esse ¶` standing
// in for a chapter label — so the assertion that matters most here is the
// negative one: a known chapter never comes back as its slug.
//
// These read the shipped corpus, so they are assertions about the data as
// much as about the code, in the same spirit as sitemap-exclude.test.ts.
//
// Run from apps/site/src, never apps/site: a bare `bun test` there walks the
// 120k-file public/corpus symlink into EMFILE.

import { describe, expect, test } from "bun:test";
import { citingWorkSlugs, workCitationsFile } from "../atlas-citations";
import {
  chapterNumberOf,
  chapterTitleOf,
  isSingleChapterWork,
  listChapters,
  locusLabel,
  workEntryHref,
  workEntryLabel,
} from "../corpus";

/** Clement cites across BOOKS; Seneca across LETTERS; Grotius numbers only. */
const CLEMENT = "clement-of-alexandria-stromata-694383";
const SENECA = "seneca-lucius-annaeus-letters-to-lucilius-bc8c6e";
const GROTIUS = "hugo-grotius-the-rights-of-war-and-peace-0db900";
/** The work that produced the defect: chapters titled "Capvt VIII", ordered
 *  by file position, so the intrinsic numbering and the locus disagree. */
const MARE = "hugo-grotius-the-freedom-of-the-seas-mare-lib-244ad7";
const MARE_CH = "12-capvt-viii-iure-gentium-inter-quosvis-liberam-esse";
/** One chapter, and that chapter's title is the work's own title. */
const CROWN = "demosthenes-on-the-crown-6f92d0";

describe("locusLabel on a numbered chapter", () => {
  test("reads a book off the slug, without the file-position prefix", () => {
    expect(locusLabel(CLEMENT, "01-book-1")).toBe("book 1");
    expect(locusLabel(CLEMENT, "08-book-8")).toBe("book 8");
  });

  test("keeps the work's own unit — Seneca cites in letters, not chapters", () => {
    expect(locusLabel(SENECA, "07-letter-7")).toBe("letter 7");
    expect(locusLabel(SENECA, "108-letter-108")).toBe("letter 108");
  });

  test("a bare numeric slug with a meta behind it becomes a chapter number", () => {
    expect(locusLabel(GROTIUS, "09")).toBe("ch. 9");
    expect(locusLabel(GROTIUS, "12")).toBe("ch. 12");
  });
});

describe("locusLabel on a titled chapter", () => {
  test("a short title comes through lowercased, because it fits a run", () => {
    expect(locusLabel(CROWN, "01-on-the-crown")).toBe("on the crown");
  });

  test("a long title falls back to a chapter number, never the slug", () => {
    // The live defect, pinned. "Capvt VIII" is the twelfth chapter in reading
    // order, so the locus reads "ch. 12" — correct as a POSITION, which is
    // what a locus is. The intrinsic numbering is the chapter's own title and
    // is printed wherever there is room for it.
    expect(chapterTitleOf(MARE, MARE_CH)).toBe(
      "Capvt VIII: Iure gentium inter quosvis liberam esse mercaturam",
    );
    expect(locusLabel(MARE, MARE_CH)).toBe("ch. 12");
    expect(locusLabel(MARE, MARE_CH)).not.toContain("capvt viii iure gentium");
  });

  test("an unknown chapter degrades to its leading number, or to prose, not a crash", () => {
    // A chapter that drifted out of the manifest is normally dropped by
    // hydrateEdge, but locusLabel is called from places that have no such
    // guard, so it has to answer for anything.
    expect(locusLabel(CLEMENT, "99-not-a-chapter")).toBe("ch. 99");
    expect(locusLabel(CLEMENT, "not-a-chapter-at-all")).toBe("not a chapter at all");
  });
});

describe("locusLabel across every chapter a citation actually names", () => {
  // The apparatus prints one of these beside every citation count on the
  // site, so a single slug leaking through is a visible defect on a live
  // page. The sweep is over all 2,405 (work, chapter) pairs the harvest
  // names, not a sample, and it costs about 120 ms.
  const NUMBERED = /^[a-z]+ (\d+|[ivxlcdm]+)$/;
  const CHAPTER_NO = /^ch\. \d+$/;

  const sweep = () => {
    const bad: string[] = [];
    let seen = 0;
    let longest = 0;
    for (const w of citingWorkSlugs()) {
      const f = workCitationsFile(w);
      if (!f) continue;
      const named = new Set<string>();
      for (const e of f.edges) for (const c of e.chapters) named.add(c.chapter);
      const titles = new Map(listChapters(w).map((c) => [c.chapter_slug, c.chapter_title]));
      for (const c of named) {
        const title = titles.get(c);
        // A chapter the manifest has since dropped is hydrateEdge's problem,
        // not this one's.
        if (title === undefined) continue;
        seen++;
        const label = locusLabel(w, c);
        longest = Math.max(longest, label.length);
        // The three legitimate forms, stated exactly rather than sniffed for:
        // the work's own unit and a numeral, a chapter position, or the
        // chapter's own short title. A slug fallback is none of them.
        const ok =
          NUMBERED.test(label) || CHAPTER_NO.test(label) || label === title.trim().toLowerCase();
        if (!ok) bad.push(`${w}/${c} → ${JSON.stringify(label)}`);
      }
    }
    return { seen, bad, longest };
  };

  test("every label is a unit-and-numeral, a chapter number, or the chapter's own title", () => {
    const { seen, bad, longest } = sweep();
    expect(seen).toBeGreaterThan(2_000);
    expect(bad).toEqual([]);
    // 28 is locusLabel's own title cutoff; nothing may exceed it, or a run of
    // six loci stops being a run.
    expect(longest).toBeLessThanOrEqual(28);
  });
});

describe("chapterTitleOf", () => {
  test("returns the corpus title, not a prettified slug", () => {
    expect(chapterTitleOf(CLEMENT, "01-book-1")).toBe("Book 1");
    expect(chapterTitleOf(GROTIUS, "09")).toBe("Chapter II.: Inquiry Into the Lawfulness of War.");
  });

  test("returns null for a chapter the work does not have", () => {
    expect(chapterTitleOf(CLEMENT, "99-not-a-chapter")).toBeNull();
    expect(chapterTitleOf("not-a-work-at-all", "01-book-1")).toBeNull();
  });
});

describe("chapterNumberOf", () => {
  test("gives 1-based reading order, which is what sorts a locus run", () => {
    expect(chapterNumberOf(CLEMENT, "01-book-1")).toBe(1);
    expect(chapterNumberOf(CLEMENT, "08-book-8")).toBe(8);
  });

  test("sorts an unknown chapter last instead of first", () => {
    // hydrateEdge sorts loci with this; a 0 or a NaN would put a chapter that
    // no longer exists at the head of the run.
    expect(chapterNumberOf(CLEMENT, "99-not-a-chapter")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("work shape and where a work opens", () => {
  test("a one-chapter work opens in the reader, at the default variant", () => {
    expect(isSingleChapterWork(CROWN)).toBe(true);
    expect(workEntryHref(CROWN)).toBe("/works/demosthenes-on-the-crown-6f92d0/01-on-the-crown/translation/");
    expect(workEntryLabel(CROWN)).toBe("the text");
  });

  test("a multi-chapter work opens on its contents page", () => {
    expect(isSingleChapterWork(CLEMENT)).toBe(false);
    expect(workEntryHref(CLEMENT)).toBe("/works/clement-of-alexandria-stromata-694383/");
    expect(workEntryLabel(CLEMENT)).toBe("contents");
  });

  test("the entry href of a one-chapter work never routes through its own stub", () => {
    // /works/<slug>/ for these is a location.replace() redirect, so linking
    // there costs the reader a bounce and costs the sitemap a claim it has to
    // withdraw.
    expect(workEntryHref(CROWN)).not.toBe(`/works/${CROWN}/`);
  });
});
