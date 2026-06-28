#!/usr/bin/env bun
/**
 * backfill-source.ts
 *
 * Backfills source_url in chapter meta.json (variants[*].source_url) and in
 * any translation.md / transliteration.md / original.md frontmatter that
 * already has a `source_url:` key, for every work whose ALL chapter variants
 * currently have source_url === null or missing.
 *
 * Rules:
 *   1. thothica_role === "gretil-root"  → "http://gretil.sub.uni-goettingen.de/gretil.html"
 *   2. author in {Charles Comte, Charles Dunoyer, Johann Gottlieb Fichte}
 *      → "https://davidmhart.com"
 *   3. author in {Mirza Ghalib, Sheikh Ibrahim Zauq} → LEAVE null (skip)
 *   4. Anything else → logged as "unmatched" without modification
 *
 * Already-fixed works (rigveda-aufrecht, valmiki-ramayana, atharvaveda-ps,
 * samaveda) are detected automatically because they will have non-null
 * source_url values and thus won't appear in the null-works list.
 *
 * Does NOT modify corpus/manifest.json.
 * Does NOT git commit.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const MANIFEST_PATH = join(CORPUS, "manifest.json");
const WORKS_DIR = join(CORPUS, "works");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GRETIL_URL = "http://gretil.sub.uni-goettingen.de/gretil.html";
const DAVIDMHART_URL = "https://davidmhart.com";

const DAVIDMHART_AUTHORS = new Set([
  "Charles Comte",
  "Charles Dunoyer",
  "Johann Gottlieb Fichte",
]);

const LEAVE_NULL_AUTHORS = new Set(["Mirza Ghalib", "Sheikh Ibrahim Zauq"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  thothica_role?: string;
}

interface Variant {
  file: string;
  source_url: string | null;
  [key: string]: unknown;
}

interface ChapterMeta {
  variants: Variant[];
  [key: string]: unknown;
}

function loadManifest(): ManifestWork[] {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);
  return manifest.works as ManifestWork[];
}

function getChapterSlugs(workSlug: string): string[] {
  const chaptersDir = join(WORKS_DIR, workSlug, "chapters");
  if (!existsSync(chaptersDir)) return [];
  return readdirSync(chaptersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function loadMeta(workSlug: string, chapterSlug: string): ChapterMeta | null {
  const metaPath = join(WORKS_DIR, workSlug, "chapters", chapterSlug, "meta.json");
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf-8")) as ChapterMeta;
}

function saveMeta(workSlug: string, chapterSlug: string, meta: ChapterMeta): void {
  const metaPath = join(WORKS_DIR, workSlug, "chapters", chapterSlug, "meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/** Returns true if every variant's source_url is null/undefined. */
function allVariantsNull(meta: ChapterMeta): boolean {
  return meta.variants.every((v) => v.source_url == null);
}

/**
 * Update the `source_url:` frontmatter field in a markdown file if it exists.
 * Only edits files that already have a `source_url:` key in the YAML front matter
 * (between the opening --- and closing --- delimiters).
 */
function patchMarkdownSourceUrl(
  workSlug: string,
  chapterSlug: string,
  filename: string,
  url: string
): boolean {
  const filePath = join(WORKS_DIR, workSlug, "chapters", chapterSlug, filename);
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, "utf-8");

  // Check if frontmatter block exists and contains source_url
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;
  if (!fmMatch[1].includes("source_url:")) return false;

  // Replace the source_url line (handles null, empty string, or quoted value)
  const updated = content.replace(
    /^(source_url:\s*).*$/m,
    `$1"${url}"`
  );

  if (updated === content) return false;
  writeFileSync(filePath, updated, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Result {
  changed: Array<{ slug: string; title: string; url: string; metaFilesEdited: number; mdFilesEdited: number }>;
  skippedLeaveNull: Array<{ slug: string; author: string }>;
  unmatched: Array<{ slug: string; author: string; role: string | undefined }>;
}

function main(): void {
  const works = loadManifest();
  const result: Result = {
    changed: [],
    skippedLeaveNull: [],
    unmatched: [],
  };

  for (const work of works) {
    const { slug, title, author, thothica_role } = work;

    // Skip works whose directory doesn't exist in corpus
    const workDir = join(WORKS_DIR, slug);
    if (!existsSync(workDir)) continue;

    // Collect all chapter meta files and check if ALL variants are null
    const chapterSlugs = getChapterSlugs(slug);
    if (chapterSlugs.length === 0) continue;

    const metas: Array<{ chapterSlug: string; meta: ChapterMeta }> = [];
    let allNull = true;

    for (const chapterSlug of chapterSlugs) {
      const meta = loadMeta(slug, chapterSlug);
      if (!meta) continue;
      if (!allVariantsNull(meta)) {
        allNull = false;
        break;
      }
      metas.push({ chapterSlug, meta });
    }

    if (!allNull || metas.length === 0) continue;

    // Determine the URL to apply
    let targetUrl: string | null = null;

    if (thothica_role === "gretil-root") {
      targetUrl = GRETIL_URL;
    } else if (DAVIDMHART_AUTHORS.has(author)) {
      targetUrl = DAVIDMHART_URL;
    } else if (LEAVE_NULL_AUTHORS.has(author)) {
      result.skippedLeaveNull.push({ slug, author });
      continue;
    } else {
      result.unmatched.push({ slug, author, role: thothica_role });
      continue;
    }

    // Apply the URL to every chapter's meta.json
    let metaFilesEdited = 0;
    let mdFilesEdited = 0;

    for (const { chapterSlug, meta } of metas) {
      for (const variant of meta.variants) {
        variant.source_url = targetUrl;
      }
      saveMeta(slug, chapterSlug, meta);
      metaFilesEdited++;

      // Also patch any md files that already have source_url in frontmatter
      for (const filename of ["translation.md", "transliteration.md", "original.md"]) {
        if (patchMarkdownSourceUrl(slug, chapterSlug, filename, targetUrl)) {
          mdFilesEdited++;
        }
      }
    }

    result.changed.push({ slug, title, url: targetUrl, metaFilesEdited, mdFilesEdited });
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  const totalMeta = result.changed.reduce((acc, r) => acc + r.metaFilesEdited, 0);
  const totalMd = result.changed.reduce((acc, r) => acc + r.mdFilesEdited, 0);

  console.log("\n=== BACKFILL SOURCE URL REPORT ===\n");

  console.log(`Works changed: ${result.changed.length}`);
  console.log(`Total meta.json files edited: ${totalMeta}`);
  console.log(`Total markdown files edited: ${totalMd}`);
  console.log("");

  if (result.changed.length > 0) {
    console.log("--- CHANGED WORKS ---");
    for (const r of result.changed) {
      console.log(`  [${r.metaFilesEdited} meta${r.mdFilesEdited > 0 ? `, ${r.mdFilesEdited} md` : ""}] ${r.slug}`);
      console.log(`    URL: ${r.url}`);
    }
    console.log("");
  }

  if (result.skippedLeaveNull.length > 0) {
    console.log("--- LEFT NULL (in-house transcriptions — Ghalib / Zauq) ---");
    for (const r of result.skippedLeaveNull) {
      console.log(`  ${r.slug}  (author: ${r.author})`);
    }
    console.log("");
  }

  if (result.unmatched.length > 0) {
    console.log("--- UNMATCHED (null but no rule applies — NOT changed) ---");
    for (const r of result.unmatched) {
      console.log(`  ${r.slug}  (author: ${r.author}, role: ${r.role ?? "none"})`);
    }
    console.log("");
  }

  console.log("=== DONE ===\n");
}

main();
