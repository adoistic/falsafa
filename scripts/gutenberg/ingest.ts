#!/usr/bin/env bun
/**
 * Project Gutenberg ingester for the philosophy shelf.
 *
 * For each work in gutenberg-worklist.json: fetch the plain-text ebook,
 * strip the PG header / license / footer boilerplate, drop the table of
 * contents, split into chapters on the book's own headings, reflow the
 * hard-wrapped lines into paragraphs, and emit RawWork records in the
 * shape scripts/convert.ts reads. Apply with:
 *   bun run scripts/perseus/apply.ts gutenberg-works.json gutenberg-audit.json
 *
 * Originals (a German/French edition of a kept English work) are ingested
 * as their OWN work, language tagged, content_type original — chapter
 * alignment across languages is too unreliable to force into variants.
 *
 * The underlying texts are public domain; Project Gutenberg is credited
 * on the site and in the corpus source. PG header/footer/license is
 * stripped, so no PG trademark text ships in the corpus.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");

interface WL {
  id: number;
  author: string;
  author_dates?: string;
  title: string;
  era: string;
  genre: string;
  language?: string; // English unless this entry is an original
  original_id?: number;
  original_language?: string;
}

function uuidFrom(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
}

async function fetchEbook(id: number): Promise<string | null> {
  // try the cache path then the files path
  for (const url of [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
  ]) {
    const res = await fetch(url);
    if (res.ok) {
      const t = await res.text();
      if (t.length > 500) return t;
    }
  }
  return null;
}

/** strip PG boilerplate; return the body text between the START/END markers */
function stripBoilerplate(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n");
  // body start: the *** START *** marker (modern) — else leave as-is
  const start = s.search(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  if (start >= 0) s = s.slice(start).replace(/^[^\n]*\n/, "");
  // body end: the *** END *** marker (modern) OR the older plain-text footers
  // ("End of Project Gutenberg's X", "End of the Project Gutenberg EBook",
  // "End of Project Gutenberg Etext"), whichever comes first.
  const endRe = /(\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK|End of (?:the )?Project Gutenberg(?:'s)?(?: EBook| Etext)?\b)/i;
  const ei = s.search(endRe);
  if (ei >= 0) s = s.slice(0, ei);

  // strip producer/transcriber apparatus that sits inside the body text:
  s = s.replace(/^[ \t]*Produced by[\s\S]*?(?:\n[ \t]*\n)/im, "\n"); // leading credit block
  s = s.replace(/\[?Transcriber'?s?\s+Note[s]?:?[\s\S]*?(?:\]|\n[ \t]*\n)/gi, " ");
  s = s.replace(/^[^\n]*\bProject Gutenberg\b[^\n]*$/gim, " "); // any stray PG line
  return s.trim();
}

// A chapter heading: a keyword + a numeral, optionally followed by a title on
// the same line. Covers English plus German/French editions of originals.
const HEADING =
  /^[ \t]*(BOOK|CHAPTER|PART|LETTER|ESSAY|SECTION|LECTURE|DIALOGUE|KAPITEL|HAUPTSTÜCK|ABSCHNITT|PARTIE|CHAPITRE|LIVRE)\s+([IVXLCDM]+|\d+|[A-ZÀ-Þ]+)\b[.: ]*(.*)$/i;
const ROMAN_ONLY = /^[ \t]*([IVXLCDM]{1,7})\.[ \t]*$/;

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  première: 1, premiere: 1, deuxième: 2, seconde: 2, troisième: 3, quatrième: 4,
  cinquième: 5, sixième: 6, septième: 7, huitième: 8, neuvième: 9, dixième: 10,
  erstes: 1, zweites: 2, drittes: 3, viertes: 4, fünftes: 5, sechstes: 6, siebentes: 7,
  achtes: 8, neuntes: 9, zehntes: 10, erste: 1, zweite: 2,
};

function romanToInt(s: string): number {
  const m: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let n = 0;
  const u = s.toUpperCase();
  for (let i = 0; i < u.length; i++) {
    const c = m[u[i]!]!, nx = m[u[i + 1]!] ?? 0;
    n += c < nx ? -c : c;
  }
  return n;
}

/** numeral of a heading mark: roman, arabic, or ordinal word -> int (NaN if none) */
function headingNum(numeral: string): number {
  if (/^\d+$/.test(numeral)) return parseInt(numeral, 10);
  if (/^[IVXLCDM]+$/i.test(numeral)) return romanToInt(numeral);
  return ORDINALS[numeral.toLowerCase()] ?? NaN;
}

interface Chapter { title: string; content: string; words: number }

/** clean a chapter body: drop page/footnote markers, italics underscores, reflow */
function cleanBody(text: string): string {
  let s = text;
  s = s.replace(/<\/?[a-zA-Z][^>]{0,60}>/g, ""); // HTML tags (<i>, </i>, <p>, <sc>...)
  s = s.replace(/&[a-z]+;|&#\d+;/gi, " "); // stray HTML entities
  s = s.replace(/\[(?:Pg|Page)\s+[ivxlcdm\d]+\]/gi, " ");
  s = s.replace(/\[Illustration[\s\S]*?\]/gi, " ");
  // footnotes: [Footnote ...] possibly spanning paragraphs, then any orphan
  // [Footnote that never closed (malformed source) to the end of its block
  s = s.replace(/\[Footnotes?\b[\s\S]*?\]/gi, " ");
  s = s.replace(/\[Footnotes?\b[\s\S]*?(?=\n[ \t]*\n|$)/gi, " ");
  s = s.replace(/\[\d+\]/g, ""); // footnote reference markers
  s = s.replace(/_([^_\n]+)_/g, "*$1*"); // PG italics -> markdown emphasis
  s = s.replace(/_{2,}/g, " "); // ASCII-art rule/table underscores
  // reflow: paragraphs separated by blank lines; join wrapped lines with a space
  const paras = s
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter((p) => {
      if (p.length === 0 || !/[A-Za-zÀ-ɏͰ-Ͽ]/.test(p)) return false;
      // drop ASCII-art / table blocks: paragraphs that are mostly non-letters
      const letters = (p.match(/[A-Za-zÀ-ɏͰ-Ͽ]/g) ?? []).length;
      return letters / p.length >= 0.55;
    });
  return paras.join("\n\n");
}

/** cut a leading table of contents: from a CONTENTS line to the first real
 *  prose paragraph (a blank-separated block of >=60 words). Many PG editions
 *  list chapter headings in the TOC that never recur in the body. */
function stripTOC(body: string): string {
  const m = body.match(/^[ \t]*(CONTENTS|TABLE OF CONTENTS)[. ]*$/im);
  if (!m || m.index === undefined || m.index > body.length * 0.5) return body;
  const after = body.slice(m.index + m[0].length);
  const paras = after.split(/\n[ \t]*\n/);
  let offset = m.index + m[0].length;
  for (const p of paras) {
    const words = p.trim().split(/\s+/).filter(Boolean);
    const joined = p.replace(/\s+/g, " ").trim();
    // first substantial flowing paragraph that is not itself a heading line
    if (words.length >= 60 && !HEADING.test(joined) && !ROMAN_ONLY.test(joined)) {
      // back up to the start of any short heading line(s) directly above it
      let cut = body.indexOf(p, offset);
      const pre = body.slice(0, cut).split("\n");
      let up = pre.length - 1;
      while (up > 0 && pre[up]!.trim() === "") up--;
      while (up > 0 && (HEADING.test(pre[up]!) || ROMAN_ONLY.test(pre[up]!) || (pre[up]!.trim().length < 70 && pre[up]!.trim() === pre[up]!.trim().toUpperCase()))) {
        cut = body.lastIndexOf("\n" + pre[up], cut) + 1;
        up--;
      }
      return body.slice(cut);
    }
    offset += p.length + 2;
  }
  return body;
}

/** split the body into chapters on the book's own headings, skipping the TOC */
function chapterize(rawBody: string, fallbackTitle: string): Chapter[] {
  const body = stripTOC(rawBody);
  const lines = body.split("\n");
  const single = (): Chapter[] => {
    const content = cleanBody(body);
    const w = content.split(/\s+/).filter(Boolean).length;
    return w < 50 ? [] : [{ title: fallbackTitle, content, words: w }];
  };

  // collect heading marks: {line, num, titleTail}
  type Mark = { line: number; num: number; title: string; key: string };
  let marks: Mark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const hm = l.match(HEADING);
    const rm = l.match(ROMAN_ONLY);
    if (hm) {
      const num = headingNum(hm[2]!);
      if (Number.isNaN(num)) continue;
      const inlineTail = (hm[3] ?? "").trim();
      // reject prose cross-references ("as I showed in Part I, that all things
      // ..."): a real heading's trailing text is a title (mostly uppercase),
      // not a lowercase sentence.
      if (inlineTail) {
        const letters = inlineTail.match(/[A-Za-z]/g) ?? [];
        const upper = inlineTail.match(/[A-Z]/g) ?? [];
        if (letters.length > 2 && upper.length / letters.length < 0.6) continue;
      }
      let title = `${cap(hm[1]!)} ${hm[2]!.toUpperCase()}`;
      const tail = inlineTail || sameLineTitle(lines, i);
      if (tail) title += " — " + tail.replace(/[.:]\s*$/, "");
      marks.push({ line: i, num, title, key: `${hm[1]!.toLowerCase()}:${num}` });
    } else if (rm) {
      marks.push({ line: i, num: romanToInt(rm[1]!), title: rm[1]!.toUpperCase(), key: `r:${romanToInt(rm[1]!)}` });
    }
  }
  // keyword headings (CHAPTER/BOOK/PART/...) are the real structure; only
  // fall back to bare roman lines when no keyword headings exist (else stray
  // "I." sub-items pollute the split).
  const keyword = marks.filter((m) => !m.key.startsWith("r:"));
  if (keyword.length >= 2) marks = keyword;

  if (marks.length < 2) return single();

  // cluster guard: if every heading sits in a contiguous patch of the text
  // (last mark - first mark spans < 45% of the lines), they are an index or
  // a translator's note listing, not the body's chapters. Ignore them.
  const span = (marks[marks.length - 1]!.line - marks[0]!.line) / lines.length;
  if (span < 0.45) return single();

  // collapse a table of contents: when a heading key repeats, the LAST
  // occurrence is the body (the first is the TOC listing). Keep last per key,
  // but only collapse if there ARE duplicates (otherwise honor every mark).
  const counts = new Map<string, number>();
  for (const m of marks) counts.set(m.key, (counts.get(m.key) ?? 0) + 1);
  if ([...counts.values()].some((c) => c > 1)) {
    const lastLine = new Map<string, number>();
    for (const m of marks) lastLine.set(m.key, m.line);
    marks = marks.filter((m) => lastLine.get(m.key) === m.line);
  }
  marks.sort((a, b) => a.line - b.line);

  const segs: Chapter[] = marks.map((mk, i) => {
    const to = marks[i + 1]?.line ?? lines.length;
    const content = cleanBody(lines.slice(mk.line + 1, to).join("\n"));
    return { title: mk.title, content, words: content.split(/\s+/).filter(Boolean).length };
  });
  // drop scraps (surviving TOC fragments, epigraphs): under 60 words
  const real = segs.filter((c) => c.words >= 60);
  if (real.length < 1) return single();
  // word-recovery guard: if splitting recovered less than 40% of the body's
  // words, the heading detection went wrong; keep the whole body as one
  // clean chapter rather than ship a fragmented husk.
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  const got = real.reduce((s, c) => s + c.words, 0);
  if (got < bodyWords * 0.4) return single();
  return real;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** an immediate short ALL-CAPS line after a bare heading becomes its subtitle */
function sameLineTitle(lines: string[], i: number): string {
  const a = (lines[i + 1] ?? "").trim();
  if (a && a.length < 70 && /[A-Za-z]/.test(a) && a === a.toUpperCase() && !HEADING.test(a) && !ROMAN_ONLY.test(a))
    return a;
  return "";
}

function makeWork(wl: WL, body: string, isOriginal: boolean) {
  const chapters = chapterize(body, wl.title);
  if (chapters.length === 0) return null;
  const id = isOriginal ? wl.original_id! : wl.id;
  const lang = isOriginal ? wl.original_language ?? "Unknown" : "English";
  const workId = uuidFrom(`gutenberg:${id}`);
  const ct = isOriginal ? "original" : "translation";
  const script = isOriginal && wl.original_language === "Greek" ? "greek" : "latin";
  const audits: unknown[] = [];
  const rawChapters = chapters.map((c, i) => {
    const chapterId = uuidFrom(`gutenberg:${id}#${i + 1}`);
    audits.push({
      work_id: workId, chapter_id: chapterId, chapter_number: i + 1, chapter_title: c.title,
      content_type: ct, layout: "prose", language_name: lang, script,
      word_count_actual: c.words, has_image: false, has_source_url: true,
      source_url: `https://www.gutenberg.org/ebooks/${id}`,
      is_generic_title: /^(BOOK|CHAPTER|PART|SECTION) /i.test(c.title), flags: [],
    });
    return {
      id: chapterId, title: c.title, content: c.content, chapter_number: i + 1,
      word_count: c.words, is_original: isOriginal,
      ...(isOriginal ? {} : { translator: "Project Gutenberg edition" }),
    };
  });
  const words = chapters.reduce((s, c) => s + c.words, 0);
  const titleSuffix = isOriginal ? ` (${wl.original_language} original)` : "";
  const raw = {
    id: workId,
    title: wl.title + titleSuffix,
    author: {
      id: uuidFrom(`author:${wl.author}`), name: wl.author,
      biography: `${wl.author}${wl.author_dates ? ` (${wl.author_dates})` : ""}.`,
      birth_year: null, death_year: null, nationality: null,
    },
    era: { name: wl.era },
    genre: { name: wl.genre },
    language: { name: lang, direction: "ltr" },
    description:
      `${wl.title}${titleSuffix}, ${wl.author_dates ? `by ${wl.author} (${wl.author_dates}), ` : ""}` +
      `from Project Gutenberg's public-domain text${isOriginal ? "" : ""}.`,
    difficulty: "Advanced",
    is_published: true,
    published_year: null,
    total_chapters: chapters.length,
    chapters: rawChapters,
  };
  return { raw, audits, line: `${wl.author}: ${wl.title}${titleSuffix} — ${chapters.length} ch, ${words.toLocaleString("en-US")} w` };
}

async function main() {
  const wl = JSON.parse(readFileSync(resolve(import.meta.dir, "gutenberg-worklist.json"), "utf-8")) as { works: WL[] };
  const rawWorks: unknown[] = [];
  const audits: unknown[] = [];
  const skipped: string[] = [];

  for (const w of wl.works) {
    const txt = await fetchEbook(w.id);
    if (!txt) { skipped.push(`${w.id} ${w.title}: fetch failed`); continue; }
    const built = makeWork(w, stripBoilerplate(txt), false);
    if (!built) { skipped.push(`${w.id} ${w.title}: no chapters`); continue; }
    rawWorks.push(built.raw); audits.push(...built.audits);
    console.log(`  ${built.line}`);

    if (w.original_id) {
      const otxt = await fetchEbook(w.original_id);
      if (otxt) {
        const ob = makeWork(w, stripBoilerplate(otxt), true);
        const engWords = (built.raw as { chapters: { word_count: number }[] }).chapters.reduce((s, c) => s + c.word_count, 0);
        const oWords = ob ? (ob.raw as { chapters: { word_count: number }[] }).chapters.reduce((s, c) => s + c.word_count, 0) : 0;
        // a "original" that is >2.5x the English is almost always a bundled
        // multi-work Gutenberg edition, not a clean pairing — drop it.
        if (ob && oWords <= engWords * 2.5) {
          rawWorks.push(ob.raw); audits.push(...ob.audits); console.log(`  ${ob.line}`);
        } else {
          skipped.push(`${w.original_id} ${w.title} original: ${ob ? `looks bundled (${oWords} vs ${engWords} w)` : "no chapters"}`);
        }
      } else skipped.push(`${w.original_id} ${w.title} original: fetch failed`);
    }
  }

  writeFileSync(resolve(root, "gutenberg-works.json"),
    JSON.stringify({ works: rawWorks, source: "Project Gutenberg (public-domain texts, www.gutenberg.org)" }, null, 1));
  writeFileSync(resolve(root, "gutenberg-audit.json"), JSON.stringify({ audited_chapters: audits }, null, 1));
  console.log(`\n${rawWorks.length} works written to gutenberg-works.json`);
  if (skipped.length) { console.log("skipped:"); for (const s of skipped) console.log(`  - ${s}`); }
}

await main();
