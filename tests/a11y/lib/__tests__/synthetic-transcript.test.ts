import { describe, expect, it } from "bun:test";
import { formatTranscriptLine } from "../synthetic-transcript";

describe("formatTranscriptLine", () => {
  it("formats button with name + role", () => {
    expect(
      formatTranscriptLine(1, { role: "button", name: "Search Falsafa", state: [] }),
    ).toBe('[1] button: "Search Falsafa"');
  });
  it("includes state when present", () => {
    expect(
      formatTranscriptLine(2, { role: "checkbox", name: "Dark mode", state: ["checked"] }),
    ).toBe('[2] checkbox, checked: "Dark mode"');
  });
  it("handles missing name with role only", () => {
    expect(formatTranscriptLine(3, { role: "img", name: "", state: [] })).toBe("[3] img");
  });
});
