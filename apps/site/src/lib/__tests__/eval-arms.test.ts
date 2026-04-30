import { describe, expect, test } from "bun:test";
import { armOfModelId } from "../eval-arms";
import { isAbMode } from "../eval-arms";

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

describe("isAbMode", () => {
  test("returns false for empty model list", () => {
    expect(isAbMode([])).toBe(false);
  });

  test("returns false when only baseline arm is present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast__baseline" }])).toBe(false);
  });

  test("returns false when only wiki arm is present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast__wiki" }])).toBe(false);
  });

  test("returns false when only untagged models are present", () => {
    expect(isAbMode([{ id: "grok-4.1-fast" }, { id: "sonnet-4.6" }])).toBe(false);
  });

  test("returns true when both arms present", () => {
    expect(
      isAbMode([
        { id: "grok-4.1-fast__baseline" },
        { id: "grok-4.1-fast__wiki" },
      ]),
    ).toBe(true);
  });

  test("returns true when both arms present alongside untagged models", () => {
    expect(
      isAbMode([
        { id: "grok-4.1-fast__baseline" },
        { id: "grok-4.1-fast__wiki" },
        { id: "sonnet-4.6" },
      ]),
    ).toBe(true);
  });
});
