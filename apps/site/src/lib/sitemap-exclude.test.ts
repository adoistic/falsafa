// apps/site/src/lib/sitemap-exclude.test.ts
//
// The sitemap filter reads the real corpus artifacts, so these are assertions
// about the shipped data as much as about the code. They exist because the
// citation routes land next to two rules that could plausibly swallow them:
// the single-chapter redirect rule under /works/, and the noindex rule under
// /eval/.
import { describe, it, expect, beforeAll } from "bun:test";
import { includeInSitemap } from "./sitemap-exclude.mjs";

const O = "https://falsafa.ai";
const keep = (path: string) => includeInSitemap(`${O}${path}`);

// The first call builds every index the module memoizes — a walk of all 2,018
// works' chapter directories for the single-chapter rule, another for the
// variant rule, and one pass over the 482 citation files. That is seconds of
// I/O charged to whichever assertion happens to come first, so it is paid
// here instead, under a timeout that suits a cold page cache.
beforeAll(() => {
  includeInSitemap(`${O}/`);
}, 120_000);

describe("citation routes vs the single-chapter redirect rule", () => {
  it("keeps /works/<slug>/citations/ for a single-chapter work whose own page is a stub", () => {
    // Aeschines' speeches are one chapter each, so /works/<slug>/ is a
    // location.replace() stub and is dropped; the citations page is the only
    // indexable URL that carries the 42 sources Against Ctesiphon names.
    expect(keep("/works/aeschines-against-ctesiphon-d768ac/")).toBe(false);
    expect(keep("/works/aeschines-against-ctesiphon-d768ac/citations/")).toBe(true);
  });

  it("keeps a multi-chapter work and its citations page alike", () => {
    expect(keep("/works/clement-of-alexandria-stromata-694383/")).toBe(true);
    expect(keep("/works/clement-of-alexandria-stromata-694383/citations/")).toBe(true);
  });
});

describe("thin citation surfaces", () => {
  it("drops a work page that names two sources and is cited by none", () => {
    expect(keep("/works/4th-earl-of-chesterfield-poems-5d0ffd/citations/")).toBe(false);
  });

  it("drops an author whose works were never harvested and who is quoted twice", () => {
    expect(keep("/authors/epictetus/citations/")).toBe(false);
  });

  it("keeps the authors with a real library behind them", () => {
    expect(keep("/authors/demosthenes/citations/")).toBe(true);
    expect(keep("/authors/homer/citations/")).toBe(true);
  });
});

describe("the wanted list", () => {
  it("keeps /atlas/citations/<label>/ — no other URL makes that claim", () => {
    expect(keep("/atlas/citations/gospel-of-matthew/")).toBe(true);
    expect(keep("/atlas/citations/twelve-tables/")).toBe(true);
  });
});

describe("rules that were already here", () => {
  it("keeps the eval index and drops the individual cases", () => {
    expect(keep("/eval/")).toBe(true);
    expect(keep("/eval/case-1/")).toBe(false);
  });
  it("drops the print rendering of the book", () => {
    expect(keep("/book/print/")).toBe(false);
  });
  it("keeps the ordinary pages", () => {
    expect(keep("/")).toBe(true);
    expect(keep("/atlas/")).toBe(true);
    expect(keep("/authors/homer/")).toBe(true);
  });
});
