import { describe, expect, it } from "bun:test";
import { ConformanceDocSchema, EvidenceSchema } from "../types";

describe("ConformanceDoc schema", () => {
  it("accepts a minimal valid doc", () => {
    const doc = {
      meta: {
        standard: "WCAG 2.2",
        conformance_level: "AA",
        partial_aaa: true,
        last_review: "2026-05-14",
        next_review: "2026-08-14",
        contact: "accessibility@thothica.com",
        vpat_version: "2.5 INT",
        jurisdictions: ["india", "eu", "us"],
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
    expect(() => ConformanceDocSchema.parse(doc)).not.toThrow();
  });

  it("rejects criterion with status:supports but empty evidence", () => {
    const doc = {
      meta: {
        standard: "WCAG 2.2",
        conformance_level: "AA",
        partial_aaa: false,
        last_review: "2026-05-14",
        next_review: "2026-08-14",
        contact: "x@y.com",
        vpat_version: "2.5 INT",
        jurisdictions: ["us"],
      },
      criteria: [
        {
          id: "1.1.1",
          name: "X",
          level: "A",
          status: "supports",
          notes: "ok",
          evidence: [],
          commit: "abc1234",
        },
      ],
      section_508: [],
      en_301_549: [],
    };
    expect(() => ConformanceDocSchema.parse(doc)).toThrow(/at least one/);
  });

  it("rejects evidence with neither lines nor anchor", () => {
    const ev = { kind: "source", path: "x.ts" };
    expect(() => EvidenceSchema.parse(ev)).toThrow(/lines|anchor/);
  });

  it("accepts artifact evidence without lines/anchor", () => {
    const ev = { kind: "artifact", path: "test-runs/x/result.json" };
    expect(() => EvidenceSchema.parse(ev)).not.toThrow();
  });
});
