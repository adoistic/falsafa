import { describe, expect, test } from "bun:test";
import { chunkByCharBudget, mapWithConcurrency, validateRawReferences } from "./extract-references";
import type { RawReference } from "./types";

const rec = (p: string): RawReference => ({
  citing_work_slug: "parasara", citing_paragraph_id: p, raw_target: "Manu",
  target_kind: "author", stance: "authority", quote: "thus has Manu declared",
});

describe("validateRawReferences", () => {
  test("keeps records with real paragraph ids, drops the rest", () => {
    const real = new Set(["p-8991a9"]);
    const { kept, dropped } = validateRawReferences([rec("p-8991a9"), rec("p-deadbe")], real);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(kept[0]!.citing_paragraph_id).toBe("p-8991a9");
  });
});

describe("chunkByCharBudget", () => {
  const P = (id: string, n: number) => ({ id, text: "x".repeat(n) });
  test("never splits a paragraph and respects the budget", () => {
    const items = [P("a", 30), P("b", 30), P("c", 30), P("d", 10)];
    const w = chunkByCharBudget(items, 50);
    expect(w.flat().map((i) => i.id)).toEqual(["a", "b", "c", "d"]); // all covered, in order
    expect(w.every((win) => win.length >= 1)).toBe(true);
    expect(w.length).toBeGreaterThan(1); // budget forced multiple windows
  });
  test("a single oversized paragraph gets its own window", () => {
    const w = chunkByCharBudget([P("big", 100), P("small", 5)], 50);
    expect(w[0]!.map((i) => i.id)).toEqual(["big"]);
  });
});

describe("mapWithConcurrency", () => {
  test("preserves order and maps all items", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });
  test("never exceeds the concurrency limit", async () => {
    let running = 0, max = 0;
    await mapWithConcurrency([1,2,3,4,5,6,7,8], 3, async () => {
      running++; max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running--; return 0;
    });
    expect(max).toBeLessThanOrEqual(3);
  });
});
