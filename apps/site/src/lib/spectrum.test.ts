import { describe, expect, test } from "bun:test";
import { buildSpectrum, BAR_MAX_PX, BAR_MIN_PX } from "./spectrum";
import type { Manifest } from "./corpus";

/** Build a fake manifest `eras` map: { slug: workCount }. */
function eras(counts: Record<string, number>): Manifest["eras"] {
  const out: Manifest["eras"] = {};
  for (const [slug, n] of Object.entries(counts)) {
    out[slug] = { name: slug, works: Array.from({ length: n }, (_, i) => `w${i}`) };
  }
  return out;
}

describe("buildSpectrum", () => {
  test("orders eras chronologically regardless of manifest key order", () => {
    const bars = buildSpectrum(eras({ "20th-century": 5, ancient: 2, imperial: 9 }));
    expect(bars.map((b) => b.slug)).toEqual(["ancient", "imperial", "20th-century"]);
  });

  test("peak era (max count) gets full height, fraction 1, and isPeak", () => {
    const bars = buildSpectrum(eras({ ancient: 2, imperial: 10 }));
    const imperial = bars.find((b) => b.slug === "imperial")!;
    expect(imperial.isPeak).toBe(true);
    expect(imperial.heightPx).toBe(BAR_MAX_PX);
    expect(imperial.fraction).toBe(1);
  });

  test("tiny eras are floored to BAR_MIN_PX so they stay visible", () => {
    const bars = buildSpectrum(eras({ ancient: 1, imperial: 1000 }));
    const ancient = bars.find((b) => b.slug === "ancient")!;
    expect(ancient.heightPx).toBe(BAR_MIN_PX);
  });

  test("excludes zero-work eras and unknown/untimed eras", () => {
    const bars = buildSpectrum(eras({ ancient: 3, unknown: 4, medieval: 0 }));
    expect(bars.map((b) => b.slug)).toEqual(["ancient"]);
  });

  test("returns an empty array when no eras have works", () => {
    expect(buildSpectrum(eras({}))).toEqual([]);
  });
});
