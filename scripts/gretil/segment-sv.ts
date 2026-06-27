// Segment Sāmaveda (samaveda.xml) into per-unit txt files.
//
// Structure: body lines inside <p> tags, each data line format:
//   A P R DDVV[pada] text...
// A = ārcika (1–4), P = prapāṭhaka, R = ardha,
// DDVV = 4-digit daśati+verse code (e.g. 0101 = daśati 1 verse 1),
// pada = a/b/c/etc. (the half-verse letter).
//
// 12 unique (arcika, prapāṭhaka) units:
//   1.1 1.2 1.3 1.4 1.5 1.6  (pūrvārcika: 6 prapāṭhakas, ~94–99 verses each)
//   2.0  (grāmageya, 55 verses)
//   3.0  (āraṇeya, 10 verses)
//   4.6 4.7 4.8 4.9  (uttarārcika: prapāṭhakas 6–9, ~56–66 verses each)
//
// Output: t2work/gretil/segmented/samaveda/prapathaka-NN.txt  (NN = unit 01–12)
// Ref format: <unitN>.<seqVerse>  where seqVerse = 1-based sequential verse number
// within the unit (in document order, based on DDVV sort).
//
// This keeps refs as consecutive integers so gaps.ts can form contiguous chunk ranges.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(ROOT, "t2work/gretil/raw/samaveda.xml");
const OUT = join(ROOT, "t2work/gretil/segmented/samaveda");

mkdirSync(OUT, { recursive: true });

const raw = readFileSync(RAW, "utf-8");

function cleanText(s: string): string {
  return s
    .replace(/<orig>([\s\S]*?)<\/orig>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-zA-Z]+;/g, " ")
    // Strip trailing colophon verse-number markers like " .. 96" or " . 5"
    .replace(/\s*\.\.?\s*\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Ordered unit definitions: [arcika, prapathaka] -> sequential unit number 1..12
const UNIT_ORDER: [number, number][] = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [2, 0],
  [3, 0],
  [4, 6], [4, 7], [4, 8], [4, 9],
];
const unitIndex = new Map<string, number>();
for (let i = 0; i < UNIT_ORDER.length; i++) {
  const [a, p] = UNIT_ORDER[i]!;
  unitIndex.set(`${a}.${p}`, i + 1);
}

// Match verse pāda lines: "  A P R DDVVp text..."
const lineRe = /^\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d{4})([a-z])\s+(.*?)$/;

// unitVerses: unitN -> Map<ddvv_str, pāda_texts[]>
// We group by DDVV (the 4-char verse code) and join pādas in document order
const unitVerses = new Map<number, Map<string, string[]>>();
for (let i = 1; i <= UNIT_ORDER.length; i++) unitVerses.set(i, new Map());

for (const line of raw.split("\n")) {
  const m = lineRe.exec(line);
  if (!m) continue;
  const arcika = parseInt(m[1]!, 10);
  const prapath = parseInt(m[2]!, 10);
  const ddvv = m[4]!; // e.g. "0101"
  const rawText = m[6]!;
  const text = cleanText(rawText);
  if (!text) continue;

  const key = `${arcika}.${prapath}`;
  const unitN = unitIndex.get(key);
  if (unitN === undefined) continue;

  const umap = unitVerses.get(unitN)!;
  if (!umap.has(ddvv)) umap.set(ddvv, []);
  umap.get(ddvv)!.push(text);
}

let totalVerses = 0;
for (let unitN = 1; unitN <= UNIT_ORDER.length; unitN++) {
  const verseMap = unitVerses.get(unitN)!;
  // Sort by DDVV integer value (document order within unit)
  const sorted = [...verseMap.entries()].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  const lines: string[] = [];
  let seq = 1;
  for (const [, texts] of sorted) {
    const text = texts.join(" ");
    lines.push(`${unitN}.${seq}\t${text}`);
    seq++;
  }
  totalVerses += lines.length;
  const fname = `prapathaka-${String(unitN).padStart(2, "0")}.txt`;
  writeFileSync(join(OUT, fname), lines.join("\n") + "\n");
  const [a, p] = UNIT_ORDER[unitN - 1]!;
  console.log(`  unit ${unitN} (ārcika ${a} prapāṭhaka ${p}): ${lines.length} verses -> ${fname}`);
}

console.log(`\nSāmaveda: 12 units (prapāṭhakas), ${totalVerses} verses total`);
