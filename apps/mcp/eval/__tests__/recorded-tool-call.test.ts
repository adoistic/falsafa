import { describe, expect, test } from "bun:test";
import type { RecordedToolCall } from "../run-openrouter.ts";

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

  test("captures paragraph_ids from read_chapter result", () => {
    const result = { content: [{ type: "text", text: "[p-868413] First line\n[p-aabbcc] Second line" }] };
    const ids = new Set<string>();
    for (const c of result.content) {
      for (const m of c.text.matchAll(/\bp-[0-9a-f]{6}\b/g)) ids.add(m[0]);
    }
    expect(Array.from(ids).sort()).toEqual(["p-868413", "p-aabbcc"]);
  });
});
