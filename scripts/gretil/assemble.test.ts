import { test, expect } from "bun:test";
import { mergeParts, pid, refKey } from "./assemble";

test("refKey is numeric (so 1.1.2 sorts before 1.1.10)", () => {
  expect(refKey("1.1.10")).toEqual([1, 1, 10]);
});

test("mergeParts dedups by ref (last wins) and sorts numerically", () => {
  const m = mergeParts([
    { ref: "1.2.1", sanskrit: "s", english: "e" },
    { ref: "1.1.10", sanskrit: "s", english: "e" },
    { ref: "1.1.2", sanskrit: "s", english: "e" },
    { ref: "1.1.10", sanskrit: "s", english: "e2" },
  ]);
  expect(m.map((p) => p.ref)).toEqual(["1.1.2", "1.1.10", "1.2.1"]);
  expect(m.find((p) => p.ref === "1.1.10")!.english).toBe("e2");
});

test("pid is deterministic and p-prefixed 6 hex", () => {
  expect(pid("rv:1.1.1")).toBe(pid("rv:1.1.1"));
  expect(pid("rv:1.1.1")).not.toBe(pid("rv:1.1.2"));
  expect(pid("rv:1.1.1")).toMatch(/^p-[0-9a-f]{6}$/);
});
