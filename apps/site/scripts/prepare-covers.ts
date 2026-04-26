#!/usr/bin/env bun
/**
 * Pre-build step: copy generated cover.webp files from corpus/works/{slug}/
 * into apps/site/public/covers/{slug}.webp so Astro serves them as static
 * assets at /covers/{slug}.webp.
 *
 * Run automatically by `bun run dev` and `bun run build` via package.json
 * scripts (see prebuild / predev).
 */

import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(__dirname, "..", "..", "..", "corpus");
const publicCovers = resolve(__dirname, "..", "public", "covers");

mkdirSync(publicCovers, { recursive: true });

const worksDir = join(corpusRoot, "works");
if (!existsSync(worksDir)) {
  console.error(`Corpus not found at ${corpusRoot}. Run \`bun run convert\` from the monorepo root first.`);
  process.exit(1);
}

let copied = 0;
let skipped = 0;
const slugs = readdirSync(worksDir).filter((s) => statSync(join(worksDir, s)).isDirectory());
for (const slug of slugs) {
  const src = join(worksDir, slug, "cover.webp");
  const dst = join(publicCovers, `${slug}.webp`);
  if (!existsSync(src)) {
    skipped++;
    continue;
  }
  copyFileSync(src, dst);
  copied++;
}

console.log(`prepare-covers: copied ${copied}, skipped ${skipped} (no cover yet) → ${publicCovers}`);
