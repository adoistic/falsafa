// Mahābhārata chunk planner + verse-level gap detector.
//
// The MBh is huge (~73k verses, 18 parvas) and its adhyāyas vary wildly in size
// (some opening adhyāyas exceed 240 verses — far past the 32k subagent output
// ceiling). gaps.ts groups by adhyāya, which both overflows on big adhyāyas and
// can't see verse-level holes inside one. This planner works at the VERSE level:
// it diffs source refs (parva.adhyaya.verse) against translated part-file refs,
// then packs the missing verses — in source order — into contiguous spans of
// ≤MAX_VERSES, each described by [startRef, endRef]. A span may cross adhyāya
// boundaries (groups small adhyāyas) or be one slice of a big adhyāya (splits it).
//
// Idempotent: already-translated verses drop out, so re-runs only surface holes.
// Part files are named by the span's start ref (adhyāya*1000 + startVerse) so a
// given span always writes the same file. Like gaps.ts, it surfaces the first
// incomplete parva and prints "MAHABHARATA COMPLETE" when done.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_VERSES = 80; // safe margin under the 32k output ceiling for MBh verses
const PARVAS = 18;

export interface MbhChunk {
  part: string; // part-file basename suffix, e.g. "1001"
  startRef: string;
  endRef: string;
  count: number;
}

/** Source refs (parva.adhyaya.verse) in file order. */
export function sourceRefs(segFile: string): string[] {
  if (!existsSync(segFile)) return [];
  const out: string[] = [];
  for (const ln of readFileSync(segFile, "utf-8").split("\n")) {
    const r = ln.split("\t")[0];
    if (r && r.split(".").length === 3) out.push(r);
  }
  return out;
}

/** All translated refs across the chapter's part files. */
export function translatedRefs(chapterDir: string): Set<string> {
  const s = new Set<string>();
  if (!existsSync(chapterDir)) return s;
  for (const f of readdirSync(chapterDir)) {
    if (!/^translation\.part\d+\.json$/.test(f)) continue;
    try {
      for (const v of JSON.parse(readFileSync(join(chapterDir, f), "utf-8"))) s.add(String(v.ref));
    } catch {
      /* skip malformed part */
    }
  }
  return s;
}

/** Pack missing refs (in source order) into ≤MAX_VERSES contiguous spans. */
export function planChunks(segFile: string, chapterDir: string, max = MAX_VERSES): MbhChunk[] {
  const src = sourceRefs(segFile);
  const have = translatedRefs(chapterDir);
  const missing = src.filter((r) => !have.has(r));
  const chunks: MbhChunk[] = [];
  for (let i = 0; i < missing.length; i += max) {
    const slice = missing.slice(i, i + max);
    const startRef = slice[0]!;
    const endRef = slice[slice.length - 1]!;
    const [, adh, v] = startRef.split(".");
    const part = `${parseInt(adh!, 10) * 1000 + parseInt(v!, 10)}`;
    chunks.push({ part, startRef, endRef, count: slice.length });
  }
  return chunks;
}

if (import.meta.main) {
  const ROOT = resolve(import.meta.dir, "..", "..");
  const seg = (n: number) => join(ROOT, "t2work/gretil/segmented/mahabharata", `parva-${String(n).padStart(2, "0")}.txt`);
  const chap = (n: number) => join(ROOT, "corpus/works/mahabharata/chapters", `${String(n).padStart(2, "0")}-parva-${n}`);
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : 16; // how many chunks to surface

  for (let p = 1; p <= PARVAS; p++) {
    const segFile = seg(p);
    if (!existsSync(segFile)) continue;
    const chunks = planChunks(segFile, chap(p));
    if (chunks.length) {
      const total = sourceRefs(segFile).length;
      const done = total - chunks.reduce((a, c) => a + c.count, 0);
      console.log(`NEXT PARVA: ${p} (${String(p).padStart(2, "0")}-parva-${p}) | source parva-${String(p).padStart(2, "0")}.txt | ${done}/${total} verses done | ${chunks.length} chunks left (≤${MAX_VERSES} vv each)`);
      console.log(`Showing next ${Math.min(limit, chunks.length)}:`);
      for (const c of chunks.slice(0, limit)) {
        console.log(`  part${c.part}  ${c.startRef} → ${c.endRef}  (${c.count} vv)`);
      }
      process.exit(0);
    }
  }
  console.log("MAHABHARATA COMPLETE.");
}
