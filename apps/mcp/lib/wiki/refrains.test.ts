import { describe, expect, test } from "bun:test";
import { detectRefrains } from "./refrains";

describe("detectRefrains", () => {
  test("verbatim repeat detected", () => {
    const paragraphs = [
      { id: "p-001", tokens: ["this", "is", "my", "homeland"] },
      { id: "p-002", tokens: ["another", "verse"] },
      { id: "p-003", tokens: ["this", "is", "my", "homeland"] },
    ];
    const out = detectRefrains(paragraphs, { threshold: 0.05 });
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
    expect(out[0]!.cites).toEqual(["p-001", "p-003"]);
    expect(out[0]!.phrase).toBe("this is my homeland");
  });

  test("near-verbatim within threshold detected via transitivity", () => {
    const paragraphs = [
      { id: "p-001", tokens: ["the", "great", "souled", "sage"] },
      { id: "p-002", tokens: ["the", "great", "souled", "rishi"] },
      { id: "p-003", tokens: ["the", "great", "souled", "sage"] },
    ];
    // Tight threshold: only exact matches; p-001 ≡ p-003
    const tight = detectRefrains(paragraphs, { threshold: 0.05 });
    expect(tight).toHaveLength(1);
    expect(tight[0]!.count).toBe(2);

    // Loose threshold: 1 token out of 4 = 0.25, all three group transitively
    const loose = detectRefrains(paragraphs, { threshold: 0.3 });
    expect(loose).toHaveLength(1);
    expect(loose[0]!.count).toBe(3);
  });

  test("isolates produce no refrains", () => {
    const paragraphs = [
      { id: "p-001", tokens: ["alpha", "beta"] },
      { id: "p-002", tokens: ["gamma", "delta"] },
    ];
    expect(detectRefrains(paragraphs)).toEqual([]);
  });

  test("transitivity: (a,b) and (b,c) match → all three group", () => {
    const paragraphs = [
      { id: "p-001", tokens: ["x", "y", "z"] },
      { id: "p-002", tokens: ["x", "y", "z"] },
      { id: "p-003", tokens: ["x", "y", "z"] },
    ];
    const out = detectRefrains(paragraphs, { threshold: 0.05 });
    expect(out).toHaveLength(1);
    expect(out[0]!.cites.sort()).toEqual(["p-001", "p-002", "p-003"]);
  });

  test("phrase = longest common token-prefix across all members", () => {
    const paragraphs = [
      { id: "p-001", tokens: ["hello", "world", "foo"] },
      { id: "p-002", tokens: ["hello", "world", "bar"] },
    ];
    const out = detectRefrains(paragraphs, { threshold: 0.5 });
    expect(out[0]!.phrase).toBe("hello world");
  });

  test("output sorted by group size descending", () => {
    const paragraphs = [
      { id: "p-1", tokens: ["a", "b"] },
      { id: "p-2", tokens: ["a", "b"] },
      { id: "p-3", tokens: ["a", "b"] },
      { id: "p-4", tokens: ["c", "d"] },
      { id: "p-5", tokens: ["c", "d"] },
    ];
    const out = detectRefrains(paragraphs, { threshold: 0.05 });
    expect(out[0]!.count).toBe(3);
    expect(out[1]!.count).toBe(2);
  });

  test("empty input → empty output", () => {
    expect(detectRefrains([])).toEqual([]);
  });

  test("single paragraph → no refrains", () => {
    expect(detectRefrains([{ id: "p-1", tokens: ["a", "b"] }])).toEqual([]);
  });
});
