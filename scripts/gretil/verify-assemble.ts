// Verify a fully-translated MBh parva (source-ref set vs translated-ref set across all
// translation.part*.json) and, if missing==0 AND fabricated==0, assemble the chapter.
// Usage: bun run scripts/gretil/verify-assemble.ts <parvaDirName>   e.g. 03-parva-3
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assembleChapter } from "./assemble.ts";

const dirName = process.argv[2];
if (!dirName) {
  console.error("usage: bun run scripts/gretil/verify-assemble.ts <parvaDirName>");
  process.exit(1);
}
const m = dirName.match(/^(\d+)-parva/);
if (!m) {
  console.error(`cannot derive parva number from "${dirName}"`);
  process.exit(1);
}
const parvaNum = String(Number(m[1])); // "03" -> "3"
const sourcePath = `t2work/gretil/segmented/mahabharata/parva-${m[1]}.txt`;
const chapterDir = join("corpus/works/mahabharata/chapters", dirName);

// source refs
const srcRefs = new Set<string>();
for (const line of readFileSync(sourcePath, "utf8").split("\n")) {
  const tab = line.indexOf("\t");
  if (tab < 0) continue;
  const ref = line.slice(0, tab).trim();
  if (ref) srcRefs.add(ref);
}

// translated refs
const transRefs = new Set<string>();
let dup = 0;
for (const f of readdirSync(chapterDir)) {
  if (!/^translation\.part.*\.json$/.test(f)) continue;
  const arr = JSON.parse(readFileSync(join(chapterDir, f), "utf8")) as Array<{ ref: string }>;
  for (const o of arr) {
    if (transRefs.has(o.ref)) dup++;
    transRefs.add(o.ref);
  }
}

const missing = [...srcRefs].filter((r) => !transRefs.has(r));
const fabricated = [...transRefs].filter((r) => !srcRefs.has(r));

console.log(`parva ${parvaNum} (${dirName})`);
console.log(`  source refs:     ${srcRefs.size}`);
console.log(`  translated refs: ${transRefs.size} (duplicates across parts: ${dup})`);
console.log(`  missing:         ${missing.length}${missing.length ? " -> " + missing.slice(0, 20).join(", ") : ""}`);
console.log(`  fabricated:      ${fabricated.length}${fabricated.length ? " -> " + fabricated.slice(0, 20).join(", ") : ""}`);

if (missing.length === 0 && fabricated.length === 0) {
  const n = assembleChapter(chapterDir, "mahabharata");
  console.log(`  ASSEMBLED ✓ — ${n} verses written to translation.paragraphs.json`);
} else {
  console.log(`  NOT ASSEMBLED — fix missing/fabricated first.`);
  process.exit(2);
}
