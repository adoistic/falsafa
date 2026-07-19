// Assemble translation part-files (written by translation subagents) into a corpus chapter.
// Each part is a JSON array of {ref, sanskrit, english}; we merge, dedup by ref, sort by the
// numeric reference, assign deterministic p-ids, and emit the corpus chapter sidecars.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Part {
  ref: string;
  sanskrit: string;
  english: string;
}

/** Deterministic 6-hex paragraph id (FNV-1a) seeded by work + ref. */
export function pid(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return "p-" + (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function refKey(ref: string): number[] {
  return ref.split(/[.,]/).map((x) => parseInt(x, 10) || 0);
}

/** Merge parts: dedup by ref (last wins), sort by numeric reference. */
export function mergeParts(parts: Part[]): Part[] {
  const byRef = new Map<string, Part>();
  for (const p of parts) if (p && p.ref) byRef.set(p.ref, p);
  return [...byRef.values()].sort((a, b) => {
    const ka = refKey(a.ref);
    const kb = refKey(b.ref);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const d = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
}

/** Read translation.part*.json in a chapter dir → emit aligned sidecars + translation.md. */
export function assembleChapter(dir: string, workSlug: string): number {
  const parts: Part[] = [];
  for (const f of readdirSync(dir)) {
    if (/^translation\.part\d+\.json$/.test(f)) {
      try {
        parts.push(...(JSON.parse(readFileSync(join(dir, f), "utf-8")) as Part[]));
      } catch {
        /* skip a malformed part rather than fail the whole chapter */
      }
    }
  }
  const merged = mergeParts(parts);
  const trans = merged.map((p) => ({ id: pid(`${workSlug}:${p.ref}`), ref: p.ref, text: p.english }));
  const translit = merged.map((p) => ({ id: pid(`${workSlug}:${p.ref}`), ref: p.ref, text: p.sanskrit }));
  writeFileSync(join(dir, "translation.paragraphs.json"), JSON.stringify(trans, null, 2));
  writeFileSync(join(dir, "transliteration.paragraphs.json"), JSON.stringify(translit, null, 2));
  writeFileSync(join(dir, "translation.md"), merged.map((p) => `**${p.ref}**  ${p.english}`).join("\n\n"));
  return merged.length;
}
