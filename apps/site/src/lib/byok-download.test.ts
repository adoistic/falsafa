import { describe, expect, test } from "bun:test";
import { buildByokDownloadPayload, mapToolCallsToEval } from "./byok-download";
import type { ToolCall } from "../islands/byok/types";

describe("mapToolCallsToEval", () => {
  test("converts a single live ToolCall into EvalToolCall", () => {
    const tc: ToolCall = {
      id: "tc-1",
      name: "search_corpus",
      argsBuffer: '{"query":"ummeed"}',
      result: "Found chapter 115 of Diwan-E-Ghalib.",
      startedAt: 1000,
      endedAt: 1500,
    };
    expect(mapToolCallsToEval([tc])).toEqual([{
      name: "search_corpus",
      args: { query: "ummeed" },
      result_summary: "Found chapter 115 of Diwan-E-Ghalib.",
    }]);
  });

  test("treats a null result as undefined result_summary", () => {
    const tc: ToolCall = {
      id: "tc-2", name: "list_works", argsBuffer: "{}", result: null,
      startedAt: 0, endedAt: null,
    };
    expect(mapToolCallsToEval([tc])[0]?.result_summary).toBeUndefined();
  });

  test("falls back to raw string when argsBuffer is malformed JSON", () => {
    const tc: ToolCall = {
      id: "tc-3", name: "broken", argsBuffer: "{not json", result: "x",
      startedAt: 0, endedAt: 1,
    };
    const out = mapToolCallsToEval([tc]);
    // args becomes the raw string for forensic value; doesn't throw.
    expect(out[0]?.args).toBe("{not json");
  });
});

describe("buildByokDownloadPayload", () => {
  test("produces a ByokDownloadPayload-shaped object", () => {
    const payload = buildByokDownloadPayload({
      prompt: "What is dharma?",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      answer: "Dharma is …",
      toolCalls: [],
      citations: [],
      durationMs: 1200,
    });
    expect(payload.schema_version).toBe("falsafa-byok/v1");
    expect(payload.prompt).toBe("What is dharma?");
    expect(payload.result.from_run).toBe("live-byok");
    expect(payload.result.duration_ms).toBe(1200);
    expect(typeof payload.generated_at).toBe("string");
    // ISO 8601 sanity check
    expect(payload.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
