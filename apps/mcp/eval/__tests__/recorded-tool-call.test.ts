import { describe, expect, test } from "bun:test";
import type { RecordedToolCall } from "../run-openrouter.ts";
import { extractParagraphIdsFromToolResult } from "../run-openrouter.ts";

describe("RecordedToolCall schema", () => {
  test("type accepts returned_paragraph_ids on read_chapter", () => {
    const c: RecordedToolCall = {
      name: "read_chapter",
      args: { work_slug: "manusmrti", chapter_number: 1, variant: "translation" },
      result_summary: "...",
      returned_paragraph_ids: ["p-868413", "p-aabbcc"],
    };
    expect(c.returned_paragraph_ids).toHaveLength(2);
  });

  test("type accepts returned_paragraph_ids absent on non-content tools", () => {
    const c: RecordedToolCall = {
      name: "list_works",
      args: { author: "cynewulf" },
      result_summary: "...",
    };
    expect(c.returned_paragraph_ids).toBeUndefined();
  });
});

describe("extractParagraphIdsFromToolResult", () => {
  test("extracts paragraph_ids from read_chapter body", () => {
    const result = { body: "[p-868413] First line\n[p-aabbcc] Second line" };
    const ids = extractParagraphIdsFromToolResult("read_chapter", result);
    expect(ids?.sort()).toEqual(["p-868413", "p-aabbcc"]);
  });

  test("extracts paragraph_ids from get_passage passages array", () => {
    const result = { passages: [{ id: "p-123456", text: "..." }, { id: "p-abcdef", text: "..." }] };
    const ids = extractParagraphIdsFromToolResult("get_passage", result);
    expect(ids?.sort()).toEqual(["p-123456", "p-abcdef"]);
  });

  test("returns undefined for non-content tools", () => {
    expect(extractParagraphIdsFromToolResult("list_works", { works: [] })).toBeUndefined();
  });

  test("returns undefined when no ids found", () => {
    expect(extractParagraphIdsFromToolResult("read_chapter", { body: "no markers" })).toBeUndefined();
  });
});
