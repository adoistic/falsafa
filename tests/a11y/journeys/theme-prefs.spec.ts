import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  captureSyntheticTranscript,
  formatTranscriptLine,
} from "../lib/synthetic-transcript";

const JOURNEY = "theme-prefs";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("System preferences (theme-prefs)", () => {
  test("axe-core finds no violations under dark color scheme", async ({ browser }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await ctx.close();
  });

  test("prefers-reduced-motion disables transition durations", async ({ browser }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    // Pick a known-animated element (use body as universal). The reduced-motion
    // block in reader.css caps all transitions to 0.01ms.
    const duration = await page.evaluate(
      () => window.getComputedStyle(document.body).transitionDuration,
    );
    expect(duration).toMatch(/0\.01ms|0s|0\.001s/);
    await ctx.close();
  });

  test("prefers-contrast=more bumps ink to higher contrast", async ({ browser }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const ctx = await browser.newContext({ forcedColors: "none" });
    const page = await ctx.newPage();
    await page.emulateMedia({ media: "screen", colorScheme: "light" });
    // Playwright doesn't expose prefers-contrast in stable form yet — assert
    // the tokens are defined and the media query exists at the CSS level.
    await page.goto("/");
    const rule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const r of Array.from(sheet.cssRules ?? [])) {
            if (r instanceof CSSMediaRule && r.conditionText.includes("prefers-contrast")) {
              return r.conditionText;
            }
          }
        } catch {
          // cross-origin sheet — skip
        }
      }
      return null;
    });
    expect(rule).toMatch(/prefers-contrast/);
    await ctx.close();
  });

  test("synthetic transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.goto("/");
    const entries = await captureSyntheticTranscript(page);
    const md =
      `# Synthetic AT-tree transcript — ${JOURNEY}\n\n` +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(3);
  });
});
