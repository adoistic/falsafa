// apps/site/src/lib/works-filter.test.ts
import { describe, it, expect } from "bun:test";
import {
  filterWorks, facetCounts, sortWorks, parseFilterState, serializeFilterState,
  emptyState, type BrowseWork, type FilterState,
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
  it("chrono: ascending published_year, nulls last", () => {
    expect(sortWorks(works, "chrono").map((w) => w.slug)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("title: locale A-Z", () => {
    expect(sortWorks(works, "title").map((w) => w.title)[0]).toBe("Aeneid");
  });
  it("author: locale A-Z", () => {
    expect(sortWorks(works, "author").map((w) => w.author)[0]).toBe("Anon");
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
