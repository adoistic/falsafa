#!/usr/bin/env bun
/**
 * Online Library of Liberty (Liberty Fund) ingester — public-domain titles.
 *
 * Reads scripts/oll/oll-worklist.json (produced by the curation + license
 * scan; each entry is a PD title with its ePub S3 URL). For each: download
 * the ePub, unzip, read the spine, take the main content XHTML (skipping the
 * Liberty Fund cover / toc / colophon / copyright front-matter), split into
 * chapters on the heading tags, strip the editorial apparatus (Cannan-style
 * margin notes, footnote markers and footnote bodies), reflow the paragraphs,
 * and emit RawWork records. Apply with:
 *   bun run scripts/perseus/apply.ts oll-works.json oll-audit.json
 *
 * Only titles whose OLL page states "the text is in the public domain" are in
 * the worklist; Liberty Fund's own copyrighted editions/translations are
 * excluded upstream. OLL / Liberty Fund is credited on the site and per work.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { unshout } from "../lib/titlecase.ts";

const root = resolve(import.meta.dir, "..", "..");

interface WL {
  slug: string;
  author: string;
  author_dates?: string;
  title: string;
  era: string;
  genre: string;
  epub_url: string;
}

const uuidFrom = (s: string) => {
  const h = createHash("sha1").update(s).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", helip: "\u2026",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
  sect: "\u00a7", para: "\u00b6", deg: "\u00b0", degree: "\u00b0", micro: "\u00b5", acute: "\u00b4",
  aelig: "\u00e6", oslash: "\u00f8", eacute: "\u00e9", egrave: "\u00e8", agrave: "\u00e0",
  ocirc: "\u00f4", ecirc: "\u00ea", icirc: "\u00ee", acirc: "\u00e2", ccedil: "\u00e7",
  uuml: "\u00fc", ouml: "\u00f6", auml: "\u00e4", iuml: "\u00ef", euml: "\u00eb", ntilde: "\u00f1",
  mu: "\u03bc", phi: "\u03c6", eta: "\u03b7", alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3",
  delta: "\u03b4", pi: "\u03c0", lambda: "\u03bb", theta: "\u03b8", sigma: "\u03c3", omega: "\u03c9",
  pound: "\u00a3", euro: "\u20ac", cent: "\u00a2", times: "\u00d7", dagger: "\u2020",
  frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be", prime: "\u2032",
};
const KNOWN = Object.keys(NAMED_ENTITIES).sort((a, b) => b.length - a.length).join("|");

function decodeEntities(s: string): string {
  return s
    // OLL ePubs mis-encode some entities, turning the "&" into an "8"
    // (e.g. "8sect;" for the section sign); restore for known names only,
    // so real text like "8vo" (octavo) and "8th" survives.
    .replace(new RegExp(`8(${KNOWN});`, "g"), (_, n) => NAMED_ENTITIES[n]!)
    .replace(new RegExp(`&(${KNOWN});`, "g"), (_, n) => NAMED_ENTITIES[n]!)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-zA-Z][a-zA-Z0-9]{1,8};/g, " "); // drop any remaining unknown entity
}

const BOILERPLATE = /(^|[/_-])(cover|titlepage|half[-_]?title|toc|contents|nav|liberty_fund|online_library|online_library_of_liberty|copyright|colophon|series|amagi|banner)([._-]|$)/i;

/** OLL XHTML paragraph/heading text -> clean plain text */
function htmlToText(html: string): string {
  let s = html;
  // editorial apparatus woven into the text
  s = s.replace(/<span class="type-margin">[\s\S]*?<\/span><\/span>/g, " "); // Cannan margin notes
  s = s.replace(/<a[^>]*class="[^"]*footnote-link[^"]*"[^>]*>[\s\S]*?<\/a>/g, ""); // footnote ref markers
  s = s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, ""); // superscript note numbers
  s = decodeEntities(s.replace(/<[^>]+>/g, ""));
  s = s.replace(/Edition:\s*\w+;\s*Page:\s*\[\d+\]/g, " "); // OLL edition/page markers fused into headings
  return s.replace(/\s+/g, " ").trim();
}

interface Chapter { title: string; content: string; words: number }

/**
 * A bare section/paragraph marker, NOT a chapter heading. OLL ePubs render
 * every "§. 1." paragraph number as its own <h2> (id "..._label_..."), so the
 * naive "split on every heading" produced hundreds of one-paragraph chapters
 * (Two Treatises: 374). These markers carry no descriptive text — a real
 * chapter heading always does ("Chap. I.", "I: The Renaissance", "Of War").
 * We skip them as split points so their paragraphs fold into the chapter.
 */
function isSectionMarker(t: string): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  return (
    /^[§#]\s*\.?\s*\d+[a-z]?\s*\.?$/i.test(s) ||   // "§. 1."  "§ 12"  "#5"
    /^\d+\s*\.?$/.test(s) ||                          // "12."  "7"
    /^(p\.|pp\.|page)\s*\d+/i.test(s) ||              // page markers
    /^\[\s*\d+\s*\]$/.test(s)                          // "[14]"
  );
}

/** Editorial / front- / back-matter headings that shouldn't be chapters. */
function isApparatus(t: string): boolean {
  return /^(contents\b|table of contents|index(es)?\b|index of\b|the online library|liberty fund|copyright|advertisements?\b|bibliograph|errata|colophon|notes?\b|footnotes?|endnotes?|glossary\b|list of (illustrations|plates|maps|abbreviations)|works cited|references\.?$)/i.test(t)
    // library bookplates / donor stamps fused into the spine
    || /\b(college|library|brown-lindsay|ex libris|presented by|bequest)\b/i.test(t) && t.split(/\s+/).length <= 8;
}

function paragraphsOf(frag: string): string {
  const ps = [...frag.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .filter((mm) => !/(footnote|note|margin|tocpage|figure|chapterhead)/i.test(mm[1]!))
    .map((mm) => htmlToText(mm[2]!))
    .filter((p) => p.length > 0 && /[A-Za-z]/.test(p));
  return ps.join("\n\n");
}

/**
 * A chapter-level heading ("anchor"), as opposed to an in-chapter sub-section.
 * OLL ePubs render every <h2> at one tag level regardless of hierarchy (and
 * the id-class _head_/_label_ is NOT a consistent depth marker — in Locke
 * _head_ is the chapter, in Jevons it's the sub-section). The reliable signal
 * is the heading text: real chapters carry a structural keyword, a Roman-
 * numeral lead, or are short all-caps dividers; sub-sections are bare-numbered
 * ("§2.", "1. ...") or plain descriptive phrases.
 */
function isAnchor(title: string): boolean {
  const t = title.trim();
  // structural keyword + numeral, optionally after a leading word glued by a
  // dash ("APHORISMS—BOOK I"); standalone front/back-matter words; a Roman-
  // numeral lead; or a short all-caps / book-part divider.
  return /^(?:[a-zà-ÿ]+\s*[—–-]\s*)?(book|chap\.?|chapter|part|pt\.?|lecture|letter|essay|section|sect\.?|discourse|dialogue|canto|volume|vol\.?)\s+([ivxlcdm]+|\d+)\b/i.test(t)
    || /^(appendix|introduction|intro\b|preface|prefatory|prologue|epilogue|conclusion|foreword|dedication|argument)\b/i.test(t)
    || /^[IVXLCDM]{1,6}[.:)]/.test(t)        // "I:", "II.", "XIV)"
    || dividerContext(title) !== null;        // short all-caps / book-part divider
}

function chapterize(xhtml: string, fallbackTitle: string): Chapter[] {
  // body only
  const bodyStart = xhtml.search(/<body[^>]*>/i);
  const body = bodyStart >= 0 ? xhtml.slice(xhtml.indexOf(">", bodyStart) + 1) : xhtml;

  // heading marks; section/paragraph markers (§) are NOT split points — their
  // text folds into the surrounding chapter.
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const allMarks: { index: number; end: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = htmlToText(m[2]!);
    if (t && !isSectionMarker(t)) allMarks.push({ index: m.index, end: re.lastIndex, title: t });
  }

  // Two-level book: when chapter anchors are a clear minority of the headings,
  // the rest are in-chapter sub-sections — split on anchors only so their
  // prose folds into the chapter (Jevons "Money & the Mechanism": 183 headings
  // -> ~26 chapters; Fisher "Theory of Interest": 209 -> ~24). Flat books
  // (acton's lectures, essay collections) split on every heading.
  const anchors = allMarks.filter((mk) => isAnchor(mk.title));
  // require a meaningful heading count before trusting the 2-level heuristic —
  // a book with few headings (Novum Organum: 10) shouldn't be reduced to its
  // handful of anchors.
  const marks = allMarks.length >= 12 && anchors.length >= 2 && anchors.length < allMarks.length * 0.4 ? anchors : allMarks;

  if (marks.length < 2) {
    const content = paragraphsOf(body);
    const w = content.split(/\s+/).filter(Boolean).length;
    return w < 50 ? [] : [{ title: fallbackTitle, content, words: w }];
  }

  const chapters: Chapter[] = [];
  for (let i = 0; i < marks.length; i++) {
    const title = marks[i]!.title;
    // apparatus segments are dropped entirely (heading is a boundary so the
    // previous chapter ends here, but this section's own text is discarded)
    if (isApparatus(title)) continue;
    const frag = body.slice(marks[i]!.end, marks[i + 1]?.index ?? body.length);
    const content = paragraphsOf(frag);
    const words = content.split(/\s+/).filter(Boolean).length;
    // keep substantive sections AND content-less book/part dividers (their
    // title pages carry the context that disambiguates repeated chapter
    // titles); repairChapters folds the empty dividers into the next chapter
    if (words >= 50 || dividerContext(title))
      chapters.push({ title: title.replace(/\s+/g, " ").slice(0, 120), content, words });
  }
  return chapters;
}

/**
 * Work-level chapter repair (2026-06 corpus-doctor):
 *  1. ALL-CAPS titles -> title case
 *  2. duplicate titles get their book/part context as a prefix
 *     ("Book II, Chapter I. Of ..."), falling back to "(n)" suffixes
 *  3. chapters under 100 words merge into the following chapter (or the
 *     previous one when last); a "BOOK I"-style heading fragment donates
 *     its title as the merged chapter's prefix
 */
/**
 * A section/book divider: a short, (originally) all-caps title page like
 * "OF GOVERNMENT", "BOOK I", "THE SOCIAL CONTRACT". Its title becomes the
 * running context that disambiguates repeated chapter titles ("Chap. I."
 * appearing once per book). Detected on the RAW title before unshouting,
 * since the all-caps rendering is the signal.
 */
function dividerContext(rawTitle: string): string | null {
  const letters = rawTitle.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 0 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.7;
  const words = rawTitle.trim().split(/\s+/).length;
  if (/^(book|part|volume|appendix|treatise|discourse)\b/i.test(rawTitle) || (allCaps && words <= 8)) {
    return unshout(rawTitle).replace(/[.,;:\s]+$/, "").replace(/\s+/g, " ");
  }
  return null;
}

function repairChapters(chapters: Chapter[]): Chapter[] {
  // capture divider context from the raw (pre-unshout) titles
  const ctxOf = chapters.map((c) => dividerContext(c.title));
  for (const c of chapters) c.title = unshout(c.title);

  // 2. qualify duplicates with the running book/part/divider context
  const counts = new Map<string, number>();
  for (const c of chapters) counts.set(c.title, (counts.get(c.title) ?? 0) + 1);
  let ctx = "";
  const seen = new Map<string, number>();
  chapters.forEach((c, i) => {
    if (ctxOf[i]) ctx = ctxOf[i]!;
    if ((counts.get(c.title) ?? 0) > 1) {
      const n = (seen.get(c.title) ?? 0) + 1;
      seen.set(c.title, n);
      const qualified = ctx && !c.title.toLowerCase().startsWith(ctx.toLowerCase()) ? `${ctx}, ${c.title}` : `${c.title} (${n})`;
      c.title = qualified.slice(0, 120);
    }
  });
  // re-disambiguate any survivors
  const counts2 = new Map<string, number>();
  for (const c of chapters) {
    const n = (counts2.get(c.title) ?? 0) + 1;
    counts2.set(c.title, n);
    if (n > 1) c.title = `${c.title} (${n})`.slice(0, 120);
  }

  // 3. merge tiny fragments forward; a short divider donates its title as the
  // prefix of the chapter it precedes
  const out: Chapter[] = [];
  let pendingPrefix = "";
  let pendingContent = "";
  chapters.forEach((c, i) => {
    if (c.words < 100) {
      if (ctxOf[i]) pendingPrefix = ctxOf[i]!;
      pendingContent = pendingContent ? `${pendingContent}\n\n${c.content}` : c.content;
      return;
    }
    if (pendingPrefix && !c.title.toLowerCase().startsWith(pendingPrefix.toLowerCase()))
      c.title = `${pendingPrefix}, ${c.title}`.slice(0, 120);
    if (pendingContent) c.content = `${pendingContent}\n\n${c.content}`;
    c.words = c.content.split(/\s+/).filter(Boolean).length;
    pendingPrefix = ""; pendingContent = "";
    out.push(c);
  });
  if (pendingContent && out.length) {
    const last = out[out.length - 1]!;
    last.content = `${last.content}\n\n${pendingContent}`;
    last.words = last.content.split(/\s+/).filter(Boolean).length;
  }
  return out;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  return res.ok ? await res.text() : null;
}

function mainContentFiles(unzDir: string): string[] {
  const opfName = readdirSync(unzDir).find((f) => f.endsWith(".opf"));
  if (!opfName) return [];
  const opf = readFileSync(join(unzDir, opfName), "utf-8");
  // manifest id -> href
  const hrefById = new Map<string, string>();
  for (const it of opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)) hrefById.set(it[1]!, it[2]!);
  for (const it of opf.matchAll(/<item\b[^>]*href="([^"]+)"[^>]*id="([^"]+)"/g)) hrefById.set(it[2]!, it[1]!);
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((x) => x[1]!);
  return spine
    .map((id) => hrefById.get(id))
    .filter((h): h is string => !!h && /\.x?html?$/i.test(h) && !BOILERPLATE.test(h));
}

function makeWork(w: WL, chapters: Chapter[]) {
  const workId = uuidFrom(`oll:${w.slug}`);
  const audits: unknown[] = [];
  const rawChapters = chapters.map((c, i) => {
    const chapterId = uuidFrom(`oll:${w.slug}#${i + 1}`);
    audits.push({
      work_id: workId, chapter_id: chapterId, chapter_number: i + 1, chapter_title: c.title,
      content_type: "translation", layout: "prose", language_name: "English", script: "latin",
      word_count_actual: c.words, has_image: false, has_source_url: true,
      source_url: `https://oll.libertyfund.org/titles/${w.slug}`,
      is_generic_title: /^(BOOK|CHAPTER|PART|SECTION|LETTER) /i.test(c.title), flags: [],
    });
    return { id: chapterId, title: c.title, content: c.content, chapter_number: i + 1, word_count: c.words,
      is_original: false, translator: "Online Library of Liberty edition" };
  });
  const words = chapters.reduce((s, c) => s + c.words, 0);
  const raw = {
    id: workId, title: w.title,
    author: { id: uuidFrom(`author:${w.author}`), name: w.author,
      biography: `${w.author}${w.author_dates ? ` (${w.author_dates})` : ""}.`,
      birth_year: null, death_year: null, nationality: null },
    era: { name: w.era }, genre: { name: w.genre }, language: { name: "English", direction: "ltr" },
    description: `${w.title}${w.author_dates ? `, by ${w.author} (${w.author_dates})` : ""}, a public-domain text from Liberty Fund's Online Library of Liberty.`,
    difficulty: "Advanced", is_published: true, published_year: null,
    total_chapters: chapters.length, chapters: rawChapters,
  };
  return { raw, audits, line: `${w.author}: ${w.title} — ${chapters.length} ch, ${words.toLocaleString("en-US")} w` };
}

async function main() {
  const wl = JSON.parse(readFileSync(resolve(import.meta.dir, "oll-worklist.json"), "utf-8")) as { works: WL[] };
  const argv = process.argv.slice(2);
  if (argv.includes("--slug")) {
    const want = new Set(argv[argv.indexOf("--slug") + 1]!.split(","));
    wl.works = wl.works.filter((w) => want.has(w.slug));
  }
  const rawWorks: unknown[] = [];
  const audits: unknown[] = [];
  const skipped: string[] = [];

  for (const w of wl.works) {
    const tmp = mkdtempSync(join(tmpdir(), "oll-"));
    try {
      const epubPath = join(tmp, "book.epub");
      const res = await fetch(w.epub_url);
      if (!res.ok) { skipped.push(`${w.slug}: epub ${res.status}`); continue; }
      writeFileSync(epubPath, Buffer.from(await res.arrayBuffer()));
      execFileSync("unzip", ["-oq", epubPath, "-d", join(tmp, "unz")]);
      const unz = join(tmp, "unz");
      const files = mainContentFiles(unz);
      if (files.length === 0) { skipped.push(`${w.slug}: no content files`); continue; }
      const chapters: Chapter[] = [];
      for (const f of files) {
        const p = join(unz, f.replace(/^\.\//, ""));
        if (existsSync(p)) chapters.push(...chapterize(readFileSync(p, "utf-8"), w.title));
      }
      if (chapters.length === 0) { skipped.push(`${w.slug}: no chapters`); continue; }
      const repaired = repairChapters(chapters);
      if (repaired.length === 0) { skipped.push(`${w.slug}: no chapters after repair`); continue; }
      const built = makeWork(w, repaired);
      rawWorks.push(built.raw); audits.push(...built.audits);
      console.log(`  ${built.line}`);
    } catch (e) {
      skipped.push(`${w.slug}: ${(e as Error).message}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  writeFileSync(resolve(root, "oll-works.json"),
    JSON.stringify({ works: rawWorks, source: "Liberty Fund, Online Library of Liberty (public-domain texts, oll.libertyfund.org)" }, null, 1));
  writeFileSync(resolve(root, "oll-audit.json"), JSON.stringify({ audited_chapters: audits }, null, 1));
  console.log(`\n${rawWorks.length} works written to oll-works.json`);
  if (skipped.length) { console.log("skipped:"); for (const s of skipped) console.log(`  - ${s}`); }
}

await main();
