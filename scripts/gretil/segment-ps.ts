// Segment Atharvaveda Paippalāda (atharvaveda_paippalada.xml) into per-kāṇḍa txt files.
// Refs: PS_K.S.V  (kāṇḍa.sūkta.verse) — same lg xml:id structure as the Rāmāyaṇa.
// Output: t2work/gretil/segmented/atharvaveda-ps/kanda-NN.txt
//         one line per verse: <K.S.V>\t<IAST text>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseTeiLgVerses } from "./tei";

const ROOT = resolve(import.meta.dir, "..", "..");
const RAW = join(ROOT, "t2work/gretil/raw/atharvaveda_paippalada.xml");
const OUT = join(ROOT, "t2work/gretil/segmented/atharvaveda-ps");

mkdirSync(OUT, { recursive: true });

const raw = readFileSync(RAW, "utf-8");
// Strip editorial <note>...</note> content entirely
// (inline refs like "PSK 20.1.1", variant readings "Bhatt. aṅgaṃ <sic>...</sic>", etc.)
// Notes may contain nested tags so we use a lazy [\s\S]*? match.
// IMPORTANT: use <note[>\s] to avoid matching <notesStmt> in the TEI header.
const xml = raw.replace(/<note[>\s][\s\S]*?<\/note>/g, "");

const verses = parseTeiLgVerses(xml);

// Group by kāṇḍa (ref level 0)
const byKanda = new Map<number, string[]>();
for (const v of verses) {
  const k = v.ref[0];
  if (k === undefined || !v.text) continue;
  const ref = v.ref.join(".");
  if (!byKanda.has(k)) byKanda.set(k, []);
  byKanda.get(k)!.push(`${ref}\t${v.text}`);
}

const kandas = [...byKanda.keys()].sort((a, b) => a - b);
let totalVerses = 0;
for (const k of kandas) {
  const lines = byKanda.get(k)!;
  totalVerses += lines.length;
  const fname = `kanda-${String(k).padStart(2, "0")}.txt`;
  writeFileSync(join(OUT, fname), lines.join("\n") + "\n");
}

console.log(`Atharvaveda Paippalāda: ${kandas.length} kāṇḍas, ${totalVerses} verses`);
console.log(`Kāṇḍas: ${kandas.join(", ")}`);
