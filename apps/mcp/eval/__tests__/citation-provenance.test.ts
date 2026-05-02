import { describe, expect, test } from "bun:test";
import { extractCitations, type RecordedToolCall } from "../run-openrouter.ts";

describe("extractCitations — per-token provenance lookup", () => {
  test("attributes paragraph_id to the tool call that actually returned it", () => {
    const calls: RecordedToolCall[] = [
      {
        name: "read_chapter",
        args: { work_slug: "manusmrti", chapter_number: 1 },
        returned_paragraph_ids: ["p-aaaa11", "p-aaaa22"],
      },
      {
        name: "read_chapter",
        args: { work_slug: "yajnavalkya", chapter_number: 2 },
        returned_paragraph_ids: ["p-bbbb11", "p-bbbb22"],
      },
    ];
    const answer = "Manu says [p-aaaa11] and Yajnavalkya says [p-bbbb22].";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(2);
    expect(cites.find((c) => c.paragraph_id === "p-aaaa11")?.work_slug).toBe("manusmrti");
    expect(cites.find((c) => c.paragraph_id === "p-bbbb22")?.work_slug).toBe("yajnavalkya");
  });

  test("falls back to 'unknown' work_slug for hallucinated paragraph_ids", () => {
    const calls: RecordedToolCall[] = [
      {
        name: "read_chapter",
        args: { work_slug: "manusmrti", chapter_number: 1 },
        returned_paragraph_ids: ["p-aaaa11"],
      },
    ];
    const answer = "Citing [p-aaaa11] and [p-ff0000] (model invented this).";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(2);
    expect(cites.find((c) => c.paragraph_id === "p-ff0000")?.work_slug).toBe("");
  });

  test("returns empty array when answer has no paragraph_ids", () => {
    const calls: RecordedToolCall[] = [];
    expect(extractCitations("No citations here.", calls)).toEqual([]);
  });

  test("dedupes when same paragraph_id appears twice in answer", () => {
    const calls: RecordedToolCall[] = [
      {
        name: "read_chapter",
        args: { work_slug: "andreas", chapter_number: 1 },
        returned_paragraph_ids: ["p-868413"],
      },
    ];
    const answer = "Quote 1: [p-868413]. Quote 2: [p-868413].";
    const cites = extractCitations(answer, calls);
    expect(cites).toHaveLength(1);
  });

  test("handles get_passage tool calls the same way", () => {
    const calls: RecordedToolCall[] = [
      {
        name: "get_passage",
        args: { work_slug: "iqbal-bang-e-dara-1", paragraph_ids: ["p-7c1abc"] },
        returned_paragraph_ids: ["p-7c1abc"],
      },
    ];
    const cites = extractCitations("As Iqbal writes [p-7c1abc]…", calls);
    expect(cites[0]?.work_slug).toBe("iqbal-bang-e-dara-1");
  });

  test("hallucinated paragraph_id in tool ARG but never returned falls through to unknown", () => {
    // Model called get_passage(paragraph_ids=["p-aaaa11"]) but the call errored;
    // returned_paragraph_ids is undefined. The lookup must NOT fall back to args.
    const calls: RecordedToolCall[] = [
      {
        name: "get_passage",
        args: { work_slug: "manusmrti", paragraph_ids: ["p-aaaa11"] },
        result_summary: "error: not found",
        // returned_paragraph_ids deliberately absent (call errored)
      },
    ];
    const cites = extractCitations("Citing [p-aaaa11]…", calls);
    expect(cites[0]?.work_slug).toBe("");
  });
});
