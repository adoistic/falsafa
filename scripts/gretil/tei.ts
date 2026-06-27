// GRETIL corpustei (TEI) cleaner + canonical chapterizer.
//
// Every verse carries a hierarchical n= reference — Rigveda "1.001.01a" =
// maṇḍala.sūkta.verse.pāda; Rāmāyaṇa "1.1.1" = kāṇḍa.sarga.verse — so we chapterize
// off that reference rather than fragile nested-<div> matching. One parser serves
// every corpustei text; only the (chapterLevel, paraLevel) indices change per work.

export interface VerseLine {
  ref: number[]; // numeric hierarchy levels, e.g. [1, 1, 1]
  pada: string; // trailing pāda letter (a/b/c…) or ""
  text: string;
}

/** Unwrap GRETIL's <orig> accent wrappers (keep the combining mark), strip other tags. */
export function cleanLine(raw: string): string {
  return raw
    .replace(/<orig>([\s\S]*?)<\/orig>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The work title from the titleStmt (NOT the sourceDesc edition title). */
export function teiTitle(xml: string): string {
  const head = xml.slice(0, xml.indexOf("</teiHeader>"));
  return /<title[^>]*>([\s\S]*?)<\/title>/.exec(head)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
}

/** Every <l n="…">…</l> in the body, with its reference parsed into numeric levels + pāda. */
export function parseTeiVerses(xml: string): VerseLine[] {
  const bodyStart = xml.indexOf("<body>");
  const body = bodyStart >= 0 ? xml.slice(bodyStart) : xml;
  const lines: VerseLine[] = [];
  const re = /<l\s+n="([^"]+)"\s*>([\s\S]*?)<\/l>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const nRaw = m[1]!;
    const text = cleanLine(m[2]!);
    if (!text) continue;
    const padaMatch = /([a-zA-Z])$/.exec(nRaw);
    const pada = padaMatch ? padaMatch[1]! : "";
    const numPart = pada ? nRaw.slice(0, -pada.length) : nRaw;
    const ref = numPart
      .split(/[.,]/)
      .map((x) => parseInt(x, 10))
      .filter((x) => !Number.isNaN(x));
    if (ref.length === 0) continue;
    lines.push({ ref, pada, text });
  }
  return lines;
}

export interface ChapterUnit {
  n: number;
  paragraphs: { ref: string; text: string }[];
}

/**
 * Group verse lines into canonical chapters at hierarchy index `chapterLevel`,
 * paragraphs at index `paraLevel`. Pādas/lines sharing a paragraph reference join in
 * document order (e.g. Rigveda chapterLevel=0 maṇḍala, paraLevel=2 verse).
 */
export function chapterize(lines: VerseLine[], chapterLevel: number, paraLevel: number): ChapterUnit[] {
  const chapters = new Map<number, Map<string, string[]>>();
  for (const ln of lines) {
    const ch = ln.ref[chapterLevel];
    if (ch === undefined) continue;
    const paraRef = ln.ref.slice(0, paraLevel + 1).join(".");
    if (!chapters.has(ch)) chapters.set(ch, new Map());
    const paras = chapters.get(ch)!;
    if (!paras.has(paraRef)) paras.set(paraRef, []);
    paras.get(paraRef)!.push(ln.text);
  }
  return [...chapters.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, paras]) => ({
      n,
      paragraphs: [...paras.entries()].map(([ref, texts]) => ({ ref, text: texts.join(" ") })),
    }));
}
