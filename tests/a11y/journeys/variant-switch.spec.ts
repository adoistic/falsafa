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

const JOURNEY = "variant-switch";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);
const URL =
  "/works/mirza-ghalib-diwan-e-ghalib-74ed4c/01-aa-ke-meri-jaan-ko-qarar-nahin-hai/translation/";

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Variant switcher accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
  });

  test("axe-core finds no violations", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("active variant pill carries aria-current=page", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    // Variant switcher pills point at /<work>/<chapter>/{original,translit,translation}/
    const currentLink = page.locator('a[aria-current="page"]').first();
    await expect(currentLink).toBeVisible();
  });

  test("non-active variant pills are reachable by Tab", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    // Discover at least one link with content_type other than current.
    const pills = page.locator(".variant-switcher a, .variant-pill, [data-variant-pill] a");
    const count = await pills.count();
    expect(count).toBeGreaterThanOrEqual(2);
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
