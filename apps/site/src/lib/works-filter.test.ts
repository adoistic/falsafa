// apps/site/src/lib/works-filter.test.ts
import { describe, it, expect } from "bun:test";
import {
  filterWorks, facetCounts, sortWorks, parseFilterState, serializeFilterState,
  emptyState, effectiveYear, ERA_START_YEAR, type BrowseWork, type FilterState,
} from "./works-filter";

const W = (o: Partial<BrowseWork>): BrowseWork => ({
  slug: "s", title: "T", author: "A", author_slug: "a",
  era: "Imperial", genre: "Poetry", language: "Greek",
  difficulty: "Advanced", published_year: 100, total_logical_chapters: 1, ...o,
});
const works: BrowseWork[] = [
  W({ slug: "a", title: "Iliad", author: "Homer", era: "Classical", genre: "Poetry", language: "Greek", published_year: -750 }),
  W({ slug: "b", title: "Republic", author: "Plato", era: "Classical", genre: "Philosophy", language: "Greek", published_year: -380 }),
  W({ slug: "c", title: "Aeneid", author: "Virgil", era: "Imperial", genre: "Poetry", language: "Latin", published_year: -19 }),
  W({ slug: "d", title: "Sonnets", author: "Shakespeare", era: "16th Century", genre: "Poetry", language: "English", published_year: 1609 }),
  W({ slug: "e", title: "Untitled", author: "Anon", era: "Imperial", genre: "Poetry", language: "Latin", published_year: null }),
];

describe("filterWorks", () => {
  it("returns all works for empty state", () => {
    expect(filterWorks(works, emptyState()).length).toBe(5);
  });
  it("AND across dimensions, OR within a dimension", () => {
    const s = { ...emptyState(), language: ["Greek", "Latin"], genre: ["Poetry"] };
    expect(filterWorks(works, s).map((w) => w.slug).sort()).toEqual(["a", "c", "e"]);
  });
  it("search matches title or author, case-insensitive substring", () => {
    expect(filterWorks(works, { ...emptyState(), q: "plato" }).map((w) => w.slug)).toEqual(["b"]);
    expect(filterWorks(works, { ...emptyState(), q: "son" }).map((w) => w.slug)).toEqual(["d"]);
  });
});

describe("facetCounts", () => {
  it("counts a dimension against OTHER active facets + search, ignoring its own selection", () => {
    const s = { ...emptyState(), genre: ["Poetry"], language: ["Greek"] };
    // counts for `language` ignore the language selection but apply genre=Poetry
    const c = facetCounts(works, s, "language");
    expect(c.get("Greek")).toBe(1); // a
    expect(c.get("Latin")).toBe(2); // c, e
    expect(c.get("English")).toBe(1); // d
  });
});

describe("sortWorks", () => {
  it("chrono: ascending effectiveYear; null-year Imperial work sorts by ERA_START_YEAR[-27]", () => {
    // "Untitled" (slug e) has era="Imperial", published_year=null → effectiveYear = -27
    // So order: Iliad(-750) < Republic(-380) < Untitled(-27) < Aeneid(-19) < Sonnets(1609)
    expect(sortWorks(works, "chrono").map((w) => w.slug)).toEqual(["a", "b", "e", "c", "d"]);
  });
  it("title: locale A-Z", () => {
    expect(sortWorks(works, "title").map((w) => w.title)[0]).toBe("Aeneid");
  });
  it("author: locale A-Z", () => {
    expect(sortWorks(works, "author").map((w) => w.author)[0]).toBe("Anon");
  });
});

describe("effectiveYear + chrono sort (Vedas-before-Homer fix)", () => {
  it("effectiveYear returns published_year when present", () => {
    expect(effectiveYear(W({ published_year: -750, era: "Classical" }))).toBe(-750);
  });
  it("effectiveYear falls back to ERA_START_YEAR when published_year is null", () => {
    expect(effectiveYear(W({ published_year: null, era: "Ancient" }))).toBe(ERA_START_YEAR["Ancient"]);
    expect(effectiveYear(W({ published_year: null, era: "Classical" }))).toBe(ERA_START_YEAR["Classical"]);
    expect(effectiveYear(W({ published_year: null, era: "Unknown" }))).toBe(3000);
    expect(effectiveYear(W({ published_year: null, era: "NoSuchEra" }))).toBe(3000);
  });
  it("null-year Ancient work sorts BEFORE null-year Classical work (Vedas before Homer era)", () => {
    const veda = W({ slug: "veda", title: "Rigveda", era: "Ancient", published_year: null });
    const classical = W({ slug: "homer", title: "Iliad", era: "Classical", published_year: null });
    const sorted = sortWorks([classical, veda], "chrono").map((w) => w.slug);
    expect(sorted).toEqual(["veda", "homer"]);
  });
  it("null-year Ancient work sorts BEFORE a dated Classical work (Vedas before Homer)", () => {
    const veda = W({ slug: "veda", title: "Rigveda", era: "Ancient", published_year: null });
    const homer = W({ slug: "homer", title: "Iliad", era: "Classical", published_year: -750 });
    const sorted = sortWorks([homer, veda], "chrono").map((w) => w.slug);
    expect(sorted).toEqual(["veda", "homer"]);
  });
});

describe("URL state round-trip", () => {
  it("serialize then parse is identity for non-empty dims", () => {
    const s: FilterState = { q: "war", era: ["Imperial"], language: ["Greek", "Latin"], genre: [], difficulty: [], sort: "title" };
    const parsed = parseFilterState(new URLSearchParams(serializeFilterState(s)));
    expect(parsed).toEqual(s);
  });
  it("empty state serializes to empty string and parses back to empty", () => {
    expect(serializeFilterState(emptyState())).toBe("");
    expect(parseFilterState(new URLSearchParams(""))).toEqual(emptyState());
  });
});
