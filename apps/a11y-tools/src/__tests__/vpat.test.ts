import { describe, expect, it } from "bun:test";
import { renderVpat } from "../generate/vpat";
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
    {
      id: "3.1.5",
      name: "Reading Level",
      level: "AAA",
      status: "not-applicable",
      exception: "content-type",
      notes: "graduate philosophy",
      evidence: [],
      commit: "abc1234",
    },
  ],
  section_508: [
    { id: "302.1", name: "Without Vision", status: "supports", notes: "ok", evidence: [] },
  ],
  en_301_549: [
    {
      clause: "5.2",
      name: "Activation of accessibility features",
      status: "supports",
      notes: "ok",
      evidence: [],
    },
  ],
};

describe("renderVpat", () => {
  it("includes the WCAG criteria table with the criterion ID", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("1.1.1");
    expect(html).toContain("Non-text Content");
  });
  it("renders status with a status-* class for screen-readable styling", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("status-supports");
    expect(html).toContain("status-not-applicable");
  });
  it("includes the exceptions block for content-type exceptions", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("3.1.5");
    expect(html).toContain("content-type");
  });
  it("includes Section 508 + EN 301 549 rows", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("302.1");
    expect(html).toContain("5.2");
  });
});
