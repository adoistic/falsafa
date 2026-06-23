#!/usr/bin/env bun
/**
 * Apply scripts/doctor/authors-registry.json to the built corpus, in place.
 *
 * Channel-1 repair (see docs/CORPUS-DOCTOR-PLAN.md): rewrites ONLY the
 * author block (biography / birth_year / death_year / nationality) and
 * published_year in each work's index.md frontmatter, plus the matching
 * manifest.json fields. Chapters, sidecars and wiki are untouched; no
 * convert run; work slugs and URLs stable. Era is recomputed only when a
 * newly set published_year contradicts a modern-era label.
 *
 * Registry record: { name, birth_year, death_year, nationality, bio,
 *                    works: [{ slug, published_year }] }
 *
 * Run: bun run scripts/doctor/enrich-authors.ts          # dry-run report
 *      bun run scripts/doctor/enrich-authors.ts --write  # apply
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const worksDir = join(root, "corpus", "works");
const WRITE = process.argv.includes("--write");

interface Rec {
  name: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  bio: string;
  works: { slug: string; published_year: number | null }[];
}
const registry = JSON.parse(readFileSync(resolve(import.meta.dir, "authors-registry.json"), "utf-8")) as { authors: Rec[] };
const byName = new Map(registry.authors.map((a) => [a.name, a]));
const yearBySlug = new Map<string, number>();
for (const a of registry.authors)
  for (const w of a.works) if (w.published_year != null) yearBySlug.set(w.slug, w.published_year);

// match convert.ts yamlEscape exactly
function yamlEscape(value: string): string {
  if (/[:#\-?@&*!|>'"%`{}\[\]\n]/.test(value) || /^[\s]/.test(value) || /[\s]$/.test(value)) return JSON.stringify(value);
  return value;
}

function eraFor(year: number, current: string): string {
  const MODERN = ["Renaissance", "Enlightenment", "19th Century", "20th Century"];
  if (!MODERN.includes(current)) return current; // never touch classical-period labels
  // "Enlightenment" here covers the early-modern period (17th-18th c): the
  // rationalists (Descartes 1637, Hobbes 1651, Bacon 1620) belong with it,
  // not with the Renaissance, so the floor is 1600 — otherwise a 1637 work
  // would be force-flipped to Renaissance, a regression.
  if (year >= 1890 && current === "20th Century") return current;
  if (year >= 1789 && year < 1901 && current === "19th Century") return current;
  if (year >= 1600 && year < 1800 && current === "Enlightenment") return current;
  if (year >= 1350 && year < 1600 && current === "Renaissance") return current;
  if (year >= 1901) return "20th Century";
  if (year >= 1800) return "19th Century";
  if (year >= 1600) return "Enlightenment";
  if (year >= 1350) return "Renaissance";
  return current;
}

const stats = { works: 0, authorBlocks: 0, pubYears: 0, eras: 0, noRegistry: new Set<string>() };
const eraMoves: { slug: string; from: string; to: string }[] = [];

const manifest = JSON.parse(readFileSync(join(root, "corpus", "manifest.json"), "utf-8"));
const manifestBySlug = new Map<string, Record<string, unknown>>(
  (manifest.works as { slug: string }[]).map((w) => [w.slug, w as Record<string, unknown>]),
);
const slugifyEra = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

for (const slug of readdirSync(worksDir)) {
  const idxPath = join(worksDir, slug, "index.md");
  if (!existsSync(idxPath)) continue;
  let text = readFileSync(idxPath, "utf-8");
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fmMatch) continue;
  let fm = fmMatch[1]!;
  const name = /^\s+name:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1];
  if (!name) continue;
  const rec = byName.get(name);
  if (!rec) { stats.noRegistry.add(name); continue; }
  stats.works++;
  let changed = false;

  // ── author block: replace the whole indented block under "author:" ──
  const authorBlockRe = /(^author:\n)((?:[ \t]+\S[^\n]*\n)+)/m;
  const ab = authorBlockRe.exec(fm);
  if (ab) {
    const lines = [`  name: ${yamlEscape(name)}`];
    if (rec.bio) lines.push(`  biography: ${yamlEscape(rec.bio)}`);
    if (rec.birth_year != null) lines.push(`  birth_year: ${rec.birth_year}`);
    if (rec.death_year != null) lines.push(`  death_year: ${rec.death_year}`);
    if (rec.nationality) lines.push(`  nationality: ${yamlEscape(rec.nationality)}`);
    const newBlock = `author:\n${lines.join("\n")}\n`;
    const oldBlock = ab[0];
    if (oldBlock !== newBlock) {
      fm = fm.replace(authorBlockRe, newBlock);
      stats.authorBlocks++;
      changed = true;
    }
  }

  // ── published_year ──
  // A "published_year" of a posthumous MODERN compilation/translation (e.g.
  // a 1979 "Selected Writings" of a 1653-1716 author) misleads on a work
  // card — suppress it past ~120 years after the author's death. Genuine
  // first publications shortly after death (Smith's 1896 Lectures, Acton's
  // 1906 essays) are kept. Era is recomputed ONLY for lifetime publications;
  // for posthumous ones the curated era (the author's intellectual period)
  // is left intact.
  const year = yearBySlug.get(slug);
  const death = rec.death_year ?? null;
  const tooLatePosthumous = year != null && death != null && year > death + 120;
  // A modern edition/translation year stamped on an ancient or medieval work
  // (e.g. an 1840 edition of a 9th-c. Cynewulf poem) is meaningless as a
  // "publication year" — these works are dated by era, not by their reprint.
  // Genuine medieval composition years (Maimonides 1190, Bede 731) are < 1500
  // and survive; a year past 1500 on an ancient-era work is the reprint date.
  const curEraForGuard = /^era:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1] ?? "";
  const ANCIENT_ERAS = new Set(["Ancient", "Classical", "Hellenistic", "Imperial", "Late Antiquity", "Medieval"]);
  const reprintOnAncient = year != null && ANCIENT_ERAS.has(curEraForGuard) && year > 1500;
  const hasYear = /^published_year:\s*-?\d+/m.test(fm);
  if (year != null && !hasYear && !tooLatePosthumous && !reprintOnAncient) {
    // insert after difficulty: (convert.ts field order), else before total_logical_chapters
    if (/^difficulty:.*$/m.test(fm)) fm = fm.replace(/^(difficulty:.*)$/m, `$1\npublished_year: ${year}`);
    else fm = fm.replace(/^(total_logical_chapters:)/m, `published_year: ${year}\n$1`);
    stats.pubYears++;
    changed = true;
    const mw = manifestBySlug.get(slug);
    if (mw) mw.published_year = year;
    // era sanity — only for LIFETIME publications (year <= death + 2)
    const lifetime = death == null || year <= death + 2;
    const era = /^era:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1];
    // Only correct era when the year unambiguously dictates it — i.e. the
    // change crosses the 1800 line (pre-modern → 19th/20th) or moves between
    // 19th and 20th. The Renaissance↔Enlightenment ("early modern") boundary
    // is genuinely fuzzy for the Scientific Revolution figures (Bacon,
    // Galileo, Hobbes, Descartes); leave those labels as curated.
    const PRE1800 = new Set(["Renaissance", "Enlightenment"]);
    if (lifetime && era) {
      const newEra = eraFor(year, era);
      if (newEra !== era && !(PRE1800.has(era) && PRE1800.has(newEra))) {
        fm = fm.replace(/^era:.*$/m, `era: ${yamlEscape(newEra)}`);
        eraMoves.push({ slug, from: era, to: newEra });
        stats.eras++;
        if (mw) { mw.era = newEra; mw.era_slug = slugifyEra(newEra); }
      }
    }
  }

  // splice by index, not String.replace (avoids `$` in bios being treated
  // as a replacement pattern, and avoids any second match of the fm text)
  if (changed && WRITE) writeFileSync(idxPath, "---\n" + fm + text.slice(fmMatch[0]!.length - 4));
}

// manifest era-map moves
for (const mv of eraMoves) {
  const fromSlug = slugifyEra(mv.from), toSlug = slugifyEra(mv.to);
  const eras = manifest.eras as Record<string, { name: string; works: string[] }>;
  if (eras[fromSlug]) eras[fromSlug].works = eras[fromSlug].works.filter((s) => s !== mv.slug);
  (eras[toSlug] ??= { name: mv.to, works: [] }).works.push(mv.slug);
}
if (WRITE && (stats.pubYears || stats.eras)) {
  manifest.generated_at = new Date().toISOString();
  writeFileSync(join(root, "corpus", "manifest.json"), JSON.stringify(manifest, null, 1));
}

console.log(`${WRITE ? "APPLIED" : "DRY RUN"}: ${stats.works} works matched registry`);
console.log(`  author blocks rewritten: ${stats.authorBlocks}`);
console.log(`  published_year set:      ${stats.pubYears}`);
console.log(`  era corrections:         ${stats.eras}${eraMoves.length ? " — " + eraMoves.map((m) => `${m.slug}: ${m.from}→${m.to}`).join("; ") : ""}`);
if (stats.noRegistry.size) console.log(`  authors not in registry (${stats.noRegistry.size}): ${[...stats.noRegistry].slice(0, 12).join(", ")}…`);
