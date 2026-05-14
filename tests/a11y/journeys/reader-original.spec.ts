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

const JOURNEY = "reader-original";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);
// Ghalib has Urdu/arabic → ur-Arab + dir=rtl (Bang-e-Dara's script is "other"
// which renders as `ur` only — Ghalib gives the cleaner ur-Arab assertion).
const URDU_URL =
  "/works/mirza-ghalib-diwan-e-ghalib-74ed4c/01-aa-ke-meri-jaan-ko-qarar-nahin-hai/original/";
const SANSKRIT_URL = "/works/unknown-angirasa-smrti-2bf9d1/01/transliteration/";

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Reader (original language) accessibility", () => {
  test("Urdu original article is lang=ur-Arab dir=rtl", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.goto(URDU_URL);
    const article = page.locator("article.reader");
    await expect(article).toHaveAttribute("lang", "ur-Arab");
    await expect(article).toHaveAttribute("dir", "rtl");
  });

  test("Sanskrit transliteration article is lang=sa-Latn dir=ltr", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.goto(SANSKRIT_URL);
    const article = page.locator("article.reader");
    await expect(article).toHaveAttribute("lang", "sa-Latn");
    await expect(article).toHaveAttribute("dir", "ltr");
  });

  test("axe-core finds no violations on Urdu original", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.goto(URDU_URL);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("synthetic transcript dump (Urdu original)", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.goto(URDU_URL);
    const entries = await captureSyntheticTranscript(page);
    const md =
      `# Synthetic AT-tree transcript — ${JOURNEY} (Urdu)\n\n` +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(2);
  });

  test("VoiceOver transcript dump (Urdu)", async ({ page }, info) => {
    test.skip(info.project.name !== "voiceover", "macOS only");
    await page.goto(URDU_URL);
    const sr = await startScreenReader();
    await sr.interact();
    for (let i = 0; i < 20; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-voiceover.md"),
      `# VoiceOver transcript — ${JOURNEY} (Urdu)\n\n` +
        (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });

  test("NVDA transcript dump (Urdu)", async ({ page }, info) => {
    test.skip(info.project.name !== "nvda", "Windows only");
    await page.goto(URDU_URL);
    const sr = await startScreenReader();
    for (let i = 0; i < 20; i++) await sr.next();
    writeFileSync(
      resolve(ARTIFACTS, "transcript-nvda.md"),
      `# NVDA transcript — ${JOURNEY} (Urdu)\n\n` + (await dumpScreenReaderTranscript(sr)),
    );
    await stopScreenReader();
  });
});
