/**
 * Shared helpers for the Perseus ingesters (curated tranches and the full
 * archive). TEI flattening, chapter division, catalog parsing.
 */
import { createHash } from "node:crypto";

/** Deterministic UUID (v5-flavored) from a string, so re-runs are stable. */
export function uuidFrom(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Remove an element and its contents wherever it appears (non-nesting tags). */
export function stripElement(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "g");
  let prev = "";
  let out = xml;
  // notes occasionally nest one level; iterate until stable
  while (out !== prev) {
    prev = out;
    out = out.replace(re, " ");
  }
  return out;
}

/** TEI fragment -> array of plain-text paragraphs. */
export function fragmentToParagraphs(frag: string): { paragraphs: string[]; verseLines: number; proseParas: number } {
  let s = frag;
  s = stripElement(s, "note");
  s = stripElement(s, "reg");
  s = stripElement(s, "bibl");
  s = stripElement(s, "del");
  s = stripElement(s, "figDesc");
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/g, " ");
  // speaker labels in drama/dialogue keep their text inline
  s = s.replace(/<speaker\b[^>]*>([\s\S]*?)<\/speaker>/g, "$1: ");
  const verseLines = (s.match(/<l\b/g) ?? []).length;
  const proseParas = (s.match(/<p\b/g) ?? []).length;
  // verse lines become newline-separated; stanza/paragraph boundaries blank-line
  s = s.replace(/<\/l>/g, "\n");
  s = s.replace(/<\/(p|lg|sp|said|div[0-9]?)>/g, "\n\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // rejoin words hyphen-split across source line breaks ("sedi-\n tion")
  s = s.replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, "$1$2");
  // inline-tag stripping leaves orphan spaces before punctuation
  s = s.replace(/[ \t]+([,.;:!?\u2019\u201d)])/g, "$1");
  s = s.replace(/([(\u2018\u201c])[ \t]+/g, "$1");
  // Prose paragraphs reflow to single lines (TEI soft wraps are not
  // semantic); verse keeps its line breaks.
  const isVerse = verseLines >= 12 && verseLines > proseParas * 3;
  const rough = s
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean)
        .join(isVerse ? "\n" : " ")
        .replace(/[ \t]+([,.;:!?\u2019\u201d)\]])/g, "$1"),
    )
    .filter((p) => p.length > 0)
    // drop paragraphs that are only punctuation or sigla (any script counts)
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
  // merge paragraph breaks that fall mid-sentence: previous chunk lacks
  // sentence-final punctuation and the next begins lowercase
  const paragraphs: string[] = [];
  for (const p of rough) {
    const prev = paragraphs[paragraphs.length - 1];
    if (prev && !/[.!?;:'"\u2019\u201d)\]]$/.test(prev) && /^[a-z]/.test(p)) {
      paragraphs[paragraphs.length - 1] = `${prev} ${p}`;
    } else {
      paragraphs.push(p);
    }
  }
  return { paragraphs, verseLines, proseParas };
}

export const CHAPTER_SUBTYPES = ["book", "Book", "chapter", "poem", "act", "letter"];

export interface BuiltChapter {
  title: string;
  content: string;
  words: number;
  layout: "prose" | "verse";
}

/** Split the TEI body into chapters. */
export function buildChapters(xml: string, workTitle: string): BuiltChapter[] {
  const bodyStart = xml.indexOf("<body");
  const bodyEnd = xml.lastIndexOf("</body>");
  if (bodyStart < 0 || bodyEnd < 0) return [];
  const body = xml.slice(xml.indexOf(">", bodyStart) + 1, bodyEnd);

  // find chapter-level div openings
  const divRe = /<div[0-9]?\b[^>]*>/g;
  const marks: { index: number; n: string; subtype: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(body)) !== null) {
    const tag = m[0];
    const subtype = /subtype="([^"]+)"/.exec(tag)?.[1] ?? /type="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (CHAPTER_SUBTYPES.includes(subtype)) {
      const n = /\bn="([^"]+)"/.exec(tag)?.[1] ?? String(marks.length + 1);
      marks.push({ index: m.index, n, subtype });
    }
  }

  // When a work divides into books and the books into chapters (Herodotus,
  // Thucydides), the book is the reading unit; keep only book marks.
  const hasBooks = marks.some((mk) => mk.subtype.toLowerCase() === "book");
  const useMarks = hasBooks
    ? marks.filter((mk) => mk.subtype.toLowerCase() === "book")
    : marks;

  const chapters: BuiltChapter[] = [];
  const push = (title: string, frag: string) => {
    const { paragraphs, verseLines, proseParas } = fragmentToParagraphs(frag);
    const content = paragraphs.join("\n\n");
    const words = content.split(/\s+/).filter(Boolean).length;
    if (words < 50) return; // front matter scraps, empty divisions
    chapters.push({
      title,
      content,
      words,
      layout: verseLines >= 12 && verseLines > proseParas * 3 ? "verse" : "prose",
    });
  };

  if (useMarks.length >= 2) {
    for (let i = 0; i < useMarks.length; i++) {
      const frag = body.slice(useMarks[i]!.index, useMarks[i + 1]?.index ?? body.length);
      const label = useMarks[i]!.subtype.toLowerCase() === "book" ? "Book" : "Chapter";
      push(`${label} ${useMarks[i]!.n}`, frag);
    }
  } else {
    push(workTitle, body);
  }
  return chapters;
}

export async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

export interface CtsTranslation {
  urn: string;
  translator: string;
}

/** Parse __cts__.xml: pick the last English translation listed. */
export function pickEnglish(cts: string): CtsTranslation | null {
  const re = /<ti:translation\b[^>]*urn="([^"]+)"[^>]*xml:lang="eng"[^>]*>([\s\S]*?)<\/ti:translation>/g;
  let pick: CtsTranslation | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cts)) !== null) {
    const desc = /<ti:description[^>]*>([\s\S]*?)<\/ti:description>/.exec(m[2]!)?.[1] ?? "";
    const d = decodeEntities(desc);
    const lastFirst = /([A-Z][A-Za-z'-]+),\s*([A-Z][A-Za-z .'-]+?),\s*translator/.exec(d);
    const translatedBy = /translat(?:ed|ion)\s+by\s+([A-Z][A-Za-z .'-]+?)[.,]/.exec(d);
    const translator = lastFirst
      ? `${lastFirst[2]!.trim()} ${lastFirst[1]!.trim()}`
      : (translatedBy?.[1]?.trim() ?? "Perseus Digital Library");
    pick = { urn: m[1]!, translator };
  }
  return pick;
}

export interface CtsEdition {
  urn: string;
}

/** Pick the source-language edition (perseus-grc/lat): last one listed. */
export function pickEdition(cts: string): CtsEdition | null {
  const re = /<ti:edition\b[^>]*urn="([^"]+)"[^>]*>/g;
  let pick: CtsEdition | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cts)) !== null) pick = { urn: m[1]! };
  return pick;
}

