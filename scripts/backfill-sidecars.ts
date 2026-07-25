#!/usr/bin/env bun
/**
 * Backfill missing *.paragraphs.json sidecars across the corpus.
 *
 * Some works (mostly English originals ingested before the sidecar step
 * became universal) shipped variant .md files with no paragraph sidecar,
 * which leaves them without stable [p-XXXXXX] anchors: no MCP citations,
 * no FTS rows, no wiki cite handles, no reader deep links.
 *
 * Uses the exact algorithm from scripts/chapter-splitting/lib/orchestrator.ts
 * (computeParagraphIds): strip frontmatter, split the body on blank lines,
 * id = "p-" + first 6 hex chars of FNV-1a32 of the trimmed paragraph.
 * Also fills variant.paragraph_count in meta.json where it was 0/absent.
 *
 *   bun run scripts/backfill-sidecars.ts [--dry]
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CORPUS = resolve(import.meta.dir, "..", "corpus");
const dry = process.argv.includes("--dry");

function fnv1a32(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function computeParagraphIds(content: string): { id: string; offset: number; text: string }[] {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
  const ids: { id: string; offset: number; text: string }[] = [];
  let offset = 0;
  for (const para of paragraphs) {
    const trimmed = para.trim();
    ids.push({ id: `p-${fnv1a32(trimmed).slice(0, 6)}`, offset, text: trimmed });
    offset += trimmed.length + 2;
  }
  return ids;
}

/** Body without the leading --- frontmatter block (mirrors convert.ts input). */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(raw.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf-8"));
let written = 0, metaUpdated = 0, skipped = 0, works = 0;

for (const w of manifest.works) {
  const chaptersDir = join(CORPUS, "works", w.slug, "chapters");
  if (!existsSync(chaptersDir)) continue;
  let touched = false;
  for (const ch of readdirSync(chaptersDir)) {
    const chDir = join(chaptersDir, ch);
    if (!statSync(chDir).isDirectory()) continue;
    const metaPath = join(chDir, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    let metaDirty = false;
    for (const v of meta.variants ?? []) {
      const mdPath = join(chDir, v.file);
      const scPath = join(chDir, v.file.replace(/\.md$/, ".paragraphs.json"));
      if (!existsSync(mdPath)) continue;
      if (existsSync(scPath)) { skipped++; continue; }
      const body = stripFrontmatter(readFileSync(mdPath, "utf-8"));
      const ids = computeParagraphIds(body);
      if (!dry) writeFileSync(scPath, JSON.stringify(ids, null, 2));
      written++;
      touched = true;
      if ((v.paragraph_count ?? 0) !== ids.length) {
        v.paragraph_count = ids.length;
        metaDirty = true;
      }
    }
    if (metaDirty && !dry) {
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      metaUpdated++;
    }
  }
  if (touched) works++;
}

console.log(`backfill-sidecars${dry ? " (dry)" : ""}: wrote ${written} sidecars across ${works} works; meta.json updated ${metaUpdated}; already-present ${skipped}`);
