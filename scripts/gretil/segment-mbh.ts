// Segment the Mahābhārata (MBH1-18U.HTM) into per-parva txt files.
// Refs: P.AAA.SSS (parva.adhyāya.śloka, no leading zeros).
// Output: t2work/gretil/segmented/mahabharata/parva-NN.txt (18 parvas)
// Lines: <ref>\t<IAST text>
//
// gaps.ts reads level 1 (the adhyāya) for chunking — so batches are by adhyāya
// range within a parva.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseMbh } from "./mbh";

const ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(ROOT, "t2work/gretil/raw/mbh_parvas/MBH1-18U.HTM");
const OUT = join(ROOT, "t2work/gretil/segmented/mahabharata");

mkdirSync(OUT, { recursive: true });

console.log("Parsing Mahābhārata HTML (~17 MB)…");
const html = readFileSync(RAW, "utf-8");
const verses = parseMbh(html);
console.log(`  Total verses parsed: ${verses.length}`);

// Group by parva
const byParva = new Map<number, typeof verses>();
for (const v of verses) {
  if (!byParva.has(v.parva)) byParva.set(v.parva, []);
  byParva.get(v.parva)!.push(v);
}

let grandTotal = 0;
const parvas = [...byParva.keys()].sort((a, b) => a - b);
for (const p of parvas) {
  const pvVerses = byParva.get(p)!;
  const lines = pvVerses.map((v) => `${v.ref}\t${v.text}`);
  grandTotal += lines.length;
  const fname = `parva-${String(p).padStart(2, "0")}.txt`;
  writeFileSync(join(OUT, fname), lines.join("\n") + "\n");

  // Compute per-parva stats
  const adhyayaSet = new Set(pvVerses.map((v) => v.adhyaya));
  console.log(`  parva ${p}: ${adhyayaSet.size} adhyāyas, ${lines.length} verses -> ${fname}`);
}

console.log(`\nMahābhārata: 18 parvas, ${grandTotal} verses total`);
