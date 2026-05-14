import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dumpScreenReaderTranscript,
  startScreenReader,
  stopScreenReader,
} from "../lib/guidepup-helpers";
import {
  captureSyntheticTranscript,
  formatTranscriptLine,
} from "../lib/synthetic-transcript";

const JOURNEY = "homepage";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Homepage accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("axe-core finds no violations (synthetic project only)", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "axe runs in synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("skip-link is present + reachable on first Tab", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const text = await focused.textContent();
    expect(text?.trim().toLowerCase()).toContain("skip");
  });

  test("landmarks present", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    expect(await page.locator("header").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("main").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("footer").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("nav").count()).toBeGreaterThanOrEqual(1);
  });

  test("synthetic transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const entries = await captureSyntheticTranscript(page);
    const md =
      `# Synthetic AT-tree transcript — ${JOURNEY}\n\n` +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(3);
  });

  test("VoiceOver transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "voiceover", "macOS only");
    const sr = await startScreenReader();
    await sr.interact();
    for (let i = 0; i < 20; i++) await sr.next();
    const md =
      `# VoiceOver transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr));
    writeFileSync(resolve(ARTIFACTS, "transcript-voiceover.md"), md);
    await stopScreenReader();
  });

  test("NVDA transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "nvda", "Windows only");
    const sr = await startScreenReader();
    for (let i = 0; i < 20; i++) await sr.next();
    const md = `# NVDA transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr));
    writeFileSync(resolve(ARTIFACTS, "transcript-nvda.md"), md);
    await stopScreenReader();
  });
});
