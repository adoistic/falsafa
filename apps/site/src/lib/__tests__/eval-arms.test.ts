import { describe, expect, test } from "bun:test";
import { armOfModelId } from "../eval-arms";

describe("armOfModelId", () => {
  test("returns 'baseline' for ids ending in __baseline", () => {
    expect(armOfModelId("grok-4.1-fast__baseline")).toBe("baseline");
  });

  test("returns 'wiki' for ids ending in __wiki", () => {
    expect(armOfModelId("grok-4.1-fast__wiki")).toBe("wiki");
  });

  test("returns null for untagged model ids", () => {
    expect(armOfModelId("grok-4.1-fast")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(armOfModelId("")).toBeNull();
  });

  test("returns null for ids with __ but unknown arm tag", () => {
    expect(armOfModelId("grok-4.1-fast__experimental")).toBeNull();
  });
});
