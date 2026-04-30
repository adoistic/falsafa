import { describe, expect, test } from "bun:test";
import { linkifyHtml } from "./eval-paragraph-link";
import type { EvalCitation } from "./eval-types";

// Fixture: a tiny chapters map mimicking listChapters() output.
// Real listChapters returns ChapterMeta[]; the helper only needs the
// fields it touches. Use a minimal stub.
const fakeListChapters = (workSlug: string) => {
  if (workSlug === "mirza-ghalib-diwan-e-ghalib-74ed4c") {
    return [{ chapter_number: 115, chapter_slug: "koi-ummeed-bar-nahin-aati" }];
  }
  return [];
};

describe("linkifyHtml", () => {
  test("replaces a p-XXXXXX token with an anchor when a matching citation exists", () => {
    const html = "<p>The opening matla is paragraph p-92c600 in the translation.</p>";
    const citations: EvalCitation[] = [{
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
      chapter_number: 115,
      paragraph_id: "p-92c600",
    }];
    const out = linkifyHtml(html, citations, fakeListChapters);
    expect(out).toContain('<a href="/works/mirza-ghalib-diwan-e-ghalib-74ed4c/koi-ummeed-bar-nahin-aati/translation/#p-92c600">p-92c600</a>');
  });

  test("leaves a p-XXXXXX token unchanged when no matching citation", () => {
    const html = "<p>Hallucinated reference: p-deadbe.</p>";
    const out = linkifyHtml(html, [], fakeListChapters);
    expect(out).toContain("p-deadbe");
    expect(out).not.toContain("<a ");
  });

  test("handles multi-citation answers — each token resolves to its own work", () => {
    const html = "<p>See p-aaa111 and p-bbb222 for the comparison.</p>";
    const citations: EvalCitation[] = [
      { work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c", chapter_number: 115, paragraph_id: "p-aaa111" },
      { work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c", chapter_number: 115, paragraph_id: "p-bbb222" },
    ];
    const out = linkifyHtml(html, citations, fakeListChapters);
    expect(out).toContain("#p-aaa111");
    expect(out).toContain("#p-bbb222");
  });

  test("falls back to plain text when chapter_slug can't be resolved", () => {
    const citations: EvalCitation[] = [{
      work_slug: "no-such-work", chapter_number: 1, paragraph_id: "p-foo123",
    }];
    const out = linkifyHtml("<p>Reference: p-foo123.</p>", citations, fakeListChapters);
    expect(out).toContain("p-foo123");
    expect(out).not.toContain("<a ");
  });

  test("preserves p-XXXXXX tokens inside <pre><code> blocks", () => {
    const html = `<p>See <code>p-92c600</code> in the source.</p>`;
    const citations: EvalCitation[] = [{
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
      chapter_number: 115,
      paragraph_id: "p-92c600",
    }];
    const out = linkifyHtml(html, citations, fakeListChapters);
    // The token inside <code> stays as text, not an anchor.
    expect(out).toContain("<code>p-92c600</code>");
    // No anchor wrapping inside the code element.
    expect(out).not.toMatch(/<code>[^<]*<a [^>]*>p-92c600<\/a>[^<]*<\/code>/);
  });

  test("does NOT wrap a p-XXXXXX token inside an existing <a href> attribute", () => {
    // Regression: when marked.parse rendered [paragraph](#p-XXXXXX) as
    // <a href="...#p-XXXXXX">paragraph</a>, the old linkifyHtml found
    // p-XXXXXX inside the href attribute and wrapped it in another anchor,
    // producing nested <a> tags inside an attribute value. Browsers bailed
    // out of the malformed outer anchor, leaking '">paragraph' as visible
    // text. Real-world break: caught on /eval/q-0002/.
    const html = `<p>See <a href="/works/foo/115-x/translation/#p-92c600">paragraph</a> for context.</p>`;
    const citations: EvalCitation[] = [{
      work_slug: "mirza-ghalib-diwan-e-ghalib-74ed4c",
      chapter_number: 115,
      paragraph_id: "p-92c600",
    }];
    const out = linkifyHtml(html, citations, fakeListChapters);
    // The original anchor is preserved verbatim.
    expect(out).toContain('<a href="/works/foo/115-x/translation/#p-92c600">paragraph</a>');
    // Nothing nested inside it.
    expect(out).not.toMatch(/<a [^>]*>\s*<a /);
    // The orphan attribute-end pattern '">paragraph' must NOT appear (that
    // was the visible artifact).
    expect(out).not.toContain('">paragraph</a>">paragraph');
  });
});
