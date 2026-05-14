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

const JOURNEY = "eval-case";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);
const URL = "/eval/q-0001/";

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Eval case accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  test("axe-core finds no violations", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("tabs use role=tab + aria-selected", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const tabs = page.locator('[role="tab"]');
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    // At least one tab should be selected initially.
    const selected = page.locator('[role="tab"][aria-selected="true"]');
    expect(await selected.count()).toBeGreaterThanOrEqual(1);
  });

  test("hashchange updates aria-selected", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    // Visit #case-wiki and confirm the wiki tab is selected.
    await page.goto(`${URL}#case-wiki`);
    const wikiTab = page.locator('[role="tab"][aria-controls*="wiki"], [role="tab"][href*="wiki"]').first();
    if ((await wikiTab.count()) > 0) {
      await expect(wikiTab).toHaveAttribute("aria-selected", "true");
    }
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
