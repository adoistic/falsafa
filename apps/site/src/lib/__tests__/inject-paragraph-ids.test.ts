// apps/site/src/lib/__tests__/inject-paragraph-ids.test.ts
//
// Every citation link on the site is a paragraph id: `#p-9a2490`, or a
// `?paragraphs=` list of them. If the id is not on the rendered page the link
// still resolves — it just lands the reader at the top of the text with
// nothing lit, which is the failure mode the whole apparatus exists to avoid.
//
// Two failures of the per-block matcher put 884 of 34,512 built variant pages
// in that state, with 12,402 citation links pointing into them. A chapter
// whose paragraphs are numbered "1. ", "2. ", … is lexed by marked as ONE
// ordered list, so the matcher saw a single 42 KB token and matched nothing;
// and five Indic works carry a verse marker in the markdown that their
// sidecar text does not have, so no block matched there either.
//
// The 74 that survived that round were six shapes of one failure: content
// matching cannot tell two identical texts apart, so a text that is a whole
// chunk in one place and part of a longer chunk in another went to whichever
// entry stood first in the sidecar. 56 were a lead-in line — "In the *Matsya
// Purāṇa*:" — that is a chunk of its own elsewhere; 3 were the same split seen
// from the other side, where the quotation is the text that stands alone; 7 a
// chunk spanning two items of one list; 4 a footnote whose separator marked
// reads as a thematic break; 3 a block printed twice; and 1 a long chunk
// broken by two such rules. Reading the sidecar as the ordered document it is
// settles all six. The describes below pin each, and the last pins the guard
// that keeps the reading from ever costing an anchor.
//
// Run from apps/site/src, never apps/site (EMFILE on the corpus symlink).

import { describe, expect, test } from "bun:test";
import { renderMarkdownWithParagraphIds } from "../inject-paragraph-ids";
import type { ParagraphSidecarEntry } from "../corpus";

const entry = (id: string, text: string, offset = 0): ParagraphSidecarEntry => ({
  id,
  offset,
  text,
});

const idsIn = (html: string) => (html.match(/id="(p-[0-9a-z]+)"/g) ?? []).map((s) => s.slice(4, -1));

describe("ordinary prose blocks", () => {
  test("injects an id into each matched block", () => {
    const body = "First paragraph.\n\nSecond paragraph.";
    const html = renderMarkdownWithParagraphIds(body, [
      entry("p-aaa", "First paragraph."),
      entry("p-bbb", "Second paragraph."),
    ]);
    expect(idsIn(html)).toEqual(["p-aaa", "p-bbb"]);
    expect(html).toContain('<p id="p-aaa">');
  });

  test("leaves a block the sidecar does not know unmarked, rather than guessing", () => {
    const html = renderMarkdownWithParagraphIds("Known.\n\nUnknown.", [entry("p-aaa", "Known.")]);
    expect(idsIn(html)).toEqual(["p-aaa"]);
  });

  test("renders plain markdown when there is no sidecar at all", () => {
    const html = renderMarkdownWithParagraphIds("Just text.", []);
    expect(idsIn(html)).toEqual([]);
    expect(html).toContain("Just text.");
  });
});

describe("a chapter whose paragraphs are numbered", () => {
  // Tertullian's De Corona, in miniature: every chunk opens with "N. ", so
  // marked lexes the whole body as one <ol> and the block matcher never fires.
  const body = [
    "1. It happened lately: the bounty of our most excellent emperors was being paid out.",
    "2. One of them there, more a soldier of God, refused the laurel.",
    "3. The rest wore theirs, as the custom was.",
  ].join("\n\n");
  const sidecar = [
    entry("p-62fb36", "1. It happened lately: the bounty of our most excellent emperors was being paid out."),
    entry("p-85fc1a", "2. One of them there, more a soldier of God, refused the laurel."),
    entry("p-f651c1", "3. The rest wore theirs, as the custom was."),
  ];

  test("every numbered paragraph gets its id, in order", () => {
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    expect(idsIn(html)).toEqual(["p-62fb36", "p-85fc1a", "p-f651c1"]);
  });

  test("the ids land on the list items, and the list markup is unchanged", () => {
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    expect(html).toContain('<li id="p-62fb36">');
    expect(html).toMatch(/<ol[^>]*>/);
    // One item per sidecar chunk — the fix must not split the list apart.
    expect((html.match(/<li\b/g) ?? []).length).toBe(3);
  });

  test("an item the sidecar does not know is passed over without shifting the rest", () => {
    const html = renderMarkdownWithParagraphIds(body, [sidecar[0]!, sidecar[2]!]);
    expect(idsIn(html)).toEqual(["p-62fb36", "p-f651c1"]);
    expect(html).toContain('<li id="p-f651c1">');
  });
});

describe("lists that are not the numbered-paragraph case", () => {
  test("a list that IS one sidecar chunk keeps its single block-level id", () => {
    const body = "- alpha\n- beta";
    const html = renderMarkdownWithParagraphIds(body, [entry("p-list", "- alpha\n- beta")]);
    expect(idsIn(html)).toEqual(["p-list"]);
    expect(html).toContain('<ul id="p-list">');
  });

  test("a list the sidecar knows nothing about stays bare", () => {
    const html = renderMarkdownWithParagraphIds("- alpha\n- beta", [entry("p-x", "Something else.")]);
    expect(idsIn(html)).toEqual([]);
  });

  test("a nested list's items are not sidecar chunks and are left alone", () => {
    // Only depth-1 items are candidates. A nested item that happened to match
    // a chunk of prose would put a citation anchor inside another paragraph.
    const body = "1. outer one\n\n   - inner a\n   - inner b\n\n2. outer two";
    const html = renderMarkdownWithParagraphIds(body, [
      entry("p-one", "1. outer one\n\n   - inner a\n   - inner b\n\n"),
      entry("p-two", "2. outer two"),
    ]);
    expect(idsIn(html)).toEqual(["p-one", "p-two"]);
    const nested = html.slice(html.indexOf("inner a") - 200, html.indexOf("inner b"));
    expect(nested).not.toContain('id="p-two"');
  });

  test("an explicit id in the source markdown is never overwritten", () => {
    const body = '<ol>\n<li id="mine">kept</li>\n</ol>';
    const html = renderMarkdownWithParagraphIds(body, [entry("p-aaa", "kept")]);
    expect(html).toContain('id="mine"');
    expect(idsIn(html)).toEqual([]);
  });
});

describe("a chapter whose paragraphs carry a verse marker", () => {
  // The Ṛgveda and its neighbours number their verses in the markdown —
  // "**1.1**  O Agni, come hither" — but the sidecar text was written before
  // that pass ran and holds the verse alone. Five works, 11,708 blocks, none
  // of which matched.
  const body = "**1.1**  O Agni, come hither for our enjoyment.\n\n**1.2**  Among human beings, through the gods.";
  const sidecar = [
    entry("p-56f1c1", "O Agni, come hither for our enjoyment."),
    entry("p-cd4100", "Among human beings, through the gods."),
  ];

  test("matches on the verse alone once the exact text has failed", () => {
    expect(idsIn(renderMarkdownWithParagraphIds(body, sidecar))).toEqual(["p-56f1c1", "p-cd4100"]);
  });

  test("an exact match always wins, so a paragraph that opens in bold is unaffected", () => {
    // Both entries could match the same block if the fallback ran first; the
    // one that carries the marker is the true chunk and must be chosen.
    const html = renderMarkdownWithParagraphIds("**Note**  the text.", [
      entry("p-exact", "**Note**  the text."),
      entry("p-stripped", "the text."),
    ]);
    expect(idsIn(html)).toEqual(["p-exact"]);
  });

  test("does not strip a long bold run, which is emphasis and not a marker", () => {
    const html = renderMarkdownWithParagraphIds(
      "**a very long bold opening indeed**  and the rest.",
      [entry("p-x", "and the rest.")],
    );
    expect(idsIn(html)).toEqual([]);
  });
});

describe("a sidecar chunk that lexes as several tokens", () => {
  // "And they are:" followed by an enumeration is one blank-line-separated
  // block to the pipeline that wrote the sidecar and two tokens to marked.
  const body = "And they are:\n1. the first\n2. the second\n\nA later paragraph.";
  const sidecar = [
    entry("p-run", "And they are:\n1. the first\n2. the second"),
    entry("p-after", "A later paragraph."),
  ];

  test("anchors the chunk at its first block and leaves the next chunk alone", () => {
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    expect(idsIn(html)).toEqual(["p-run", "p-after"]);
    expect(html).toContain('<p id="p-run">');
  });

  test("renders the run exactly as the tokens render separately", () => {
    const withIds = renderMarkdownWithParagraphIds(body, sidecar);
    const bare = renderMarkdownWithParagraphIds(body, []);
    expect(withIds.replace(/ id="p-[0-9a-z]+"/g, "")).toBe(bare);
  });

  test("never absorbs a token that carries its own id", () => {
    // If "the middle." were swallowed into a run, the reader would lose an
    // anchor that already worked.
    const html = renderMarkdownWithParagraphIds("One.\n\nthe middle.\n\nThree.", [
      entry("p-mid", "the middle."),
      entry("p-greedy", "One.\n\nthe middle.\n\nThree."),
    ]);
    expect(idsIn(html)).toEqual(["p-mid"]);
  });

  test("gives up rather than swallowing the rest of the chapter", () => {
    // A chunk the markdown does not contain must not run away: the bound is
    // six tokens, and nothing after it may lose its own anchor.
    const body2 = Array.from({ length: 12 }, (_, i) => `Block ${i}.`).join("\n\n");
    const html = renderMarkdownWithParagraphIds(body2, [
      entry("p-absent", "Something the chapter never says."),
      entry("p-last", "Block 11."),
    ]);
    expect(idsIn(html)).toEqual(["p-last"]);
  });
});

describe("two blocks with the same text", () => {
  // A refrain, an epigraph, a hymn printed twice. Both blocks used to take the
  // FIRST entry's id, so the page carried the same id twice — invalid markup,
  // and every citation anchored to the second chunk landed on the first. One
  // chapter of the Vīramitrodaya carried 408 such duplicate id attributes.
  test("each printing takes its own chunk, in order", () => {
    const html = renderMarkdownWithParagraphIds("Refrain.\n\nBetween.\n\nRefrain.", [
      entry("p-first", "Refrain."),
      entry("p-mid", "Between."),
      entry("p-second", "Refrain."),
    ]);
    expect(idsIn(html)).toEqual(["p-first", "p-mid", "p-second"]);
  });

  test("more printings than chunks: the extras keep the first id rather than none", () => {
    const html = renderMarkdownWithParagraphIds("Refrain.\n\nRefrain.\n\nRefrain.", [
      entry("p-first", "Refrain."),
      entry("p-second", "Refrain."),
    ]);
    expect(idsIn(html)).toEqual(["p-first", "p-second", "p-first"]);
  });
});

describe("a lead-in line that is also a whole chunk somewhere else", () => {
  // The Vīramitrodaya quotes its authorities as "In the *Matsya Purāṇa*:"
  // followed by the verse. Sometimes the pipeline made that one chunk and
  // sometimes two, so the lead-in matched a chunk of its own and the compound
  // chunk was never anchored — 56 of the 74 dead fragments, the largest shape.
  const sidecar = [
    entry("p-lead", "In the *Matsya Purāṇa*:"),
    entry("p-quote", "> The evening is three *muhūrtas*."),
    entry("p-both", "In the *Matsya Purāṇa*:\n> And on the *saṅkrāntis*, it should be performed."),
  ];

  test("the compound chunk anchors at its lead-in, and the standalone one keeps its id", () => {
    const body =
      "In the *Matsya Purāṇa*:\n\n> The evening is three *muhūrtas*.\n\n" +
      "In the *Matsya Purāṇa*:\n> And on the *saṅkrāntis*, it should be performed.";
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    expect(idsIn(html)).toEqual(["p-lead", "p-quote", "p-both"]);
  });

  test("the quotation may be the text that stands alone elsewhere", () => {
    // The mirror case: the run would swallow a blockquote whose text is a
    // chunk in its own right further down. Three of the 74 were this.
    const body =
      "Devala says:\n> The moment is subtle.\n\n> The moment is subtle.\n\nAfter.";
    const html = renderMarkdownWithParagraphIds(body, [
      entry("p-run", "Devala says:\n> The moment is subtle."),
      entry("p-alone", "> The moment is subtle."),
      entry("p-after", "After."),
    ]);
    expect(idsIn(html)).toEqual(["p-run", "p-alone", "p-after"]);
  });
});

describe("a footnote block", () => {
  // "__________" is ten underscores, which marked reads as a thematic break,
  // so the separator and the note are two tokens and one sidecar chunk. Four
  // of the 74 were footnotes of the Vīramitrodaya's editor.
  test("the separator and the note are one chunk, anchored at the rule", () => {
    const body = "Body text.\n\n__________\n[^1]: The note itself.";
    const html = renderMarkdownWithParagraphIds(body, [
      entry("p-body", "Body text."),
      entry("p-note", "__________\n[^1]: The note itself."),
    ]);
    expect(idsIn(html)).toEqual(["p-body", "p-note"]);
    expect(html).toContain('<hr id="p-note">');
  });

  test("a rule inside a chunk does not break the chunk apart", () => {
    // The Vīramitrodaya's longest chunks carry an editor's gloss between two
    // rules and go on afterwards — five tokens for one anchor.
    const body = "Now the *tithi*.\n__________\nThe gloss.\n__________\nAnd the text resumes.";
    const html = renderMarkdownWithParagraphIds(body, [
      entry("p-long", "Now the *tithi*.\n__________\nThe gloss.\n__________\nAnd the text resumes."),
    ]);
    expect(idsIn(html)).toEqual(["p-long"]);
    expect(html).toContain('<p id="p-long">');
    expect((html.match(/<hr>/g) ?? []).length).toBe(2);
  });
});

describe("a chunk that spans two items of one list", () => {
  // Tertullian's Apologeticum opens each section with the bare section number
  // on its own line — "31." — and the paragraph beneath it starts "1. ". Both
  // are items of the chapter-wide ordered list, and the sidecar holds them as
  // one chunk: 50 of the Apologeticum's 501 chunks, 7 of them cited.
  const body = "31.\n1. We have now, you say, been flattering the emperor.\n\n2. Plainly that deceit profits us.";
  const sidecar = [
    entry("p-31", "31.\n1. We have now, you say, been flattering the emperor."),
    entry("p-2", "2. Plainly that deceit profits us."),
  ];

  test("the chunk anchors at the first of the two items", () => {
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    expect(idsIn(html)).toEqual(["p-31", "p-2"]);
    expect(html).toContain('<li id="p-31">');
  });

  test("the second item is left bare rather than taking a neighbour's id", () => {
    const html = renderMarkdownWithParagraphIds(body, sidecar);
    const items = html.match(/<li[^>]*>/g) ?? [];
    expect(items.length).toBe(3);
    expect(items[1]).toBe("<li>");
  });
});

describe("the guard that makes the ordered reading safe", () => {
  // Reading the sidecar in order can, in principle, hand a block a later
  // chunk's id and leave an earlier chunk unanchored — here "X" is the first
  // and the third entry but the chapter prints it once, after "Y". Rather than
  // trade one anchor for another, the whole chapter falls back to the matcher
  // that shipped. A page may gain anchors from this file; it may never lose one.
  test("falls back wholesale when the ordered reading would drop an id", () => {
    const html = renderMarkdownWithParagraphIds("Y.\n\nX.", [
      entry("p-xearly", "X."),
      entry("p-y", "Y."),
      entry("p-xlate", "X."),
    ]);
    expect(idsIn(html)).toEqual(["p-y", "p-xearly"]);
  });

  test("the markup is the markup marked would have produced, ids aside", () => {
    const body =
      "In the *Matsya Purāṇa*:\n> And on the *saṅkrāntis*.\n\n1. one\n\n2. two\n\nPlain.";
    const withIds = renderMarkdownWithParagraphIds(body, [
      entry("p-a", "In the *Matsya Purāṇa*:\n> And on the *saṅkrāntis*."),
      entry("p-b", "1. one"),
      entry("p-c", "2. two"),
      entry("p-d", "Plain."),
    ]);
    expect(idsIn(withIds)).toEqual(["p-a", "p-b", "p-c", "p-d"]);
    expect(withIds.replace(/ id="p-[0-9a-z-]+"/g, "")).toBe(
      renderMarkdownWithParagraphIds(body, []),
    );
  });
});

describe("against the shipped corpus", () => {
  test("the shapes that survived the last round now carry their anchors", async () => {
    const { readChapterVariant, readParagraphSidecar } = await import("../corpus");
    // The two chapters that held all but 66 of the 74 dead fragments. The
    // third, the Vīramitrodaya's first chapter, is 5,035 chunks and takes the
    // better part of a minute to render, so it is covered by the corpus-wide
    // sweep rather than here.
    for (const [work, chapter, entries, wasDead] of [
      // 50 chunks open with a bare section number and so span two list items.
      ["tertullian-apologeticum-02366e", "01-apologeticum", 501, "p-1d6e17"],
      // Five hymns are printed twice and used to share one id.
      ["rigveda-aufrecht", "01-mandala-1", 2006, "p-01fc9c"],
    ] as [string, string, number, string][]) {
      const v = readChapterVariant(work, chapter, "translation")!;
      const sidecar = readParagraphSidecar(work, chapter, v.variant.file);
      const html = renderMarkdownWithParagraphIds(v.body.trim(), sidecar);
      const ids = idsIn(html);
      expect(sidecar.length).toBe(entries);
      // Every chunk anchored, each exactly once — no id printed twice.
      expect(new Set(ids).size).toBe(entries);
      expect(ids.length).toBe(entries);
      expect(ids).toContain(wasDead);
    }
  });

  test("the works that number their paragraphs now carry anchors", async () => {
    const { readChapterVariant, readParagraphSidecar, listChapters } = await import("../corpus");
    // Tertullian's De Corona is the case that was measured at zero anchors;
    // Clement's Stromata is ordinary prose and must be unaffected.
    for (const [work, expected] of [
      ["tertullian-de-corona-5d0620", 15],
      ["atharvaveda-ps", 469],
      ["clement-of-alexandria-stromata-694383", 183],
    ] as [string, number][]) {
      const chapter = listChapters(work)[0]!.chapter_slug;
      const v = readChapterVariant(work, chapter, "translation")!;
      const sidecar = readParagraphSidecar(work, chapter, v.variant.file);
      const html = renderMarkdownWithParagraphIds(v.body.trim(), sidecar);
      expect(sidecar.length).toBe(expected);
      expect(idsIn(html).length).toBe(expected);
    }
  });
});
