import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * R1 — CRITICAL REGRESSION (IRON RULE from engineering review).
 *
 * Every [p-XXXXXX] hash that appears in any wiki output file MUST resolve
 * to a real paragraph in the corresponding chapter's paragraphs.json.
 *
 * Why this matters: the verbatim-fidelity contract (D2) is the thesis of
 * the wiki layer — quoted text carries a cite handle, the model trusts
 * the handle, the user clicks through. If the handle points at a
 * paragraph that doesn't exist in the source, the wiki is lying about
 * verbatim fidelity. That's not a bug; that's a thesis violation.
 *
 * This test is CONDITIONAL: it runs only when corpus/works/<slug>/wiki/
 * exists for at least one work. Until Chunk 6 generates the first real
 * wiki tree, the test is a silent no-op (no skipped tests, just nothing
 * to assert against). After Chunk 6, every (work × chapter) gets a row.
 *
 * Per-work test rows so a failure points at the exact work to investigate.
 */

const CORPUS_ROOT = resolve(__dirname, "..", "..", "..", "corpus");
const WORKS_DIR = `${CORPUS_ROOT}/works`;
const HASH_RE = /\[(p-[0-9a-f]{6})\]/g;

const works = existsSync(WORKS_DIR) ? readdirSync(WORKS_DIR) : [];
const worksWithWiki = works.filter((slug) =>
  existsSync(`${WORKS_DIR}/${slug}/wiki`),
);

describe("R1 (CRITICAL): paragraph-hash existence across wiki output", () => {
  if (worksWithWiki.length === 0) {
    test.todo(
      "no wiki/ tree on disk yet — test will activate once Chunk 6 runs the first full corpus build",
    );
    return;
  }

  for (const slug of worksWithWiki) {
    const wikiDir = `${WORKS_DIR}/${slug}/wiki`;
    const chaptersDir = `${WORKS_DIR}/${slug}/chapters`;

    test(`${slug}: every [p-XXXXXX] in wiki/* resolves to a real paragraph`, () => {
      // Build the set of valid hashes from this work's paragraphs.json files
      const valid = new Set<string>();
      if (existsSync(chaptersDir)) {
        for (const ch of readdirSync(chaptersDir)) {
          for (const variant of ["translation", "transliteration", "original"]) {
            const path = `${chaptersDir}/${ch}/${variant}.paragraphs.json`;
            if (!existsSync(path)) continue;
            const j = JSON.parse(readFileSync(path, "utf-8")) as
              | { paragraphs: { id: string }[] }
              | { id: string }[];
            const arr = Array.isArray(j) ? j : j.paragraphs ?? [];
            for (const p of arr) if (p?.id) valid.add(p.id);
          }
        }
      }

      // Scan every wiki file for [p-XXXXXX] hashes
      const orphaned: string[] = [];
      for (const f of readdirSync(wikiDir)) {
        if (!f.endsWith(".md")) continue;
        const content = readFileSync(`${wikiDir}/${f}`, "utf-8");
        for (const m of content.matchAll(HASH_RE)) {
          const hash = m[1]!;
          if (!valid.has(hash)) orphaned.push(`${f}: ${hash}`);
        }
      }

      expect(orphaned).toEqual([]);
    });
  }
});
