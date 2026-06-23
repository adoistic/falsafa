#!/usr/bin/env bun
/**
 * Merge the per-author crawl results (/tmp/mia-worklists/*.json) into a
 * single candidate worklist, applying the conservative license policy:
 *
 *   KEEP   pd-explicit  — page says Public Domain / "may freely copy ..."
 *   KEEP   copyleft     — MIA volunteer transcription under CC BY-SA / GFDL
 *   KEEP   old-pd       — translation/English publication verifiably <= 1930
 *                         (a year <= 1930 must actually appear in the
 *                         evidence or the translation_year field)
 *   DROP   copyright / permission / noncommercial / unknown
 *
 * Also drops duplicates of works already in corpus/manifest.json (matched by
 * normalized author surname + title overlap) and in-batch duplicates.
 *
 * Output: scripts/marxists/marxists-worklist.json (kept works)
 *         scripts/marxists/license-report.json (full disposition, for review)
 *
 * Run: bun run scripts/marxists/merge-worklist.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const uuidFrom = (s: string) => {
  const h = createHash("sha1").update(s).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
};

const root = resolve(import.meta.dir, "..", "..");
const IN_DIR = "/tmp/mia-worklists";

interface Row {
  author: string;
  title: string;
  year?: number | null;
  url: string;
  structure: "single" | "index";
  chapter_links?: string[];
  subject: string;
  genre: string;
  translator?: string | null;
  translation_year?: number | null;
  license_signal: string;
  license_evidence: string;
  notes?: string;
}

const authorsMeta = JSON.parse(
  readFileSync(resolve(import.meta.dir, "authors.json"), "utf-8"),
) as { authors: { key: string; name: string; dates: string; nationality: string; era: string }[] };

// --- existing-corpus titles for dedup -----------------------------------
const manifest = JSON.parse(readFileSync(resolve(root, "corpus", "manifest.json"), "utf-8"));
const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|a|an|of|on|in|and|or|to)\b/g, " ").replace(/\s+/g, " ").trim();
const existing = new Set<string>();
const authorOf: Record<string, string> = {};
for (const [aslug, a] of Object.entries(manifest.authors) as [string, { name: string; works: string[] }][]) {
  for (const w of a.works) authorOf[w] = a.name;
}
for (const w of manifest.works as { slug: string; title: string }[]) {
  const an = authorOf[w.slug] ?? "";
  const surname = an.split(/\s+/).pop() ?? "";
  existing.add(`${surname.toLowerCase()}::${norm(w.title)}`);
}

// --- license policy ------------------------------------------------------
const RESTRICTIVE =
  /lawrence\s*&\s*wishart|international publishers|merlin press|monthly review|pathfinder|by (?:kind )?permission|non-?commercial|all rights reserved|\(c\)\s*\d{4}|©/i;
const PD_MARK =
  /public domain|you may freely copy|copy, distribute, display/i;
const CC_MARK =
  /copyleft|creative commons|gnu free documentation|gfdl|cc[- ]by[- ]sa/i;

function verdict(r: Row): { keep: boolean; reason: string } {
  const ev = r.license_evidence ?? "";
  // restrictive evidence always wins unless an explicit PD/CC grant covers this very text
  const restrictive = RESTRICTIVE.test(ev);
  switch (r.license_signal) {
    case "pd-explicit":
      if (!PD_MARK.test(ev)) return { keep: false, reason: "pd claimed but no PD wording in evidence" };
      return { keep: true, reason: "explicit public-domain statement" };
    case "copyleft":
      if (!CC_MARK.test(ev)) return { keep: false, reason: "copyleft claimed but no CC/GFDL wording in evidence" };
      if (restrictive && !/copyleft|creative commons/i.test(ev)) return { keep: false, reason: "mixed signals" };
      return { keep: true, reason: "MIA copyleft (CC/GFDL) transcription" };
    case "old-pd": {
      if (restrictive) return { keep: false, reason: "old-pd claimed but restrictive marker in evidence" };
      const yrs = [...ev.matchAll(/\b(1[5-9]\d\d)\b/g)].map((m) => parseInt(m[1]!, 10));
      const ty = r.translation_year ?? null;
      const okYear = (ty !== null && ty <= 1930) || yrs.some((y) => y <= 1930);
      if (!okYear) return { keep: false, reason: "old-pd claimed but no <=1930 year verifiable" };
      return { keep: true, reason: `pre-1931 publication/translation (${ty ?? yrs.filter((y) => y <= 1930).at(-1)})` };
    }
    default:
      return { keep: false, reason: `signal ${r.license_signal}` };
  }
}

// --- merge ---------------------------------------------------------------
const files = readdirSync(IN_DIR).filter((f) => f.endsWith(".json"));
const kept: (Row & { era: string; author_dates?: string; nationality?: string; slug: string })[] = [];
const report: Record<string, { author: string; title: string; url: string; signal: string; verdict: string; evidence: string }[]> = {
  kept: [], dropped_license: [], dropped_duplicate: [],
};

const metaByName = new Map<string, { dates: string; nationality: string; era: string }>();
for (const a of authorsMeta.authors) metaByName.set(a.name.toLowerCase(), a);
// the joint archives return individual (or differently-joined) author names
const ALIASES: Record<string, { dates: string; nationality: string; era: string }> = {
  "karl marx": { dates: "1818-1883", nationality: "German", era: "19th Century" },
  "frederick engels": { dates: "1820-1895", nationality: "German", era: "19th Century" },
  "friedrich engels": { dates: "1820-1895", nationality: "German", era: "19th Century" },
  "karl marx & frederick engels": { dates: "1818-1883 / 1820-1895", nationality: "German", era: "19th Century" },
  "karl marx and frederick engels": { dates: "1818-1883 / 1820-1895", nationality: "German", era: "19th Century" },
  "nikolai bukharin and evgeni preobrazhensky": { dates: "1888-1938 / 1886-1937", nationality: "Russian", era: "20th Century" },
  "william morris and e. belfort bax": { dates: "1834-1896 / 1854-1926", nationality: "British", era: "19th Century" },
  "henry mayers hyndman": { dates: "1842-1921", nationality: "British", era: "19th Century" },
  "ernest belfort bax": { dates: "1854-1926", nationality: "British", era: "19th Century" },
};
for (const [k, v] of Object.entries(ALIASES)) if (!metaByName.has(k)) metaByName.set(k, v);
// loose surname lookup too
const metaBySurname = new Map<string, { dates: string; nationality: string; era: string }>();
for (const a of authorsMeta.authors) {
  const sur = a.name.split(/\s+/).pop()!.toLowerCase();
  if (!metaBySurname.has(sur)) metaBySurname.set(sur, a);
}

const seen = new Set<string>();
const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

for (const f of files.sort()) {
  const data = JSON.parse(readFileSync(join(IN_DIR, f), "utf-8")) as { works: Row[] };
  for (const r of data.works ?? []) {
    if (!r?.title || !r?.url) continue;
    const surname = r.author.split(/\s+/).pop()!.toLowerCase();
    const key = `${surname}::${norm(r.title)}`;
    const entry = { author: r.author, title: r.title, url: r.url, signal: r.license_signal, verdict: "", evidence: (r.license_evidence ?? "").slice(0, 400) };
    if (seen.has(key)) { entry.verdict = "in-batch duplicate"; report.dropped_duplicate.push(entry); continue; }
    // a corpus hit that carries OUR derived uuid suffix is this pipeline's own
    // earlier apply, not a foreign duplicate — keep it (re-apply is idempotent)
    const mySlug = `${slugify(r.author)}-${slugify(r.title).slice(0, 50)}`;
    const myUuid6 = uuidFrom(`marxists:${mySlug}`).slice(0, 6);
    const isOurs = (manifest.works as { slug: string }[]).some((mw) => mw.slug.endsWith(`-${myUuid6}`));
    if (existing.has(key) && !isOurs) { entry.verdict = "already in corpus"; report.dropped_duplicate.push(entry); continue; }
    const v = verdict(r);
    entry.verdict = v.reason;
    if (!v.keep) { report.dropped_license.push(entry); continue; }
    seen.add(key);
    const meta = metaByName.get(r.author.toLowerCase()) ?? metaBySurname.get(surname);
    const era =
      r.year && r.year < 1500 ? "Medieval"
      : r.year && r.year < 1650 ? "Renaissance"
      : r.year && r.year < 1800 ? "Enlightenment"
      : r.year && r.year < 1900 ? "19th Century"
      : r.year ? "20th Century"
      : meta?.era ?? "19th Century";
    kept.push({ ...r, era, author_dates: meta?.dates, nationality: meta?.nationality, slug: `${slugify(r.author)}-${slugify(r.title).slice(0, 50)}` });
    report.kept.push(entry);
  }
}

writeFileSync(resolve(import.meta.dir, "marxists-worklist.json"), JSON.stringify({ works: kept }, null, 1));
writeFileSync(resolve(import.meta.dir, "license-report.json"), JSON.stringify(report, null, 1));
console.log(`kept ${kept.length}; dropped license ${report.dropped_license.length}; duplicates ${report.dropped_duplicate.length}`);
const counts: Record<string, number> = {};
for (const k of report.kept) counts[k.signal] = (counts[k.signal] ?? 0) + 1;
console.log("kept by signal:", counts);
