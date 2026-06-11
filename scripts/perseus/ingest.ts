#!/usr/bin/env bun
/**
 * Perseus tranche ingester.
 *
 * For each work in tranche-1.json:
 *   1. fetch data/{group}/{work}/__cts__.xml from the PerseusDL canonical repo
 *   2. pick the English translation URN (last -engN listed; later numbers are
 *      usually the better-encoded edition) and record the translator from the
 *      catalog description
 *   3. fetch the TEI XML of that translation
 *   4. flatten it to chapters of plain markdown paragraphs:
 *      chapter boundaries at div subtype book/chapter/poem/act; works with no
 *      such division (the shorter dialogues) become a single chapter
 *   5. emit RawWork records to perseus-works.json and audit entries to
 *      perseus-audit.json, in exactly the shapes scripts/convert.ts reads
 *
 * The convert step then regenerates the corpus with these works appended.
 * Deterministic UUIDs are derived from the CTS URN, so slugs and paragraph
 * IDs are stable across re-runs.
 *
 * Licensing: the Perseus TEI encodings are CC BY-SA 4.0; the underlying
 * translations in this tranche are public-domain (Loeb-era and older).
 * Each chapter records its Scaife reader URL as source_url.
 *
 * Run: bun run scripts/perseus/ingest.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const RAW = "https://raw.githubusercontent.com/PerseusDL";

interface TrancheAuthor {
  name: string;
  biography: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string;
}

interface TrancheWork {
  repo: string;
  group: string;
  work: string;
  title: string;
  author: TrancheAuthor;
  era: string;
  genre: string;
  language: string;
  description: string;
  difficulty: string;
  published_year: number;
  /** When the catalog description carries no usable translator credit. */
  translator_override?: string;
}

/** Deterministic UUID (v5-flavored) from a string, so re-runs are stable. */
function uuidFrom(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

function decodeEntities(s: string): string {
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
function stripElement(xml: string, tag: string): string {
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
function fragmentToParagraphs(frag: string): { paragraphs: string[]; verseLines: number; proseParas: number } {
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
    // drop paragraphs that are only punctuation or sigla
    .filter((p) => /[A-Za-z0-9]/.test(p));
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

const CHAPTER_SUBTYPES = ["book", "Book", "chapter", "poem", "act"];

interface BuiltChapter {
  title: string;
  content: string;
  words: number;
  layout: "prose" | "verse";
}

/** Split the TEI body into chapters. */
function buildChapters(xml: string, workTitle: string): BuiltChapter[] {
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

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

interface CtsTranslation {
  urn: string;
  translator: string;
}

/** Parse __cts__.xml: pick the last English translation listed. */
function pickEnglish(cts: string): CtsTranslation | null {
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

async function main() {
  // All tranche files contribute; the list grows one JSON file at a time.
  const trancheFiles = readdirSync(import.meta.dir)
    .filter((f) => /^tranche-\d+\.json$/.test(f))
    .sort();
  const tranche = { works: [] as TrancheWork[] };
  for (const f of trancheFiles) {
    const t = JSON.parse(readFileSync(resolve(import.meta.dir, f), "utf-8")) as {
      works: TrancheWork[];
    };
    tranche.works.push(...t.works);
    console.log(`${f}: ${t.works.length} works`);
  }

  const rawWorks: unknown[] = [];
  const auditedChapters: unknown[] = [];
  const skipped: string[] = [];

  for (const t of tranche.works) {
    const base = `${RAW}/${t.repo}/master/data/${t.group}/${t.work}`;
    const cts = await fetchText(`${base}/__cts__.xml`);
    if (!cts) {
      skipped.push(`${t.title}: no __cts__.xml`);
      continue;
    }
    const eng = pickEnglish(cts);
    if (!eng) {
      skipped.push(`${t.title}: no English translation in catalog`);
      continue;
    }
    if (t.translator_override) eng.translator = t.translator_override;
    const fileId = eng.urn.split(":").pop()!; // e.g. tlg0059.tlg002.perseus-eng2
    const xml = await fetchText(`${base}/${fileId}.xml`);
    if (!xml) {
      skipped.push(`${t.title}: TEI fetch failed for ${fileId}`);
      continue;
    }
    const chapters = buildChapters(xml, t.title);
    if (chapters.length === 0) {
      skipped.push(`${t.title}: no chapters extracted`);
      continue;
    }

    const workId = uuidFrom(eng.urn);
    const namespace = t.repo === "canonical-latinLit" ? "latinLit" : "greekLit";
    const rawChapters = chapters.map((c, i) => {
      const chapterId = uuidFrom(`${eng.urn}#${i + 1}`);
      auditedChapters.push({
        work_id: workId,
        chapter_id: chapterId,
        chapter_number: i + 1,
        chapter_title: c.title,
        content_type: "translation",
        layout: c.layout,
        language_name: "English",
        script: "latin",
        word_count_actual: c.words,
        has_image: false,
        has_source_url: true,
        source_url:
          chapters.length > 1
            ? `https://scaife.perseus.org/reader/urn:cts:${namespace}:${fileId}:${i + 1}`
            : `https://scaife.perseus.org/reader/urn:cts:${namespace}:${fileId}`,
        is_generic_title: /^(Book|Chapter) /.test(c.title),
        flags: [],
      });
      return {
        id: chapterId,
        title: c.title,
        content: c.content,
        chapter_number: i + 1,
        word_count: c.words,
        is_original: false,
        translator: eng.translator,
      };
    });

    rawWorks.push({
      id: workId,
      title: t.title,
      author: {
        id: uuidFrom(`author:${t.author.name}`),
        name: t.author.name,
        biography: t.author.biography,
        birth_year: t.author.birth_year,
        death_year: t.author.death_year,
        nationality: t.author.nationality,
      },
      era: { name: t.era },
      genre: { name: t.genre },
      language: { name: t.language, direction: "ltr" },
      description: `${t.description} Translated by ${eng.translator}.`,
      difficulty: t.difficulty,
      is_published: true,
      published_year: t.published_year,
      total_chapters: rawChapters.length,
      chapters: rawChapters,
    });

    const words = chapters.reduce((s, c) => s + c.words, 0);
    console.log(
      `${t.title}: ${chapters.length} chapters, ${words.toLocaleString("en-US")} words, tr. ${eng.translator} [${fileId}]`,
    );
  }

  writeFileSync(
    resolve(root, "perseus-works.json"),
    JSON.stringify(
      {
        works: rawWorks,
        source:
          "Perseus Digital Library, PerseusDL canonical repositories (TEI encodings CC BY-SA 4.0; translations in this tranche public domain)",
        exported_at: new Date().toISOString(),
      },
      null,
      1,
    ),
  );
  writeFileSync(
    resolve(root, "perseus-audit.json"),
    JSON.stringify({ audited_chapters: auditedChapters }, null, 1),
  );

  console.log(`\n${rawWorks.length} works written to perseus-works.json`);
  if (skipped.length > 0) {
    console.log(`Skipped (fix or drop from tranche, never silently):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
}

await main();
