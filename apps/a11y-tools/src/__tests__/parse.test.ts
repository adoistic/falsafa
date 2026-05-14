import { describe, expect, it } from "bun:test";
import { parseConformanceDocText } from "../parse";

const MIN_DOC = `
meta:
  standard: WCAG 2.2
  conformance_level: AA
  partial_aaa: true
  last_review: "2026-05-14"
  next_review: "2026-08-14"
  contact: a@b.com
  vpat_version: "2.5 INT"
  jurisdictions: [india, eu, us]
criteria:
  - id: "1.1.1"
    name: Non-text Content
    level: A
    status: supports
    notes: ok
    evidence:
      - kind: source
        path: x.ts
        lines: "1-10"
    commit: abc1234
section_508: []
en_301_549: []
`;

describe("parseConformanceDocText", () => {
  it("parses a valid YAML string", () => {
    const doc = parseConformanceDocText(MIN_DOC);
    expect(doc.criteria.length).toBe(1);
    expect(doc.criteria[0]!.id).toBe("1.1.1");
  });

  it("throws on invalid YAML structure", () => {
    expect(() => parseConformanceDocText("criteria: not-an-array")).toThrow();
  });

  it("throws on schema violation with location info", () => {
    const bad = MIN_DOC.replace("level: A", "level: ZZZ");
    expect(() => parseConformanceDocText(bad)).toThrow(/level/);
  });
});
