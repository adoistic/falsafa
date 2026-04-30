import { describe, expect, test } from "bun:test";
import {
  armOfModelId,
  isAbMode,
  armVerdicts,
  filterByCompare,
} from "../eval-arms";
import type { CompareMode } from "../eval-arms";
import type { EvalCase } from "../eval-types";

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

function caseFixture(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "q-test",
    category: "thematic",
    difficulty: "medium",
    prompt: "test prompt",
    expected_works: [],
    results: {},
    ...overrides,
  };
}

describe("armVerdicts", () => {
  test("returns null for both arms when neither has results", () => {
    const c = caseFixture();
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: null, wiki: null });
  });

  test("returns baseline=true, wiki=null when only baseline passed", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "ok",
          tool_calls: [],
          citations: [],
          duration_ms: 0,
          from_run: "x",
          mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: true, wiki: null });
  });

  test("returns baseline=false, wiki=true on a flip-to-pass case", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "x", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "b", mechanical_pass: false,
        },
        "grok-4.1-fast__wiki": {
          answer: "y", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "w", mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: false, wiki: true });
  });

  test("returns both true when both arms passed", () => {
    const c = caseFixture({
      results: {
        "grok-4.1-fast__baseline": {
          answer: "x", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "b", mechanical_pass: true,
        },
        "grok-4.1-fast__wiki": {
          answer: "y", tool_calls: [], citations: [], duration_ms: 0,
          from_run: "w", mechanical_pass: true,
        },
      },
    });
    expect(armVerdicts(c, "grok-4.1-fast__baseline", "grok-4.1-fast__wiki"))
      .toEqual({ baseline: true, wiki: true });
  });

  test("returns null when arm-model-id is undefined", () => {
    const c = caseFixture();
    expect(armVerdicts(c, undefined, undefined))
      .toEqual({ baseline: null, wiki: null });
  });
});

describe("filterByCompare", () => {
  // Each row: [baseline, wiki, mode, expected]
  const cases: Array<[boolean | null, boolean | null, CompareMode, boolean]> = [
    // mode=all — everything passes
    [true,  true,  "all", true],
    [false, false, "all", true],
    [true,  null,  "all", true],
    [null,  null,  "all", true],

    // mode=flips-pass — baseline=false, wiki=true
    [false, true,  "flips-pass", true],
    [true,  true,  "flips-pass", false],
    [false, false, "flips-pass", false],
    [false, null,  "flips-pass", false],
    [null,  true,  "flips-pass", false],

    // mode=flips-fail — baseline=true, wiki=false
    [true,  false, "flips-fail", true],
    [true,  true,  "flips-fail", false],
    [false, false, "flips-fail", false],
    [true,  null,  "flips-fail", false],

    // mode=both-pass — baseline=true AND wiki=true
    [true,  true,  "both-pass", true],
    [true,  false, "both-pass", false],
    [false, true,  "both-pass", false],
    [true,  null,  "both-pass", false],

    // mode=both-fail — baseline=false AND wiki=false
    [false, false, "both-fail", true],
    [true,  false, "both-fail", false],
    [false, true,  "both-fail", false],
    [false, null,  "both-fail", false],

    // mode=pending-wiki — wiki is null
    [true,  null,  "pending-wiki", true],
    [false, null,  "pending-wiki", true],
    [null,  null,  "pending-wiki", true],
    [true,  true,  "pending-wiki", false],
    [false, false, "pending-wiki", false],
  ];

  for (const [baseline, wiki, mode, expected] of cases) {
    test(`b=${baseline}, w=${wiki}, mode=${mode} -> ${expected}`, () => {
      expect(filterByCompare({ baseline, wiki }, mode)).toBe(expected);
    });
  }
});
