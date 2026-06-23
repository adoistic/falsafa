#!/usr/bin/env bun
/**
 * Corpus lint — the permanent quality gate over corpus/works/.
 *
 * Scans every work's index.md frontmatter and chapter meta.json files for
 * the issue classes the 2026-06-12 census found (see
 * docs/CORPUS-DOCTOR-PLAN.md): placeholder bios, missing author years,
 * missing publication years, era/year mismatches, apparatus chapters,
 * duplicate / generic / ALL-CAPS chapter titles, unsplit books, tiny
 * fragment chapters.
 *
 * Run: bun run scripts/doctor/lint.ts            # report
 *      bun run scripts/doctor/lint.ts --gate     # exit 1 if budgets exceeded
 *
 * Output: corpus-lint.json (per-work issues) + console summary by source.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const worksDir = join(root, "corpus", "works");

const SOURCES: [string, RegExp][] = [
  ["marxists", /Marxists Internet Archive/],
  ["oll", /Online Library of Liberty/],
  ["gutenberg", /Project Gutenberg|Gutenberg/],
  ["perseus", /Perseus|Scaife/],
  ["hart", /Hart's Digital|David Hart|Liberty and Power/],
];

// Budgets for --gate mode: issue class -> max allowed works
const BUDGETS: Record<string, number> = {
  // Structural budgets (0) are Wave B/C targets — apparatus, dup titles and
  // unsplit books are still above budget until the re-ingest waves run.
  apparatus_chapters: 0,
  dup_chapter_titles: 0,
  // Metadata budgets (Wave A): bio_thin = 1 is the one deliberately-excluded
  // misattribution (George Hamilton). missing_author_years = 60 covers the
  // legendary/anonymous/composite authors whose null dates are CORRECT
  // (Homer, Hesiod, the smṛti sages, the Levellers, early-Christian texts).
  bio_thin: 1,
  missing_author_years: 60,
  era_year_mismatch: 0,
};

const GENERIC = /^(chapter|book|part|section|letter|essay|lecture)\s+[\divxlc]+\.?$|^[\divxlc]+\.?$|\(\d+\)$/i;
const APPAR = /^(contents|table of contents|index(es)?\.?|notes\.?|footnotes\.?|endnotes\.?|bibliography\.?|title ?page|colophon|advertisements?\b|glossary|errata)/i;

interface Issue { work: string; source: string; issue: string; detail?: string }
const issues: Issue[] = [];
const fmField = (fm: string, key: string, indented = false) => {
  const re = new RegExp(`^${indented ? "\\s+" : ""}${key}:\\s*"?(.*?)"?\\s*$`, "m");
  return re.exec(fm)?.[1] ?? null;
};

const slugs = readdirSync(worksDir).filter((s) => existsSync(join(worksDir, s, "index.md")));
for (const slug of slugs) {
  const text = readFileSync(join(worksDir, slug, "index.md"), "utf-8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  let source = "other";
  for (const [k, re] of SOURCES) if (re.test(text)) { source = k; break; }
  const add = (issue: string, detail?: string) => issues.push({ work: slug, source, issue, detail });

  const authorName = fmField(fm, "name", true) ?? "";
  // null birth/death years are CORRECT for anonymous, pseudonymous, scriptural,
  // and legendary authorship — don't count those as missing data.
  const ANON = /^(unknown|anonymous|old testament|new testament|homeric hymns|pseudo[- ]|.*\(pseudo)/i;
  const death = parseInt(fmField(fm, "death_year", true) ?? "", 10);

  const bio = fmField(fm, "biography", true) ?? "";
  // a real house-style bio is never < 40 chars, never opens with the author's
  // own name ("Karl Marx (1818-1883)..."), and is never an ingest placeholder
  const placeholderBio =
    bio.length < 40 ||
    (authorName.length > 0 && bio.startsWith(authorName)) ||
    /^(Author record from the Perseus|Works of unknown)/.test(bio);
  if (placeholderBio) add("bio_thin", bio.slice(0, 60));
  if (!/^\s+birth_year:\s*-?\d+/m.test(fm) && !ANON.test(authorName)) add("missing_author_years", authorName);
  const era = fmField(fm, "era");
  const pyRaw = fmField(fm, "published_year");
  const py = pyRaw && /^-?\d+$/.test(pyRaw) ? parseInt(pyRaw, 10) : null;
  if (py === null && !["perseus"].includes(source)) add("missing_pub_year");
  if (py !== null && era) {
    // A posthumous first publication / modern edition legitimately post-dates
    // the author's era (Smith's 1896 Lectures, Shelley's 1920 Reform). Only
    // flag a mismatch for LIFETIME publications. And treat the early-modern
    // Renaissance/Enlightenment line (1600±) as one fuzzy band, not a hard cut.
    const lifetime = !Number.isFinite(death) || py <= death + 2;
    const bad = lifetime && (
      (era === "Enlightenment" && !(py >= 1600 && py < 1800)) ||
      (era === "19th Century" && !(py >= 1789 && py < 1901)) ||
      (era === "20th Century" && !(py >= 1890 && py < 2010)) ||
      (era === "Renaissance" && !(py >= 1350 && py < 1700)) ||
      (era === "Medieval" && !(py >= 500 && py < 1500)));
    if (bad) add("era_year_mismatch", `${era} vs ${py}`);
  }

  const chDir = join(worksDir, slug, "chapters");
  const chs = existsSync(chDir) ? readdirSync(chDir).filter((c) => existsSync(join(chDir, c, "meta.json"))) : [];
  if (chs.length === 0) { add("no_chapters"); continue; }
  const titles: string[] = [];
  const words: number[] = [];
  for (const c of chs.sort()) {
    try {
      const m = JSON.parse(readFileSync(join(chDir, c, "meta.json"), "utf-8"));
      titles.push(m.chapter_title ?? "");
      const wcs = (m.variants ?? []).map((v: { word_count?: number }) => v.word_count ?? 0);
      words.push(wcs.length ? Math.max(...wcs) : 0);
    } catch { /* skip */ }
  }
  const n = titles.length;
  const appar = titles.filter((t) => APPAR.test(t.trim()));
  if (appar.length) add("apparatus_chapters", appar.slice(0, 3).join(" | "));
  const dup = n - new Set(titles).size;
  if (dup > 0) add("dup_chapter_titles", `${dup} duplicates`);
  const generic = titles.filter((t) => GENERIC.test(t.trim())).length;
  if (n > 3 && generic / n > 0.5) add("mostly_generic_titles", `${generic}/${n}`);
  const caps = titles.filter((t) => t.length > 6 && t === t.toUpperCase()).length;
  if (n > 3 && caps / n > 0.5) add("mostly_allcaps_titles", `${caps}/${n}`);
  if (n === 1 && (words[0] ?? 0) > 20000) add("unsplit_book", `${words[0]} words`);
  const tiny = words.filter((w) => w > 0 && w < 100).length;
  if (tiny) add("tiny_chapters", `${tiny} of ${n}`);
}

// summary
const bySrcIssue: Record<string, Record<string, number>> = {};
for (const i of issues) {
  (bySrcIssue[i.issue] ??= {})[i.source] = ((bySrcIssue[i.issue] ??= {})[i.source] ?? 0) + 1;
}
const srcs = ["oll", "gutenberg", "perseus", "marxists", "hart", "other"];
console.log(`${slugs.length} works scanned, ${issues.length} issues\n`);
console.log("issue".padEnd(26) + srcs.map((s) => s.padStart(10)).join(""));
for (const issue of Object.keys(bySrcIssue).sort()) {
  console.log(issue.padEnd(26) + srcs.map((s) => String(bySrcIssue[issue]![s] ?? 0).padStart(10)).join(""));
}
writeFileSync(join(root, "corpus-lint.json"), JSON.stringify({ generated_at: new Date().toISOString(), total_works: slugs.length, issues }, null, 1));
console.log("\ncorpus-lint.json written");

if (process.argv.includes("--gate")) {
  let failed = false;
  for (const [issue, budget] of Object.entries(BUDGETS)) {
    const count = issues.filter((i) => i.issue === issue).length;
    if (count > budget) { console.error(`GATE FAIL: ${issue} = ${count} > budget ${budget}`); failed = true; }
  }
  if (failed) process.exit(1);
  console.log("gate: all budgets met");
}
