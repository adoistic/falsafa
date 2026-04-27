#!/usr/bin/env bun
/**
 * Pre-build step: build corpus/paragraph-index.json — the phone book
 * that maps every paragraph_id → which work + chapter + variant it
 * lives in.
 *
 * Why we need this:
 *   The model's tool calls return paragraph IDs like "p-be2857" along
 *   with their work_slug/chapter_slug context. The model then writes
 *   markdown citations using those IDs. If the model ever leaks a raw
 *   "p-xxxxxx" into final answer prose without context (despite the
 *   system prompt forbidding it), the defensive linkifier in
 *   MarkdownView can use this index to repair the citation into a
 *   real link. Without the index, the linkifier has no way to know
 *   which work/chapter the orphaned ID points at.
 *
 *   Built once at predev/prebuild time, fetched once on first BYOK
 *   answer render. ~30K paragraphs × ~80 bytes per entry → ~2.4 MB
 *   uncompressed, ~400 KB gzipped. Fine to ship as a static asset.
 *
 * Output shape:
 *   {
 *     "p-be2857": { "work": "charles-comte-...", "chapter": "00-preface", "variant": "original" },
 *     ...
 *   }
 *
 *   The variant key is the variant filename minus ".md" (e.g.
 *   "original.md" → "original"). Same key the URL helper uses.
 *
 * Idempotent: re-runs on every build, overwrites the index file.
 * Safe to run when the corpus is empty (writes "{}").
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(__dirname, "..", "..", "..", "corpus");
const worksRoot = join(corpusRoot, "works");
const outPath = join(corpusRoot, "paragraph-index.json");

if (!existsSync(worksRoot)) {
  console.error(`build-paragraph-index: corpus/works not found at ${worksRoot}`);
  process.exit(1);
}

interface IndexEntry {
  /** Work slug — directory name under corpus/works/. */
  work: string;
  /** Chapter slug — directory name under corpus/works/<work>/chapters/. */
  chapter: string;
  /**
   * Variant key — the variant's `content_type` from meta.json (e.g.
   * "original", "translation", "transliteration"). This is what the
   * /works/[slug]/[chapter]/[variant] route accepts, NOT the file
   * basename. They usually match, but a few chapters have a file like
   * `translation-2.md` whose content_type is still "translation".
   */
  variant: string;
}

interface ParagraphsFileEntry {
  id: string;
  offset?: number;
  text?: string;
}

interface ChapterMeta {
  variants: { file: string; content_type: string }[];
}

const index: Record<string, IndexEntry> = {};
let totalParagraphs = 0;
let dupes = 0;
let chaptersScanned = 0;
let worksScanned = 0;

for (const workSlug of readdirSync(worksRoot)) {
  const workDir = join(worksRoot, workSlug);
  if (!statSync(workDir).isDirectory()) continue;

  const chaptersDir = join(workDir, "chapters");
  if (!existsSync(chaptersDir)) continue;
  worksScanned++;

  for (const chapterSlug of readdirSync(chaptersDir)) {
    const chapterDir = join(chaptersDir, chapterSlug);
    if (!statSync(chapterDir).isDirectory()) continue;
    chaptersScanned++;

    // Read meta.json to map file basenames → content_types. The URL
    // route uses content_type; we MUST key the index that way so the
    // citation-url helper can build a working /works/.../variant link.
    const metaPath = join(chapterDir, "meta.json");
    const fileBasenameToContentType = new Map<string, string>();
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as ChapterMeta;
        for (const v of meta.variants ?? []) {
          if (v.file && v.content_type) {
            fileBasenameToContentType.set(v.file.replace(/\.md$/, ""), v.content_type);
          }
        }
      } catch (err) {
        console.warn(`build-paragraph-index: failed to read meta.json in ${chapterSlug}: ${err}`);
        // Fall back to assuming basename === content_type below.
      }
    }

    for (const file of readdirSync(chapterDir)) {
      if (!file.endsWith(".paragraphs.json")) continue;

      // "original.paragraphs.json" → file basename "original"
      const fileBasename = file.replace(/\.paragraphs\.json$/, "");
      // Map to content_type (the URL slug). Fall back to basename if
      // meta.json was missing or unreadable — same string in 99% of cases.
      const variant = fileBasenameToContentType.get(fileBasename) ?? fileBasename;

      let entries: ParagraphsFileEntry[];
      try {
        const raw = readFileSync(join(chapterDir, file), "utf8");
        entries = JSON.parse(raw) as ParagraphsFileEntry[];
        if (!Array.isArray(entries)) {
          console.warn(`build-paragraph-index: ${file} in ${chapterSlug} not an array — skipping`);
          continue;
        }
      } catch (err) {
        console.warn(`build-paragraph-index: failed to read ${file} in ${chapterSlug}: ${err}`);
        continue;
      }

      for (const entry of entries) {
        if (!entry || typeof entry.id !== "string" || !entry.id.startsWith("p-")) continue;
        totalParagraphs++;
        if (index[entry.id]) {
          // Paragraph IDs are content hashes, so duplicates ARE possible
          // when the same paragraph text appears verbatim in two places
          // (epigraphs reused across chapters, repeated blessings, etc.).
          // First occurrence wins — log a debug count but don't fail.
          dupes++;
          continue;
        }
        index[entry.id] = { work: workSlug, chapter: chapterSlug, variant };
      }
    }
  }
}

writeFileSync(outPath, JSON.stringify(index));

const sizeKb = Math.round(JSON.stringify(index).length / 1024);
console.log(
  `build-paragraph-index: ${totalParagraphs} paragraphs across ${chaptersScanned} chapters in ${worksScanned} works → ${outPath} (${sizeKb} KB${dupes ? `, ${dupes} duplicate IDs deduped — first occurrence kept` : ""})`,
);
