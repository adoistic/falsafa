import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidence } from "../verify";

const td = mkdtempSync(join(tmpdir(), "a11y-verify-"));
writeFileSync(
  join(td, "sample.ts"),
  "// line 1\n--rule: token;\n// line 3\n",
);

describe("verifyEvidence", () => {
  it("passes when lines range fits file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", lines: "1-3" },
      td,
    );
    expect(errs).toEqual([]);
  });

  it("fails when lines range exceeds file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", lines: "1-99" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/lines/);
  });

  it("passes when anchor string appears in file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", anchor: "--rule" },
      td,
    );
    expect(errs).toEqual([]);
  });

  it("fails when anchor string is absent", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", anchor: "--missing" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/anchor/);
  });

  it("fails when file missing", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "does-not-exist.ts", lines: "1" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/not found|ENOENT/);
  });

  it("skips artifact-kind evidence (artifacts written by CI)", async () => {
    const errs = await verifyEvidence(
      { kind: "artifact", path: "docs/accessibility/test-runs/x/latest/transcript.md" },
      td,
    );
    expect(errs).toEqual([]);
  });
});
