// Find untranslated sūkta-ranges per chapter by comparing the segmented source to the
// translated part files. Robust to failed/oversized chunks (anything not on disk shows as a
// gap) and idempotent (already-translated sūktas are skipped). Output is pre-split into
// small chunks so re-dispatches stay under the 32k subagent output ceiling.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function suktasInSource(segmentedFile: string): Set<number> {
  const s = new Set<number>();
  if (!existsSync(segmentedFile)) return s;
  for (const ln of readFileSync(segmentedFile, "utf-8").split("\n")) {
    const r = ln.split("\t")[0]?.split(".");
    if (r && r.length >= 2) s.add(parseInt(r[1]!, 10));
  }
  return s;
}

export function suktasTranslated(chapterDir: string): Set<number> {
  const s = new Set<number>();
  if (!existsSync(chapterDir)) return s;
  for (const f of readdirSync(chapterDir)) {
    if (!/^translation\.part\d+\.json$/.test(f)) continue;
    try {
      for (const v of JSON.parse(readFileSync(join(chapterDir, f), "utf-8"))) {
        const p = String(v.ref).split(".");
        if (p.length >= 2) s.add(parseInt(p[1]!, 10));
      }
    } catch {
      /* skip malformed part */
    }
  }
  return s;
}

export function missingRanges(segmentedFile: string, chapterDir: string): [number, number][] {
  const src = suktasInSource(segmentedFile);
  const tr = suktasTranslated(chapterDir);
  const miss = [...src].filter((x) => !tr.has(x)).sort((a, b) => a - b);
  const R: [number, number][] = [];
  for (const s of miss) {
    const l = R[R.length - 1];
    if (l && s === l[1] + 1) l[1] = s;
    else R.push([s, s]);
  }
  return R;
}

/** Split [a,b] into ≤size-sūkta chunks (keep ≤10 to stay under the 32k output ceiling). */
export function chunkRange([a, b]: [number, number], size = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let s = a; s <= b; s += size) out.push([s, Math.min(s + size - 1, b)]);
  return out;
}

// Texts in grind order. `seg` files + corpus chapters are named per unit; `chunk` is the
// max sub-units (sūktas/sargas) per dispatch — small enough to clear the 32k output ceiling.
interface WorkSpec {
  slug: string;
  segDir: string;
  segFile: (n: number) => string;
  chapter: (n: number) => string;
  units: number;
  chunk: number;
  unitName: string;
}
const WORKS: WorkSpec[] = [
  {
    slug: "rigveda-aufrecht",
    segDir: "t2work/gretil/segmented/rigveda",
    segFile: (n) => `mandala-${String(n).padStart(2, "0")}.txt`,
    chapter: (n) => `${String(n).padStart(2, "0")}-mandala-${n}`,
    units: 10,
    chunk: 10,
    unitName: "sūkta",
  },
  {
    slug: "valmiki-ramayana",
    segDir: "t2work/gretil/segmented/ramayana",
    segFile: (n) => `kanda-${String(n).padStart(2, "0")}.txt`,
    chapter: (n) => `${String(n).padStart(2, "0")}-kanda-${n}`,
    units: 7,
    chunk: 3, // sargas run long; keep chunks small
    unitName: "sarga",
  },
];

if (import.meta.main) {
  const ROOT = resolve(import.meta.dir, "..", "..");
  for (const w of WORKS) {
    let total = 0;
    const lines: string[] = [];
    for (let u = 1; u <= w.units; u++) {
      const chunks = missingRanges(
        join(ROOT, w.segDir, w.segFile(u)),
        join(ROOT, "corpus/works", w.slug, "chapters", w.chapter(u)),
      ).flatMap((r) => chunkRange(r, w.chunk));
      total += chunks.length;
      if (chunks.length) lines.push(`  unit ${u} (${w.chapter(u)}): ${chunks.map(([a, b]) => `${a}-${b}`).join(" ")}`);
    }
    if (total) {
      console.log(`NEXT WORK: ${w.slug}  | source ${w.segDir}/  | ${total} chunks (≤${w.chunk} ${w.unitName}s each)`);
      console.log(lines.join("\n"));
      process.exit(0); // only surface the first incomplete work
    }
  }
  console.log("ALL WORKS COMPLETE.");
}
