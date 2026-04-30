import { describe, expect, test } from "bun:test";
import { computeNPMI } from "./npmi";

describe("NPMI", () => {
  test("perfect collocation (always together when present, non-universal) gives NPMI close to 1.0", () => {
    // Critical: include at least one doc WITHOUT the pair, otherwise both
    // terms have P=1 and the NPMI math degenerates (PMI=0, denom=0). NPMI's
    // strongest signal is when the pair is correlated but not universal.
    const docs = [
      ["fish", "spit", "alpha"],
      ["fish", "spit", "beta"],
      ["fish", "spit", "gamma"],
      ["delta", "epsilon"], // pair absent
    ];
    const out = computeNPMI(docs, { minJointCount: 2 });
    const fishSpit = out.find((c) => c.a === "fish" && c.b === "spit");
    expect(fishSpit).toBeDefined();
    expect(fishSpit!.npmi).toBeGreaterThan(0.9);
  });

  test("universal pair (in every doc) is dropped — NPMI degenerate (0/0)", () => {
    // When P(a)=P(b)=P(a,b)=1, PMI=0 and -log(P)=0 → 0/0; we filter it out
    // rather than emit NaN. Honest about the degeneracy.
    const docs = [
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
    ];
    const out = computeNPMI(docs, { minJointCount: 2 });
    // No (a,b) entry — degenerate input filtered, not emitted with NaN
    expect(out.find((c) => c.a === "a" && c.b === "b")).toBeUndefined();
  });

  test("orthogonal pairs (never co-occur) produce no NPMI entry", () => {
    const docs = [
      ["alpha", "beta", "gamma"],
      ["delta", "epsilon", "zeta"],
    ];
    const out = computeNPMI(docs, { minJointCount: 1 });
    const ad = out.find((c) => c.a === "alpha" && c.b === "delta");
    expect(ad).toBeUndefined();
  });

  test("minJointCount filter drops rare co-occurrences", () => {
    const docs = [["a", "b"], ["c", "d"], ["e", "f"]];
    expect(computeNPMI(docs, { minJointCount: 3 })).toEqual([]);
  });

  test("output sorted descending by NPMI", () => {
    const docs = [
      ["a", "b", "c"],
      ["a", "b", "d"],
      ["a", "b", "e"],
      ["c", "d"],
    ];
    const out = computeNPMI(docs, { minJointCount: 2 });
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i]!.npmi).toBeGreaterThanOrEqual(out[i + 1]!.npmi);
    }
  });

  test("joint_count is reported correctly", () => {
    const docs = [
      ["x", "y", "z"],
      ["x", "y"],
      ["x", "z"],
    ];
    const out = computeNPMI(docs, { minJointCount: 1 });
    const xy = out.find((c) => c.a === "x" && c.b === "y");
    expect(xy?.joint_count).toBe(2);
  });

  test("NPMI is always in [-1, 1]", () => {
    const docs = [
      ["a", "b", "c"],
      ["a", "b"],
      ["c"],
      ["d", "e"],
    ];
    const out = computeNPMI(docs, { minJointCount: 1 });
    for (const c of out) {
      expect(c.npmi).toBeGreaterThanOrEqual(-1);
      expect(c.npmi).toBeLessThanOrEqual(1);
    }
  });

  test("empty input → empty output", () => {
    expect(computeNPMI([], { minJointCount: 1 })).toEqual([]);
  });
});
