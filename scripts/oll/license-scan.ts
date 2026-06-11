#!/usr/bin/env bun
/**
 * OLL public-domain license scan.
 *
 * Reads scripts/oll/oll-candidates.json (the curated canon: {slug, author,
 * author_dates, title, era, genre}). For each, fetches the OLL title page,
 * confirms the rights line says the text is in the PUBLIC DOMAIN (skips any
 * "copyright ... held by Liberty Fund" / "permission of the copyright
 * holders" edition), and extracts the ePub S3 URL. Writes the PD-only
 * oll-worklist.json the ingester consumes.
 *
 * Run: bun run scripts/oll/license-scan.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Cand {
  slug: string;
  author: string;
  author_dates?: string;
  title: string;
  era: string;
  genre: string;
}

const cands = JSON.parse(readFileSync(resolve(import.meta.dir, "oll-candidates.json"), "utf-8")) as {
  works: Cand[];
};

const kept: (Cand & { epub_url: string })[] = [];
const dropped: string[] = [];

async function scan(c: Cand) {
  const res = await fetch(`https://oll.libertyfund.org/titles/${c.slug}`);
  if (!res.ok) {
    dropped.push(`${c.slug}: page ${res.status}`);
    return;
  }
  const html = await res.text();
  const epub = html.match(/https:\/\/oll-resources\.s3[^"']+\.epub/)?.[0];
  const pd = /the text is in the public domain|this (?:title|text|work) is in the public domain|in the public domain/i.test(html);
  const copyrighted =
    /copyright to this edition[^.]*held by|kind permission of the copyright holders|all rights reserved|©\s*\d{4}/i.test(html);
  if (!epub) {
    dropped.push(`${c.slug}: no ePub`);
    return;
  }
  if (copyrighted && !pd) {
    dropped.push(`${c.slug}: copyrighted edition`);
    return;
  }
  if (!pd) {
    dropped.push(`${c.slug}: no public-domain statement`);
    return;
  }
  kept.push({ ...c, epub_url: epub });
  console.log(`  PD  ${c.slug}`);
}

// modest concurrency
for (let i = 0; i < cands.works.length; i += 6) {
  await Promise.all(cands.works.slice(i, i + 6).map(scan));
}

writeFileSync(
  resolve(import.meta.dir, "oll-worklist.json"),
  JSON.stringify({ works: kept }, null, 1),
);
console.log(`\npublic-domain: ${kept.length} of ${cands.works.length}; dropped ${dropped.length}`);
for (const d of dropped) console.log(`  - ${d}`);
