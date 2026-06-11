#!/usr/bin/env bun
/**
 * Build corpus/search.db: an SQLite FTS5 index over every paragraph of every
 * variant in the corpus, the server-side search plumbing the Perseus launch
 * eng review locked for archive scale. The MCP's search_corpus uses it when
 * present (via node:sqlite) and falls back to the legacy filesystem scan
 * when absent, so the index is an accelerator, not a dependency.
 *
 * Sources the paragraph sidecars (*.paragraphs.json), so no markdown
 * re-parsing. Skips the build (leaving any previous index in place) when
 * free disk is under 1.5 GB.
 *
 * Run: bun run scripts/build-search-index.ts
 */
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const corpusDir = join(root, "corpus");
const dbPath = join(corpusDir, "search.db");

const dfOut = execFileSync("df", ["-k", "/System/Volumes/Data"]).toString("utf-8");
const freeKb = parseInt(dfOut.trim().split("\n").pop()!.split(/\s+/)[3]!, 10);
if (freeKb < 1.5 * 1024 * 1024) {
  console.error(`free disk ${(freeKb / 1048576).toFixed(1)} GB < 1.5 GB; skipping index build`);
  process.exit(0);
}

rmSync(dbPath, { force: true });
const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
db.exec(`
  CREATE VIRTUAL TABLE hits USING fts5(
    text,
    work_slug UNINDEXED,
    work_title UNINDEXED,
    chapter_number UNINDEXED,
    chapter_title UNINDEXED,
    chapter_slug UNINDEXED,
    variant UNINDEXED,
    language UNINDEXED,
    paragraph_id UNINDEXED,
    tokenize = 'porter unicode61'
  );
`);

const manifest = JSON.parse(readFileSync(join(corpusDir, "manifest.json"), "utf-8")) as {
  works: { slug: string; title: string }[];
};

const insert = db.prepare(
  "INSERT INTO hits (text, work_slug, work_title, chapter_number, chapter_title, chapter_slug, variant, language, paragraph_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

let paragraphs = 0;
let chapters = 0;
const begin = db.prepare("BEGIN");
const commit = db.prepare("COMMIT");

for (const work of manifest.works) {
  const chaptersDir = join(corpusDir, "works", work.slug, "chapters");
  if (!existsSync(chaptersDir)) continue;
  begin.run();
  for (const chSlug of readdirSync(chaptersDir)) {
    const chDir = join(chaptersDir, chSlug);
    const metaPath = join(chDir, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      chapter_number: number;
      chapter_title: string;
      variants: { file: string; content_type: string; language: string }[];
    };
    chapters++;
    for (const v of meta.variants) {
      const sidecar = join(chDir, v.file.replace(/\.md$/, ".paragraphs.json"));
      if (!existsSync(sidecar)) continue;
      const paras = JSON.parse(readFileSync(sidecar, "utf-8")) as { id: string; text: string }[];
      for (const p of paras) {
        insert.run(
          p.text,
          work.slug,
          work.title,
          meta.chapter_number,
          meta.chapter_title,
          chSlug,
          v.content_type,
          v.language?.toLowerCase() ?? "",
          p.id,
        );
        paragraphs++;
      }
    }
  }
  commit.run();
}

db.exec("INSERT INTO hits(hits) VALUES('optimize');");
db.close();

const size = Bun.file(dbPath).size;
console.log(
  `search.db: ${manifest.works.length} works, ${chapters} chapters, ${paragraphs.toLocaleString("en-US")} paragraphs, ${(size / 1048576).toFixed(1)} MB`,
);
