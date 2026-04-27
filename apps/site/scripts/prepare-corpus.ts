#!/usr/bin/env bun
/**
 * Pre-build step: expose the corpus markdown at apps/site/public/corpus/
 * via a symlink so Astro serves /corpus/manifest.json, chapter files, etc.
 * as static assets at /corpus/* on the site origin.
 *
 * The browser-bundled MCP tools (apps/site/src/islands/byok/browserTools.ts)
 * consume these static URLs. With a symlink, `bun run dev` serves the
 * live corpus directly with no copy step; `astro build` follows the
 * symlink and bundles the corpus into dist/, which Vercel/Netlify/
 * Cloudflare Pages serve as static files.
 *
 * Idempotent: skips if the symlink already exists and points at the
 * right target. Run automatically by predev / prebuild.
 */

import { existsSync, lstatSync, symlinkSync, readlinkSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(__dirname, "..", "..", "..", "corpus");
const publicCorpus = resolve(__dirname, "..", "public", "corpus");

if (!existsSync(corpusRoot)) {
  console.error(`prepare-corpus: corpus not found at ${corpusRoot}`);
  process.exit(1);
}

mkdirSync(dirname(publicCorpus), { recursive: true });

if (existsSync(publicCorpus)) {
  const stat = lstatSync(publicCorpus);
  if (stat.isSymbolicLink()) {
    const current = readlinkSync(publicCorpus);
    const expected = resolve(dirname(publicCorpus), current);
    if (expected === corpusRoot) {
      console.log(`prepare-corpus: symlink already points at ${corpusRoot}`);
      process.exit(0);
    }
    // Wrong target — recreate.
    unlinkSync(publicCorpus);
  } else {
    console.error(
      `prepare-corpus: ${publicCorpus} exists but is not a symlink. Remove it first or rename.`,
    );
    process.exit(1);
  }
}

// Use a relative target so the symlink survives clones/moves.
const relTarget = "../../../corpus";
symlinkSync(relTarget, publicCorpus);
console.log(`prepare-corpus: symlinked ${publicCorpus} -> ${relTarget}`);
