import { describe, expect, it } from "bun:test";
import { renderMatrixModule } from "../generate/matrix";
import type { ConformanceDoc } from "../types";

const FIXTURE_DOC: ConformanceDoc = {
  meta: {
    standard: "WCAG 2.2",
    conformance_level: "AA",
    partial_aaa: true,
    last_review: "2026-05-14",
    next_review: "2026-08-14",
    contact: "a@b.com",
    vpat_version: "2.5 INT",
    jurisdictions: ["us"],
  },
  criteria: [
    {
      id: "1.1.1",
      name: "Non-text Content",
      level: "A",
      status: "supports",
      notes: "ok",
      evidence: [{ kind: "source", path: "x.ts", lines: "1" }],
      commit: "abc1234",
    },
  ],
  section_508: [],
  en_301_549: [],
};

describe("renderMatrixModule", () => {
  it("emits a TS module that exports CONFORMANCE", () => {
    const ts = renderMatrixModule(FIXTURE_DOC);
    expect(ts).toContain("export const CONFORMANCE");
    expect(ts).toContain('"1.1.1"');
  });
  it("includes a 'do not edit' header", () => {
    const ts = renderMatrixModule(FIXTURE_DOC);
    expect(ts).toMatch(/generated|do not edit/i);
  });
});
