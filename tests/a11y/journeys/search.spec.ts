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

const JOURNEY = "search";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Search dialog accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await page.waitForSelector("#search-input:focus");
  });

  test("axe-core finds no violations", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("input has role=combobox + aria-expanded=true", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const input = page.locator("#search-input");
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-expanded", "true");
  });

  test("ArrowDown moves aria-activedescendant", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const input = page.locator("#search-input");
    await input.fill("manu");
    await page.waitForSelector('[role="option"]', { timeout: 5000 });
    await input.press("ArrowDown");
    const active = await input.getAttribute("aria-activedescendant");
    expect(active).toMatch(/^search-result-/);
  });

  test("results list has role=listbox + aria-label", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const list = page.locator("#search-results");
    await expect(list).toHaveAttribute("role", "listbox");
    await expect(list).toHaveAttribute("aria-label", /.+/);
  });

  test("status string has aria-live=polite", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const status = page.locator("[data-search-status]");
    await expect(status).toHaveAttribute("aria-live", "polite");
  });

  test("synthetic transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const entries = await captureSyntheticTranscript(page);
    const md =
      `# Synthetic AT-tree transcript — ${JOURNEY}\n\n` +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("VoiceOver transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "voiceover", "macOS only");
    const sr = await startScreenReader();
    await sr.interact();
    for (let i = 0; i < 15; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-voiceover.md"),
      `# VoiceOver transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });

  test("NVDA transcript dump", async ({}, info) => {
    test.skip(info.project.name !== "nvda", "Windows only");
    const sr = await startScreenReader();
    for (let i = 0; i < 15; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-nvda.md"),
      `# NVDA transcript — ${JOURNEY}\n\n` + (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });
});
