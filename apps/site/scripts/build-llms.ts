#!/usr/bin/env bun
/**
 * Build-time generator for LLM-discovery and crawler-hints files.
 *
 * Writes four files into apps/site/public/:
 *   robots.txt      — standard crawler hints + sitemap pointer
 *   llms.txt        — curated summary for LLM context windows (llmstxt.org)
 *   llms-full.txt   — complete enumerated index of all ~2,017 works
 *   agents.txt      — brief orientation for AI agents
 *
 * Run automatically as part of the prebuild chain:
 *   bun run scripts/build-llms.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const publicDir = resolve(__dirname, "..", "public");

// ─── Config ──────────────────────────────────────────────────────────────────

const ORIGIN = "https://falsafa.ai";

// Chronological era ordering (oldest → newest)
const ERA_ORDER = [
  "Ancient",
  "Classical",
  "Hellenistic",
  "Imperial",
  "Late Antiquity",
  "Medieval",
  "Renaissance",
  "16th Century",
  "Enlightenment",
  "18th Century",
  "19th Century",
  "20th Century",
];

// ─── Manifest ────────────────────────────────────────────────────────────────

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  era: string;
  era_slug: string;
  genre: string;
  language: string;
  language_slug: string;
}

interface Manifest {
  counts: { works: number; authors: number; eras: number; genres: number; languages: number };
  works: ManifestWork[];
}

const manifestPath = join(repoRoot, "corpus", "manifest.json");
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const { works } = manifest;
const totalWorks = works.length;

// ─── Breakdown helpers ────────────────────────────────────────────────────────

function countBy<T>(arr: T[], key: (item: T) => string): Array<[string, number]> {
  const map: Record<string, number> = {};
  for (const item of arr) {
    const k = key(item);
    map[k] = (map[k] ?? 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

const langCounts = countBy(works, (w) => w.language);
const eraCounts = countBy(works, (w) => w.era);

// Top-5 languages summary line
const langSummary = langCounts
  .slice(0, 5)
  .map(([lang, n]) => `${lang} (${n})`)
  .join(", ");

// Era counts sorted chronologically
const eraCountsSorted = [...eraCounts].sort(
  (a, b) => ERA_ORDER.indexOf(a[0]) - ERA_ORDER.indexOf(b[0]),
);

// ─── robots.txt ──────────────────────────────────────────────────────────────

const robotsTxt = [
  "# Falsafa — https://falsafa.ai",
  "# LLM/agent discovery: /llms.txt (curated) and /llms-full.txt (complete index)",
  "",
  "User-agent: *",
  "Allow: /",
  "",
  `Sitemap: ${ORIGIN}/sitemap-index.xml`,
].join("\n");

// ─── llms.txt ────────────────────────────────────────────────────────────────

const langBreakdown = langCounts.map(([l, n]) => `  - ${l}: ${n}`).join("\n");
const eraBreakdown = eraCountsSorted.map(([e, n]) => `  - ${e}: ${n}`).join("\n");

const llmsTxt = `# Falsafa

> Falsafa is a free, open-access digital library and archive of philosophy and the history of thought — ${totalWorks} works spanning ancient, medieval, and modern traditions across Greek, Latin, Sanskrit, Arabic, and other languages, each presented with original text, English translation, and transliteration where applicable.

Falsafa makes primary philosophical and literary sources directly readable. The corpus covers classical antiquity, Hellenistic and Roman thought, late antique and medieval philosophy, early modern and Enlightenment writing, and 19th–20th century philosophy — all in a clean reading interface with multiple text variants per chapter. Works are indexed by author, era, genre, and language. The site is fully static, open to crawling, and intended to be cited and quoted.

## Corpus

Total works: ${totalWorks}
Authors: ${manifest.counts.authors}
Eras: ${manifest.counts.eras}
Languages: ${manifest.counts.languages}
Genres: ${manifest.counts.genres}

**By language** (top 5: ${langSummary}):
${langBreakdown}

**By era** (chronological):
${eraBreakdown}

## Resources

- [Browse all works](${ORIGIN}/works/)
- [About Falsafa](${ORIGIN}/about/)
- [Atlas — authors and traditions](${ORIGIN}/atlas/)
- [Numbers — corpus statistics](${ORIGIN}/numbers/)
- [Complete work index (llms-full.txt)](${ORIGIN}/llms-full.txt)
- [Sitemap](${ORIGIN}/sitemap-index.xml)
`;

// ─── llms-full.txt ───────────────────────────────────────────────────────────

// Group works by era in chronological order
const byEra: Record<string, ManifestWork[]> = {};
for (const w of works) {
  if (!byEra[w.era]) byEra[w.era] = [];
  byEra[w.era].push(w);
}

const erasInOrder = ERA_ORDER.filter((e) => byEra[e]);
// Append any eras not in the order list (safety net)
for (const e of Object.keys(byEra)) {
  if (!erasInOrder.includes(e)) erasInOrder.push(e);
}

const llmsFullSections: string[] = [
  `# Falsafa — Complete Work Index`,
  ``,
  `${totalWorks} works, grouped chronologically by era.`,
  `Each line: [Title](URL) — Author · Language · Genre`,
  ``,
];

for (const era of erasInOrder) {
  const eraWorks = byEra[era]!;
  llmsFullSections.push(`## ${era} (${eraWorks.length} works)`);
  llmsFullSections.push(``);
  for (const w of eraWorks) {
    llmsFullSections.push(
      `- [${w.title}](${ORIGIN}/works/${w.slug}/) — ${w.author} · ${w.language} · ${w.genre}`,
    );
  }
  llmsFullSections.push(``);
}

const llmsFullTxt = llmsFullSections.join("\n");

// ─── agents.txt ──────────────────────────────────────────────────────────────

const agentsTxt = `# Falsafa — Agent Entry Point

Falsafa (${ORIGIN}) is an open-access digital library of philosophy and the history of thought, currently indexing ${totalWorks} works across multiple languages and traditions. The site is fully static and open for reading and indexing.

## Corpus discovery

- **Curated summary** (LLM context-friendly, ~2 KB): ${ORIGIN}/llms.txt
- **Complete work index** (all ${totalWorks} works, grouped by era, ~200 KB): ${ORIGIN}/llms-full.txt

Each work is accessible at \`${ORIGIN}/works/<slug>/\`. Chapters are served at \`${ORIGIN}/works/<slug>/<chapter-slug>/\` with multiple text variants (original, translation, transliteration) selectable via query parameter \`?v=<variant_id>\`.

The corpus manifest (JSON, machine-readable) is available at: ${ORIGIN}/corpus/manifest.json
`;

// ─── Write files ─────────────────────────────────────────────────────────────

mkdirSync(publicDir, { recursive: true });

const files: Array<[string, string]> = [
  ["robots.txt", robotsTxt],
  ["llms.txt", llmsTxt],
  ["llms-full.txt", llmsFullTxt],
  ["agents.txt", agentsTxt],
];

for (const [name, content] of files) {
  const dest = join(publicDir, name);
  writeFileSync(dest, content, "utf-8");
  const bytes = Buffer.byteLength(content, "utf-8");
  console.log(`build-llms: wrote ${name} (${(bytes / 1024).toFixed(1)} KB)`);
}

console.log(`build-llms: done — ${totalWorks} works indexed.`);
