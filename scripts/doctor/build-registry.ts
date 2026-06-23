#!/usr/bin/env bun
/**
 * Merge the author-registry workflow output (/tmp/mia-registry/b*.json
 * research files + *-verify.json adversarial corrections) into the single
 * committed registry scripts/doctor/authors-registry.json that
 * enrich-authors.ts applies.
 *
 * Re-runnable: later workflow waves drop more b*.json files; re-run to fold
 * them in (last write wins per author name). Verify corrections for
 * birth_year/death_year/nationality/bio overwrite the field; published_year
 * corrections target the named work slug.
 *
 * Run: bun run scripts/doctor/build-registry.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const registryDir = "/tmp/mia-registry";
const out = resolve(import.meta.dir, "authors-registry.json");

interface WorkYear { slug: string; published_year: number | null; evidence?: string }
interface Rec {
  name: string; birth_year: number | null; death_year: number | null;
  nationality: string | null; bio: string; works: WorkYear[];
  confidence?: string; notes?: string;
}
interface Correction { name: string; field: string; slug?: string | null; new_value: unknown; reason?: string }

// Names the research fleet misattributed — verified wrong, excluded so the
// corpus keeps its correct (if thin) existing metadata. "George Hamilton":
// the agent described Mary Agnes Hamilton (translator of a different Guyot
// work); OLL attributes "The Comedy of Protection" to George Hamilton
// (1845-1909).
const EXCLUDE = new Set<string>(["George Hamilton"]);

const byName = new Map<string, Rec>();
const files = readdirSync(registryDir);
let batches = 0;
for (const f of files.filter((x) => /^b\d+\.json$/.test(x)).sort()) {
  const d = JSON.parse(readFileSync(join(registryDir, f), "utf-8")) as { authors: Rec[] };
  for (const a of d.authors ?? []) if (!EXCLUDE.has(a.name)) byName.set(a.name, a);
  batches++;
}

let corrections = 0;
const corrLog: string[] = [];
for (const f of files.filter((x) => /-verify\.json$/.test(x)).sort()) {
  const d = JSON.parse(readFileSync(join(registryDir, f), "utf-8")) as { corrections: Correction[] };
  for (const c of d.corrections ?? []) {
    const rec = byName.get(c.name);
    if (!rec) continue;
    if (c.field === "published_year" && c.slug) {
      const w = rec.works.find((x) => x.slug === c.slug);
      if (w) { w.published_year = c.new_value as number | null; corrections++; corrLog.push(`${c.name} [${c.slug}] year→${c.new_value}`); }
    } else if (c.field === "bio") {
      rec.bio = String(c.new_value); corrections++; corrLog.push(`${c.name} bio rewritten`);
    } else if (["birth_year", "death_year"].includes(c.field)) {
      (rec as unknown as Record<string, unknown>)[c.field] = c.new_value as number | null; corrections++; corrLog.push(`${c.name} ${c.field}→${c.new_value}`);
    } else if (c.field === "nationality") {
      rec.nationality = c.new_value as string | null; corrections++; corrLog.push(`${c.name} nationality→${c.new_value}`);
    }
  }
}

// ── self-heal pass ───────────────────────────────────────────────────────
// Some authors were excluded from research because ONE of their works
// carried good metadata, but their other works hold a placeholder bio
// ("Author record from the Perseus Digital Library") and no years. For any
// author not covered by research, synthesize a record from their own best
// existing corpus metadata so enrich-authors propagates it to every work.
const worksDir = resolve(import.meta.dir, "..", "..", "corpus", "works");
const PLACEHOLDER = /Author record from the Perseus|^.{0,39}$/;
let selfHealed = 0;
const corpusAgg = new Map<string, { bio: string; by: number | null; dy: number | null; nat: string | null }>();
for (const slug of readdirSync(worksDir)) {
  const p = join(worksDir, slug, "index.md");
  let text: string;
  try { text = readFileSync(p, "utf-8"); } catch { continue; }
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
  if (!fm) continue;
  const name = /^\s+name:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1];
  if (!name || byName.has(name)) continue;
  const bio = (/^\s+biography:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1] ?? "").trim();
  const by = /^\s+birth_year:\s*(-?\d+)/m.exec(fm)?.[1];
  const dy = /^\s+death_year:\s*(-?\d+)/m.exec(fm)?.[1];
  const nat = /^\s+nationality:\s*"?(.*?)"?\s*$/m.exec(fm)?.[1];
  const a = corpusAgg.get(name) ?? { bio: "", by: null, dy: null, nat: null };
  // a real bio never opens with the author's own name, "Author record from
  // the Perseus...", or "Works of unknown..." — those are ingest placeholders
  const isPlaceholder = bio.startsWith(name) || /^(Author record from the Perseus|Works of unknown)/.test(bio);
  if (bio.length > a.bio.length && !isPlaceholder) a.bio = bio;
  if (by && a.by == null) { a.by = parseInt(by, 10); a.dy = dy ? parseInt(dy, 10) : null; }
  if (nat && nat !== "null" && !a.nat) a.nat = nat;
  corpusAgg.set(name, a);
}
for (const [name, a] of corpusAgg) {
  // only heal when we actually have good data to propagate
  if (a.bio.length >= 40 && a.by != null) {
    byName.set(name, { name, birth_year: a.by, death_year: a.dy, nationality: a.nat, bio: a.bio, works: [], confidence: "self-heal" });
    selfHealed++;
  }
}

const authors = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), source: "marxists.org author-registry workflow + adversarial verify + corpus self-heal", authors }, null, 1));
console.log(`self-heal: ${selfHealed} authors recovered from best existing corpus metadata`);

const lowConf = authors.filter((a) => a.confidence && a.confidence !== "high");
console.log(`merged ${batches} batches → ${authors.length} authors; ${corrections} verify corrections`);
for (const c of corrLog.slice(0, 30)) console.log(`  · ${c}`);
if (lowConf.length) console.log(`\nlower-confidence (${lowConf.length}): ${lowConf.map((a) => `${a.name}[${a.confidence}]`).slice(0, 25).join(", ")}`);
console.log(`\nwritten ${out}`);
