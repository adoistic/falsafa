import { describe, expect, test } from "bun:test";
import { findTargetPassages } from "./fidelity";

describe("findTargetPassages", () => {
  test("ranks the topically-matching target paragraph first", () => {
    const paras = [
      { id: "p-bread", text: "The baker sold his bread at a fair market price in the village square on Tuesday morning." },
      { id: "p-681e60", text: "Labour, therefore, is the real measure of the exchangeable value of all commodities; the value of any commodity is equal to the quantity of labour it can command." },
      { id: "p-river", text: "Rivers and mountains shaped the migration of ancient peoples across the wide continent." },
    ];
    const out = findTargetPassages("To the labour of man alone he ascribes the power of producing values. This is an error.", paras, 2);
    expect(out[0]!.paragraph_id).toBe("p-681e60");
    expect(out[0]!.score).toBeGreaterThan(0);
  });

  test("returns empty when nothing overlaps", () => {
    const out = findTargetPassages("labour value commodities", [{ id: "p-z", text: "purple elephants dance" }], 3);
    expect(out).toEqual([]);
  });
});
