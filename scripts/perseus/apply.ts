#!/usr/bin/env bun
/**
 * Apply the Perseus tranche to the corpus, additively.
 *
 * Why not just re-run convert? Because corpus/ is more than convert output:
 * it carries chapter splits, wiki cards and paragraph sidecars produced by
 * later pipeline stages. Regenerating from works.json would destroy them.
 * (We learned this the hard way; git took the bullet.)
 *
 * This script:
 *   1. converts ONLY perseus-works.json + perseus-audit.json into a temp dir
 *   2. copies the resulting work directories into corpus/works/
 *   3. merges the temp manifest into corpus/manifest.json (works appended,
 *      author/era/genre/language maps merged, counts recomputed)
 *
 * Idempotent: UUIDs are URN-derived, so slugs are stable; re-running
 * overwrites the same work dirs and replaces the same manifest entries.
 *
 * Run: bun run scripts/perseus/ingest.ts && bun run scripts/perseus/apply.ts
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const tempDir = resolve(root, ".perseus-corpus-tmp");

// Default input pair is the Perseus tranche; pass another pair as CLI args
// (e.g. hart-works.json hart-audit.json) to apply a different additive set.
const worksFile = process.argv[2] ?? "perseus-works.json";
const auditFile = process.argv[3] ?? "perseus-audit.json";

if (!existsSync(resolve(root, worksFile))) {
  console.error(`${worksFile} not found. Run the matching ingester first.`);
  process.exit(1);
}

// 1. convert the tranche into a temp corpus
rmSync(tempDir, { recursive: true, force: true });
execFileSync(
  "bun",
  [
    "run",
    resolve(root, "scripts/convert.ts"),
    "--works",
    worksFile,
    "--audit",
    auditFile,
    "--out",
    ".perseus-corpus-tmp",
  ],
  { cwd: root, stdio: "inherit" },
);

// 2. copy work directories into the real corpus
const tempWorks = resolve(tempDir, "works");
const corpusWorks = resolve(root, "corpus", "works");
const newSlugs = readdirSync(tempWorks);
for (const slug of newSlugs) {
  const dest = resolve(corpusWorks, slug);
  rmSync(dest, { recursive: true, force: true });
  cpSync(resolve(tempWorks, slug), dest, { recursive: true });
}

// 3. merge manifests
interface ManifestMap {
  [slug: string]: { name: string; works: string[] } & Record<string, unknown>;
}
interface Manifest {
  generated_at: string;
  source: string;
  counts: Record<string, number>;
  works: { slug: string }[] & Record<number, { slug: string }>;
  authors: ManifestMap;
  eras: ManifestMap;
  genres: ManifestMap;
  languages: ManifestMap;
}

const manifestPath = resolve(root, "corpus", "manifest.json");
const base = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
const add = JSON.parse(readFileSync(resolve(tempDir, "manifest.json"), "utf-8")) as Manifest;

// replace any prior entries for the same slugs, then append
const addSlugs = new Set(add.works.map((w) => w.slug));
base.works = [...base.works.filter((w) => !addSlugs.has(w.slug)), ...add.works] as Manifest["works"];

for (const key of ["authors", "eras", "genres", "languages"] as const) {
  for (const [slug, entry] of Object.entries(add[key])) {
    const existing = base[key][slug];
    if (existing) {
      const merged = new Set([...existing.works.filter((w) => !addSlugs.has(w)), ...entry.works]);
      existing.works = [...merged];
    } else {
      base[key][slug] = entry;
    }
  }
}

base.counts = {
  works: base.works.length,
  authors: Object.keys(base.authors).length,
  eras: Object.keys(base.eras).length,
  genres: Object.keys(base.genres).length,
  languages: Object.keys(base.languages).length,
};
base.generated_at = new Date().toISOString();
if (!base.source.includes("Perseus")) {
  base.source += " + Perseus Digital Library tranche (scripts/perseus/)";
}

writeFileSync(manifestPath, JSON.stringify(base, null, 1));
rmSync(tempDir, { recursive: true, force: true });

console.log(`Applied ${newSlugs.length} Perseus works to corpus/.`);
console.log(`Manifest: ${base.counts.works} works, ${base.counts.authors} authors, ${base.counts.languages} languages.`);
console.log(`New slugs:`);
for (const s of newSlugs) console.log(`  - ${s}`);
