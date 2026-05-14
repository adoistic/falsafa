import { describe, expect, it } from "bun:test";
import { auditPairs, contrastRatio, parseTokens } from "../a11y-contrast-audit";

describe("contrastRatio", () => {
  it("black on white = 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("white on white = 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });
  it("hex parsing handles short form", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 0);
  });
});

describe("parseTokens", () => {
  it("extracts vars from :root", () => {
    const css = `:root {\n  --paper: #faf6ee;\n  --ink: #1b1612;\n}\n`;
    const out = parseTokens(css);
    expect(out.light["--paper"]).toBe("#faf6ee");
    expect(out.light["--ink"]).toBe("#1b1612");
  });
  it("extracts vars from [data-theme='dark']", () => {
    const css = `:root { --paper: #fff; }\n[data-theme="dark"] {\n  --paper: #000;\n}`;
    const out = parseTokens(css);
    expect(out.light["--paper"]).toBe("#fff");
    expect(out.dark!["--paper"]).toBe("#000");
  });
});

describe("auditPairs", () => {
  it("flags a UI pair below 3:1", () => {
    const tokens = { light: { "--paper": "#faf6ee", "--rule": "#e8e0d2" } };
    const result = auditPairs(tokens);
    const fail = result.failures.find(
      (f) => f.theme === "light" && f.fg === "--rule" && f.bg === "--paper",
    );
    expect(fail).toBeDefined();
    expect(fail!.ratio).toBeLessThan(3);
  });
  it("passes when ratios meet minimum", () => {
    // #767676 = 4.54:1 against #ffffff, satisfies both 3:1 UI and 4.5:1 text minimums.
    const tokens = { light: { "--paper": "#ffffff", "--ink": "#000000", "--rule": "#767676" } };
    const result = auditPairs(tokens);
    expect(result.failures).toEqual([]);
  });
});
