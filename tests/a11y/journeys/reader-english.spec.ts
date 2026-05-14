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

const JOURNEY = "reader-english";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);
const URL = "/works/cynewulf-andreas-07b573/01/translation/";

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Reader (English translation) accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  test("axe-core finds no violations", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("chapter body is in an <article>", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const article = page.locator("article.reader");
    await expect(article).toHaveCount(1);
  });

  test("reading-progress bar is aria-hidden", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const progress = page.locator("#reading-progress");
    await expect(progress).toHaveAttribute("aria-hidden", "true");
  });

  test("synthetic transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const entries = await captureSyntheticTranscript(page);
    const md =
      `# Synthetic AT-tree transcript — ${JOURNEY}\n\n` +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(2);
  });

  test("VoiceOver transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "voiceover", "macOS only");
    const sr = await startScreenReader();
    await sr.interact();
    for (let i = 0; i < 20; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-voiceover.md"),
      `# VoiceOver transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });

  test("NVDA transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "nvda", "Windows only");
    const sr = await startScreenReader();
    for (let i = 0; i < 20; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-nvda.md"),
      `# NVDA transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });
});
