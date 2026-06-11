#!/usr/bin/env bun
/**
 * Reclassify the era of corpus works from an author->period map.
 *
 * The full-archive ingester stamped every Perseus work "Ancient" as a
 * placeholder. This patches the real period (Classical / Hellenistic /
 * Imperial / Late Antiquity / Medieval) onto each work's index.md
 * frontmatter and its manifest entry, then rebuilds the eras facet.
 *
 * Only touches works whose author is in the map; the curated catalog
 * (Comte, Ghalib, the Sanskrit smritis, etc.) keeps its hand-set eras.
 * Optional author renames (Unknown -> Bede) ride the same map.
 *
 * Input: scripts/perseus/era-map.json
 *   { "byAuthor": { "Plutarch": "Imperial", ... },
 *     "rename":   { "<old author> :: <title substr>": "<new author>" } }
 *
 * Run: bun run scripts/perseus/reclassify-eras.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const corpusDir = join(root, "corpus");
const map = JSON.parse(readFileSync(resolve(import.meta.dir, "era-map.json"), "utf-8")) as {
  byAuthor: Record<string, string>;
  rename?: Record<string, string>;
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const manifestPath = join(corpusDir, "manifest.json");
const m = JSON.parse(readFileSync(manifestPath, "utf-8"));

let patched = 0;
let renamed = 0;
const changedEras = new Set<string>();

for (const w of m.works) {
  const period = map.byAuthor[w.author];
  // optional author rename keyed by "author :: titleSubstr"
  let newAuthor: string | null = null;
  if (map.rename) {
    for (const [key, val] of Object.entries(map.rename)) {
      const [oldAuthor, titleSub] = key.split(" :: ");
      if (w.author === oldAuthor && (!titleSub || w.title.includes(titleSub))) {
        newAuthor = val;
        break;
      }
    }
  }
  const effectivePeriod = period ?? (newAuthor ? map.byAuthor[newAuthor] : undefined);
  if (!period && !newAuthor) continue;

  const indexPath = join(corpusDir, "works", w.slug, "index.md");
  let md = readFileSync(indexPath, "utf-8");

  if (effectivePeriod) {
    md = md.replace(/^era:.*$/m, `era: ${effectivePeriod}`);
    w.era = effectivePeriod;
    w.era_slug = slugify(effectivePeriod);
    changedEras.add(w.era_slug);
    patched++;
  }
  if (newAuthor) {
    // index.md frontmatter author lives under author:\n  name: "..."
    md = md.replace(/(\n {2}name:\s*).*$/m, `$1${JSON.stringify(newAuthor)}`);
    w.author = newAuthor;
    renamed++;
  }
  writeFileSync(indexPath, md);
}

// rebuild the eras facet from scratch off the patched per-work era_slug
const eras: Record<string, { name: string; works: string[] }> = {};
for (const w of m.works) {
  const slug = w.era_slug ?? slugify(w.era ?? "unknown");
  (eras[slug] ??= { name: w.era ?? "Unknown", works: [] }).works.push(w.slug);
}
m.eras = eras;
m.counts.eras = Object.keys(eras).length;
m.generated_at = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(m, null, 1));

console.log(`reclassified ${patched} works, renamed ${renamed} authors`);
console.log(
  `eras now:`,
  Object.entries(eras)
    .map(([s, e]) => `${e.name} (${e.works.length})`)
    .join(", "),
);
