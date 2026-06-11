#!/usr/bin/env bun
/**
 * Remove works from the corpus by slug: deletes the work directory and
 * scrubs the slug from manifest works and facet maps (authors, eras,
 * genres, languages), dropping facet entries that empty out, then
 * recomputes the counts block.
 *
 * Used by the Latin repair to retire fragment works and stale slugs whose
 * author finally resolved (slugs embed the author name, so a fixed author
 * means a new slug).
 *
 * Run: bun run scripts/perseus/prune.ts <slug> [<slug> ...]
 *  or: bun run scripts/perseus/prune.ts --file <json with {slugs: []}>
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");

let slugs: string[] = [];
if (process.argv[2] === "--file") {
  const f = JSON.parse(readFileSync(resolve(root, process.argv[3]!), "utf-8"));
  slugs = f.slugs;
} else {
  slugs = process.argv.slice(2);
}
if (slugs.length === 0) {
  console.error("no slugs given");
  process.exit(1);
}
const gone = new Set(slugs);

let removedDirs = 0;
for (const slug of slugs) {
  const dir = resolve(root, "corpus", "works", slug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    removedDirs++;
  }
}

const manifestPath = resolve(root, "corpus", "manifest.json");
const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
const before = m.works.length;
m.works = m.works.filter((w: { slug: string }) => !gone.has(w.slug));

for (const key of ["authors", "eras", "genres", "languages"]) {
  for (const [facetSlug, entry] of Object.entries(m[key]) as [string, any][]) {
    entry.works = entry.works.filter((s: string) => !gone.has(s));
    if (entry.works.length === 0) delete m[key][facetSlug];
  }
}

m.counts = {
  works: m.works.length,
  authors: Object.keys(m.authors).length,
  eras: Object.keys(m.eras).length,
  genres: Object.keys(m.genres).length,
  languages: Object.keys(m.languages).length,
};
m.generated_at = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(m, null, 1));

console.log(
  `pruned ${before - m.works.length} manifest entries, ${removedDirs} work dirs; corpus now ${m.counts.works} works`,
);
