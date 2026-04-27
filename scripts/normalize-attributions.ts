#!/usr/bin/env bun
/**
 * One-shot patch: assign author + era metadata where works were previously
 * marked Unknown but the textual tradition or modern scholarship gives a
 * clear attribution.
 *
 * Background: convert.ts originally fell back to "Unknown" whenever the
 * source data didn't carry an explicit author/era field. For Sanskrit
 * smṛtis and Old Javanese tattvas this default is wrong — the texts
 * are eponymously attributed (Manusmṛti → Manu) or have known historical
 * authors (Mpu Dusun for Kunjarakarna, Mpu Shri Sambhara Surya Warama
 * for San Hyan Kamahayanikan). For French liberal economics from
 * 1825–1845 the era is unambiguously 19th Century.
 *
 * Updates:
 *   - corpus/manifest.json  works[].author / author_slug / era / era_slug
 *                            authors / eras / languages aggregate maps
 *                            (rebuilt from scratch after work updates)
 *   - corpus/works/<slug>/index.md  frontmatter author + era fields
 *
 * Chapter-level frontmatter (`author_name`) is NOT touched here. It's
 * historical, not user-facing on the rendered site (the chapter reader
 * pulls work.author from the manifest), and rewriting it would touch
 * ~2000 files for no rendering benefit.
 *
 * Run:
 *   bun run scripts/normalize-attributions.ts            # dry-run
 *   bun run scripts/normalize-attributions.ts --apply    # writes
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CORPUS = resolve(ROOT, "corpus");
const MANIFEST_PATH = join(CORPUS, "manifest.json");

interface AttributionUpdate {
  slug: string;
  author?: string;
  era?: string;
  /** One-line rationale for the audit log. */
  rationale: string;
}

const UPDATES: AttributionUpdate[] = [
  // ── Sanskrit smṛtis: eponymous attribution (standard editorial convention) ──
  { slug: "unknown-manusmrti-347b76", author: "Manu", rationale: "Eponymous — text is named after Manu, the legendary lawgiver" },
  { slug: "unknown-yajnavalkya-smrti-cb88d6", author: "Yājñavalkya", rationale: "Eponymous sage" },
  { slug: "unknown-visnu-smrti-27f0d8", author: "Viṣṇu", rationale: "Eponymous deity-attribution" },
  { slug: "unknown-yama-smrti-552f8d", author: "Yama", rationale: "Eponymous — Yama as god of dharma" },
  { slug: "unknown-parasara-smrti-2259be", author: "Parāśara", rationale: "Eponymous sage (father of Vyāsa)" },
  { slug: "unknown-brhaspati-smrti-0fd070", author: "Bṛhaspati", rationale: "Eponymous sage" },
  { slug: "unknown-naradasmrti-7650d2", author: "Nārada", rationale: "Eponymous sage" },
  { slug: "unknown-katyayana-smrti-1e06d2", author: "Kātyāyana", rationale: "Eponymous sage / grammarian" },
  { slug: "unknown-angirasa-smrti-2bf9d1", author: "Aṅgirasa", rationale: "Eponymous sage Aṅgiras" },

  // ── Sanskrit dharmaśāstra digest with a known historical author ──
  { slug: "unknown-viramitrodaya-d4b632", author: "Mitra Miśra", era: "Medieval", rationale: "17th-c jurist; known historical author of this dharmaśāstra digest. Era stays Medieval per existing taxonomy (no Early Modern bucket)." },

  // ── Manuscript-attested author ──
  { slug: "unknown-nyaya-tilakam-pandulipi-bookny", author: "Vihārācārya", rationale: "Author named on the manuscript title page in the corpus source" },

  // ── Old Javanese: known historical authors ──
  { slug: "unknown-kunjarakarna-dharmakathana-894f4a", author: "Mpu Dusun", era: "Medieval", rationale: "14th-c Majapahit kakawin poet (Teeuw & Robson 1981 edition)" },
  { slug: "unknown-san-hyan-kamahayanikan-2a0c19", author: "Mpu Shri Sambhara Surya Warama", era: "Medieval", rationale: "Real 10th-c East Javanese author, 929–947 CE" },

  // ── Old Javanese tattvas: eponymous attribution (matches smṛti convention) ──
  { slug: "unknown-vrhaspatitattva-b60b28", author: "Bṛhaspati", era: "Medieval", rationale: "Doctrinally ascribed to Bṛhaspati of Śaiva Siddhānta (Acri 2011); eponymous title" },
  { slug: "unknown-ganapatitattva-66a136", author: "Gaṇapati", era: "Medieval", rationale: "Eponymous deity-attribution, same convention as Sanskrit smṛtis" },

  // ── Old Javanese: era-only fix (genuinely anonymous tradition) ──
  { slug: "unknown-kalpabuddha-d760dc", era: "Medieval", rationale: "Anonymous Old Javanese Buddhist text; fits the 8th–14th c tutur/tattva corpus" },
  { slug: "unknown-san-hyan-mahajnana-11c531", era: "Medieval", rationale: "Anonymous Old Javanese tutur" },
  { slug: "unknown-san-hyan-tattvajnana-1f29bd", era: "Medieval", rationale: "Anonymous Old Javanese tutur (Acri's tutur/tattva corpus)" },
  { slug: "unknown-slokantara-d7a628", era: "Medieval", rationale: "Anonymous Old Javanese didactic verse" },
  { slug: "unknown-vratisasana-d0fe75", era: "Medieval", rationale: "Anonymous Old Javanese (Vratiśāsana = 'instruction on vows')" },

  // ── French liberal economics: era fix only, author already known ──
  { slug: "charles-dunoyer-nouveau-traite-deconomie-vol-i-6da8ce", era: "19th Century", rationale: "Charles Dunoyer's Nouveau traité d'économie volumes (1825–1845)" },
  { slug: "charles-dunoyer-nouveau-traite-deconomie-vol-ii-d6ae03", era: "19th Century", rationale: "Same — Dunoyer 1825–1845" },
];

// ─────────────────────────────────────────────────────────────────────────
// Slug helpers
// ─────────────────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─────────────────────────────────────────────────────────────────────────
// Manifest patcher
// ─────────────────────────────────────────────────────────────────────────

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
  era: string;
  era_slug: string;
  genre: string;
  genre_slug: string;
  language: string;
  language_slug: string;
  [k: string]: unknown;
}

interface Manifest {
  generated_at?: string;
  source?: string;
  counts?: { works: number; authors: number; eras: number; genres: number; languages: number };
  works: ManifestWork[];
  authors: Record<string, { name: string; works: string[] }>;
  eras: Record<string, { name: string; works: string[] }>;
  genres: Record<string, { name: string; works: string[] }>;
  languages: Record<string, { name: string; works: string[] }>;
  [k: string]: unknown;
}

function rebuildAggregates(manifest: Manifest): void {
  // Rebuild authors / eras / genres / languages maps from the works array.
  // Cleaner than incremental patching: a work moving from "unknown" to "manu"
  // means manifest.authors["unknown"].works needs the slug removed AND
  // manifest.authors["manu"] needs to exist with the slug added.
  const authors: Record<string, { name: string; works: string[] }> = {};
  const eras: Record<string, { name: string; works: string[] }> = {};
  const genres: Record<string, { name: string; works: string[] }> = {};
  const languages: Record<string, { name: string; works: string[] }> = {};
  for (const w of manifest.works) {
    const aSlug = w.author_slug;
    const eSlug = w.era_slug;
    const gSlug = w.genre_slug;
    const lSlug = w.language_slug;
    if (!authors[aSlug]) authors[aSlug] = { name: w.author, works: [] };
    authors[aSlug].works.push(w.slug);
    if (!eras[eSlug]) eras[eSlug] = { name: w.era, works: [] };
    eras[eSlug].works.push(w.slug);
    if (!genres[gSlug]) genres[gSlug] = { name: w.genre, works: [] };
    genres[gSlug].works.push(w.slug);
    if (!languages[lSlug]) languages[lSlug] = { name: w.language, works: [] };
    languages[lSlug].works.push(w.slug);
  }
  manifest.authors = authors;
  manifest.eras = eras;
  manifest.genres = genres;
  manifest.languages = languages;
  if (manifest.counts) {
    manifest.counts.authors = Object.keys(authors).length;
    manifest.counts.eras = Object.keys(eras).length;
    manifest.counts.genres = Object.keys(genres).length;
    manifest.counts.languages = Object.keys(languages).length;
  }
}

function patchManifest(manifest: Manifest): { applied: number; missing: string[] } {
  const slugSet = new Set(UPDATES.map((u) => u.slug));
  const found = new Set<string>();
  let applied = 0;
  for (const w of manifest.works) {
    if (!slugSet.has(w.slug)) continue;
    const u = UPDATES.find((x) => x.slug === w.slug)!;
    if (u.author && w.author !== u.author) {
      w.author = u.author;
      w.author_slug = toSlug(u.author);
      applied++;
    }
    if (u.era && w.era !== u.era) {
      w.era = u.era;
      w.era_slug = toSlug(u.era);
      applied++;
    }
    found.add(w.slug);
  }
  const missing = [...slugSet].filter((s) => !found.has(s));
  rebuildAggregates(manifest);
  return { applied, missing };
}

// ─────────────────────────────────────────────────────────────────────────
// index.md frontmatter patcher
// ─────────────────────────────────────────────────────────────────────────

function patchIndexFrontmatter(slug: string, update: AttributionUpdate): boolean {
  const indexPath = join(CORPUS, "works", slug, "index.md");
  if (!existsSync(indexPath)) return false;
  const raw = readFileSync(indexPath, "utf-8");
  if (!raw.startsWith("---\n")) return false;
  const fmEnd = raw.indexOf("\n---", 4);
  if (fmEnd === -1) return false;
  const fmText = raw.slice(0, fmEnd + 4);
  const body = raw.slice(fmEnd + 4);

  let changed = false;
  const updated = fmText.split("\n").map((line) => {
    if (update.author) {
      if (line.startsWith("author:")) {
        const newLine = `author: ${update.author}`;
        if (line !== newLine) changed = true;
        return newLine;
      }
      if (line.startsWith("author_slug:")) {
        const newLine = `author_slug: ${toSlug(update.author)}`;
        if (line !== newLine) changed = true;
        return newLine;
      }
    }
    if (update.era) {
      if (line.startsWith("era:")) {
        const newLine = `era: ${update.era}`;
        if (line !== newLine) changed = true;
        return newLine;
      }
      if (line.startsWith("era_slug:")) {
        const newLine = `era_slug: ${toSlug(update.era)}`;
        if (line !== newLine) changed = true;
        return newLine;
      }
    }
    return line;
  });
  if (!changed) return false;
  writeFileSync(indexPath, updated.join("\n") + body, "utf-8");
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

function main() {
  const apply = process.argv.includes("--apply");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Updates planned: ${UPDATES.length}\n`);

  // Snapshot current author/era for each updated work
  const before = new Map<string, { author: string; era: string }>();
  for (const w of manifest.works) {
    if (UPDATES.some((u) => u.slug === w.slug)) {
      before.set(w.slug, { author: w.author, era: w.era });
    }
  }

  const { applied, missing } = patchManifest(manifest);

  // Report
  for (const u of UPDATES) {
    const b = before.get(u.slug);
    if (!b) {
      console.log(`  ✗ ${u.slug}: NOT FOUND in manifest`);
      continue;
    }
    const w = manifest.works.find((x) => x.slug === u.slug)!;
    const authorChange = u.author && b.author !== w.author ? `${b.author} → ${w.author}` : null;
    const eraChange = u.era && b.era !== w.era ? `${b.era} → ${w.era}` : null;
    if (!authorChange && !eraChange) {
      console.log(`  ✓ ${u.slug}: already up-to-date`);
      continue;
    }
    const parts: string[] = [];
    if (authorChange) parts.push(`author: ${authorChange}`);
    if (eraChange) parts.push(`era: ${eraChange}`);
    console.log(`  ✓ ${u.slug}`);
    for (const p of parts) console.log(`      ${p}`);
    console.log(`      rationale: ${u.rationale}`);
  }
  if (missing.length > 0) {
    console.log(`\nMissing slugs (not in manifest): ${missing.join(", ")}`);
  }

  console.log(`\nField updates: ${applied}`);
  console.log(`Authors after: ${Object.keys(manifest.authors).length} (was ${Object.keys(JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")).authors).length})`);
  console.log(`Eras after: ${Object.keys(manifest.eras).length} (was ${Object.keys(JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")).eras).length})`);

  if (!apply) {
    console.log("\nDry-run done. Re-run with --apply to write.");
    return;
  }

  // Write manifest
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`\nWrote ${MANIFEST_PATH}`);

  // Patch each work's index.md
  let indexUpdates = 0;
  for (const u of UPDATES) {
    if (patchIndexFrontmatter(u.slug, u)) indexUpdates++;
  }
  console.log(`Patched ${indexUpdates} index.md frontmatter file(s)`);
}

main();
