#!/usr/bin/env bun
/**
 * Build corpus/mcp-index.json — a compact, per-work chapter listing.
 *
 * The MCP resolves chapters by reading the chapters/ directory (readdirSync).
 * That works locally but not over HTTP: a remote client can't `ls` a URL.
 * This index gives every work's chapters, with their chapter_slug and variant
 * file names, so a remote (fetch-based) corpus can enumerate and build file
 * URLs with no directory listing. Shipped in the corpus tarball and served on
 * the CDN, so local and remote modes share one code path.
 *
 *   bun run apps/mcp/scripts/build-mcp-index.ts
 *   → writes corpus/mcp-index.json  (version 1)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CORPUS = resolve(import.meta.dir, "..", "..", "..", "corpus");
const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf-8"));

interface ChapterEntry {
  n: number; // chapter_number
  slug: string; // chapter_slug (directory name)
  def: string; // default_variant file
  wiki: boolean; // has a wiki dir card for this chapter
  variants: { type: string; file: string; lang: string }[];
}

const index: Record<string, ChapterEntry[]> = {};
let works = 0, chapters = 0, missing = 0;

for (const w of manifest.works) {
  const chDir = join(CORPUS, "works", w.slug, "chapters");
  if (!existsSync(chDir)) { missing++; continue; }
  const wikiDir = join(CORPUS, "works", w.slug, "wiki");
  const hasWikiDir = existsSync(wikiDir);
  const entries: ChapterEntry[] = [];
  for (const cslug of readdirSync(chDir)) {
    const cPath = join(chDir, cslug);
    if (!statSync(cPath).isDirectory()) continue;
    const metaPath = join(cPath, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    entries.push({
      n: meta.chapter_number,
      slug: meta.chapter_slug,
      def: meta.default_variant,
      wiki: hasWikiDir && existsSync(join(wikiDir, `${meta.chapter_slug}.card.md`)),
      variants: (meta.variants ?? []).map((v: any) => ({
        type: v.content_type,
        file: v.file,
        lang: (v.language ?? "").toLowerCase(),
      })),
    });
    chapters++;
  }
  entries.sort((a, b) => a.n - b.n);
  index[w.slug] = entries;
  works++;
}

const out = {
  version: 1,
  generated_from_manifest_works: manifest.works.length,
  works,
  chapters,
  chapters_by_work: index,
};
writeFileSync(join(CORPUS, "mcp-index.json"), JSON.stringify(out));
const bytes = Buffer.byteLength(JSON.stringify(out));
console.log(
  `build-mcp-index: ${works} works, ${chapters} chapters -> corpus/mcp-index.json (${(bytes / 1e6).toFixed(1)} MB)` +
    (missing ? `; ${missing} works had no chapters/ dir` : ""),
);
