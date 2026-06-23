#!/usr/bin/env bun
/**
 * Marxists Internet Archive (marxists.org) ingester.
 *
 * Reads scripts/marxists/marxists-worklist.json (produced by the crawl
 * workflow + merge-worklist.ts license policy). For each work: fetch the
 * entry page and chapter pages (via the official mirror, since marxists.org
 * direct is unreachable from this network), strip the MIA apparatus
 * (information blocks, transcription credits, navigation, footnote
 * sections), re-verify the license zones for restrictive markers, split into
 * chapters, and emit RawWork records in the shape scripts/convert.ts reads.
 * Apply with:
 *   bun run scripts/perseus/apply.ts marxists-works.json marxists-audit.json
 *
 * Licensing: only works that passed merge-worklist.ts ship in the worklist
 * (explicit public domain, MIA CC/GFDL copyleft transcriptions, or
 * translations/editions published 1930 or earlier). This ingester re-scans
 * every fetched page's information/footer zones and drops any work whose
 * pages carry restrictive markers (© publisher, "by permission",
 * non-commercial) without an explicit PD/CC grant. MIA is credited per work
 * and on /about#sources.
 *
 * Usage:
 *   bun run scripts/marxists/ingest.ts                 # full worklist
 *   bun run scripts/marxists/ingest.ts --limit 12      # first N works
 *   bun run scripts/marxists/ingest.ts --slug foo,bar  # specific slugs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { unshout } from "../lib/titlecase.ts";

const root = resolve(import.meta.dir, "..", "..");
const MIRROR = "https://marxists.architexturez.net";
const CANON = "https://www.marxists.org";
const CACHE = "/tmp/mia-cache";
const UA = "Mozilla/5.0 (compatible; FalsafaIngest/1.0; open-source library, contact siraj@thothica.com)";

interface WL {
  author: string;
  author_dates?: string;
  nationality?: string;
  title: string;
  year?: number | null;
  url: string;
  structure: "single" | "index";
  chapter_links?: string[];
  genre: string;
  era: string;
  translator?: string | null;
  license_signal: string;
  slug: string;
}

const uuidFrom = (s: string) => {
  const h = createHash("sha1").update(s).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join("-");
};

// ── entities ─────────────────────────────────────────────────────────────
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  sect: "§", para: "¶", deg: "°", middot: "·", bull: "•",
  dagger: "†", Dagger: "‡", prime: "′", Prime: "″",
  frac12: "½", frac14: "¼", frac34: "¾", times: "×", divide: "÷",
  plusmn: "±", minus: "−", pound: "£", euro: "€", cent: "¢", yen: "¥",
  copy: "©", reg: "®", trade: "™",
  aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å",
  szlig: "ß", thorn: "þ", eth: "ð", oelig: "œ", OElig: "Œ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", atilde: "ã",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", yacute: "ý", yuml: "ÿ",
  Eacute: "É", Egrave: "È", Ccedil: "Ç", Ouml: "Ö", Uuml: "Ü", Auml: "Ä",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  eta: "η", theta: "θ", lambda: "λ", mu: "μ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
};

function decodeEntities(s: string): string {
  const pass = (x: string) =>
    x.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-zA-Z][a-zA-Z0-9]{1,8});/g, (_, n) => NAMED[n] ?? " ");
  return pass(pass(s)); // twice: MIA pages contain double-encoded entities (&amp;middot;)
}

// ── fetching with cache ──────────────────────────────────────────────────
function cachePathFor(canonUrl: string): string {
  const p = canonUrl.replace(/^https?:\/\/(www\.)?marxists\.org\//, "").replace(/[#?].*$/, "");
  return join(CACHE, p);
}

async function fetchPage(canonUrl: string): Promise<string | null> {
  const cp = cachePathFor(canonUrl);
  if (existsSync(cp)) {
    const t = readFileSync(cp, "utf-8");
    if (t.length > 500) return t;
  }
  const mirrorUrl = canonUrl.replace(/^https?:\/\/(www\.)?marxists\.org/, MIRROR);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(mirrorUrl, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        // charset: header, then meta tag, default iso-8859-1 (MIA's norm)
        let cs = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
        if (!cs) {
          const head = buf.subarray(0, 2048).toString("latin1");
          cs = /charset=["']?([\w-]+)/i.exec(head)?.[1];
        }
        let text: string;
        try { text = new TextDecoder(cs?.toLowerCase() || "iso-8859-1").decode(buf); }
        catch { text = new TextDecoder("iso-8859-1").decode(buf); }
        if (text.length > 300 && !/cf-browser-verification|challenge-platform.{0,400}Not Found/s.test(text.slice(0, 1500))) {
          mkdirSync(dirname(cp), { recursive: true });
          writeFileSync(cp, text);
          return text;
        }
      }
    } catch { /* retry */ }
    await Bun.sleep(3000);
  }
  return null;
}

// ── license re-verification on fetched pages ─────────────────────────────
const RESTRICT_RE = /lawrence\s*&(?:amp;)?\s*wishart|international publishers|merlin press|monthly review press|pathfinder press|by (?:kind )?permission|non-?commercial|all rights reserved|©\s*(?:19|20)\d\d|&copy;\s*(?:19|20)\d\d|copyright\s*(?:©|&copy;)?\s*(?:19|20)\d\d/i;
const GRANT_RE = /public domain|you may freely copy|copyleft|creative commons|gnu free documentation/i;

/** Pull the license-relevant zones: information-class blocks + page tail. */
function licenseZones(html: string): string {
  const zones: string[] = [];
  for (const m of html.matchAll(/<p[^>]*class="[^"]*(?:information|footer)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)) zones.push(m[1]!);
  zones.push(html.slice(-2500));
  return decodeEntities(zones.join("\n").replace(/<[^>]+>/g, " "));
}

// ── content extraction ───────────────────────────────────────────────────
const SKIP_P_CLASS = /(information|footer|title|toc|index|next|prev|copyright|skip|linkback|updat|sig?nature|byline)/i;

function htmlToText(inner: string): string {
  let s = inner;
  s = s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "");          // note numbers
  s = s.replace(/<a[^>]*href="[^"]*#(?:f|n|note|fn)\d+[^"]*"[^>]*>[\s\S]*?<\/a>/gi, ""); // footnote refs
  // nav anchors that sit inline inside content paragraphs
  s = s.replace(/<a[^>]*>\s*(?:table of contents|contents|index|next chapter|previous chapter|next:?[^<]{0,80}|prev(?:ious)?:?[^<]{0,80}|top of (?:the )?page|back to[^<]{0,50}|[^<]{0,40}home page[^<]{0,20})\s*<\/a>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = decodeEntities(s.replace(/<[^>]+>/g, ""));
  s = s.replace(/\[\s*\d{1,3}\s*\]/g, "");                   // residual [1] markers
  s = s.replace(/\[[^\]]{0,200}(?:Marxists Internet Archive|marxists\.org|MIA)[^\]]{0,200}\]/g, ""); // MIA editorial interpolations
  s = s.replace(/\*{1,3}(?=\s|$)/g, "");                     // bare asterisk note marks
  return s.replace(/\s+/g, " ").trim();
}

function pageBody(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  const bs = s.search(/<body[^>]*>/i);
  if (bs >= 0) s = s.slice(s.indexOf(">", bs) + 1);
  s = s.replace(/<\/body>[\s\S]*$/i, "");
  // cut footnote / endnote sections in the trailing half of the page
  const half = Math.floor(s.length * 0.45);
  const tail = s.slice(half);
  const noteMark = tail.search(
    /<(?:h[1-6]|p)[^>]*>(?:<[^>]+>|\s)*(?:footnotes?|endnotes?|notes|author'?s? notes)\b/i,
  );
  if (noteMark >= 0) s = s.slice(0, half + noteMark);
  // cut at the transcription-credit hr block if it is the page tail
  return s;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function similarTitle(a: string, b: string): boolean {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (x.length > 8 && y.includes(x)) || (y.length > 8 && x.includes(y));
}

/** "Vladimir Ilyich Lenin" is a byline for author "Vladimir Lenin" */
function isByline(t: string, author: string): boolean {
  const ht = normTitle(t).split(" ");
  const at = normTitle(author).split(" ");
  if (ht.length === 0 || ht.length > 5 || at.length < 2) return false;
  return ht[0] === at[0] && ht[ht.length - 1] === at[at.length - 1];
}

/** chapter titles from the work's own table of contents: href -> anchor text */
function tocTitles(entryHtml: string, entryUrl: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of entryHtml.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs: string;
    try { abs = new URL(m[1]!, entryUrl).toString().replace(/#.*$/, ""); } catch { continue; }
    const t = htmlToText(m[2]!);
    if (!t || t.length < 3 || t.length > 160) continue;
    if (/^(next|prev|previous|index|contents|top|back|home|download|pdf|epub|mobi|word|zip)\b/i.test(t)) continue;
    // first anchor for a page wins (the TOC entry, not "continued" links)
    if (!map.has(abs)) map.set(abs, t.replace(/\s+/g, " ").slice(0, 120));
  }
  return map;
}

/** MIA chapter pages: h2 = author, first h3 = book title, a later h3/h4 = the
 * real chapter heading; <title> is "Author: code: CHAPTER TITLE". Walk all
 * headings in order and take the first that is not the work title, the
 * author, or apparatus. */
function pageTitle(html: string, fallback: string, workTitle = "", author = ""): string {
  const bad = (t: string) =>
    !t || t.length < 2 ||
    /marxists internet archive|internet archive|m\.?i\.?a\.?\s*:|library:|works archive|^(notes|footnotes?|endnotes?|contents|table of contents|index)$/i.test(t) ||
    similarTitle(t, workTitle) || similarTitle(t, author) || isByline(t, author);
  const cands: string[] = [];
  for (const m of html.matchAll(/<h([1-5])[^>]*>([\s\S]*?)<\/h\1>/gi)) cands.push(htmlToText(m[2]!));
  const pt = /<p[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (pt) cands.push(htmlToText(pt[1]!));
  for (const c of cands) if (!bad(c)) return c.slice(0, 120);
  // fall back to the <title> tag's last colon segment
  const tt = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (tt) {
    const t = htmlToText(tt[1]!);
    const seg = t.split(":").pop()?.trim() ?? "";
    if (!bad(seg)) return seg.slice(0, 120);
    if (!bad(t)) return t.slice(0, 120);
  }
  return fallback;
}

function paragraphsOf(frag: string): string[] {
  const out: string[] = [];
  for (const m of frag.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attrs = m[1]!;
    const cls = /class="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    if (cls && SKIP_P_CLASS.test(cls)) continue;
    const t = htmlToText(m[2]!);
    if (!t || t.length < 2 || !/[A-Za-z]/.test(t)) continue;
    // apparatus lines that slip through as plain <p>
    if (/^(transcribed|html markup|proof(?:ed|read)|source:|(?:first )?published:?\s|written:|translat(?:ed|ion):|delivered:|online version|copyleft|copyright|public domain:)/i.test(t) && t.length < 400) continue;
    // credit/license blocks in plain <p> tags, any length or position
    if (/public domain: marxists|please credit|marked up by .{0,60}(?:for the )?marxists|transcribed (?:and marked up |&amp; marked up )?by|copyleft: .{0,80}(?:marxists|internet archive)|creative commons \(attribute|transcription\/markup|online version: .{0,80}(?:internet archive|marxists\.org)/i.test(t)) continue;
    if (/^(next|prev(?:ious)?|table of contents|contents|index|top of (?:the )?page|back to)/i.test(t) && t.length < 80) continue;
    // breadcrumbs and site chrome
    if (/^\s*(?:MIA|M\.?I\.?A\.?|Marxists['’]? Internet Archive)\s*>/i.test(t)) continue;
    if (/marxists\.org|marxists internet archive|hypertext home page|@ marxists/i.test(t) && t.length < 200) continue;
    // trailing nav text fused to a real paragraph
    const t2 = t.replace(/\s*(?:Table of Contents|Top of (?:the )?Page|Next(?::| Chapter)[^.]{0,80}|Hegel-by-HyperText Home Page.{0,40})\s*$/i, "").trim();
    out.push(t2);
  }
  return out.filter((p) => p.length > 1);
}

interface Chapter { title: string; content: string; words: number; src: string }

/** single page -> one or more chapters (split on h3/h4 when >=2 with substance) */
function chapterizeSingle(html: string, fallbackTitle: string, src: string, workTitle = "", author = ""): Chapter[] {
  const body = pageBody(html);
  const re = /<h([34])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks: { index: number; end: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = htmlToText(m[2]!);
    if (!t || t.length < 2) continue;
    // headings that are the book title or author byline are page chrome, not splits
    if (similarTitle(t, workTitle) || similarTitle(t, author) || isByline(t, author)) continue;
    marks.push({ index: m.index, end: re.lastIndex, title: t.slice(0, 120) });
  }
  const whole = () => {
    const ps = paragraphsOf(body);
    const content = ps.join("\n\n");
    const words = content.split(/\s+/).filter(Boolean).length;
    return words < 50 ? [] : [{ title: fallbackTitle, content, words, src }];
  };
  // only split when there is enough substance for the pieces to stand alone
  const totalWords = body.split(/\s+/).length; // rough upper bound, refined below
  if (marks.length < 2 || totalWords < 3000) return whole();
  const chapters: Chapter[] = [];
  // preamble before the first heading
  const pre = paragraphsOf(body.slice(0, marks[0]!.index)).join("\n\n");
  if (pre.split(/\s+/).filter(Boolean).length >= 80) chapters.push({ title: fallbackTitle, content: pre, words: pre.split(/\s+/).length, src });
  for (let i = 0; i < marks.length; i++) {
    if (/^(contents|table of contents|footnotes?|notes|index)$/i.test(marks[i]!.title)) continue;
    const frag = body.slice(marks[i]!.end, marks[i + 1]?.index ?? body.length);
    const content = paragraphsOf(frag).join("\n\n");
    const words = content.split(/\s+/).filter(Boolean).length;
    if (words >= 50) chapters.push({ title: marks[i]!.title, content, words, src });
  }
  return chapters.length ? chapters : whole();
}

// ── work assembly ────────────────────────────────────────────────────────
function parseDates(d?: string): { birth: number | null; death: number | null } {
  const m = /(\d{4})\s*[-–]\s*(\d{4})?/.exec(d ?? "");
  return { birth: m ? parseInt(m[1]!, 10) : null, death: m?.[2] ? parseInt(m[2], 10) : null };
}

function makeWork(w: WL, chapters: Chapter[]) {
  const workId = uuidFrom(`marxists:${w.slug}`);
  const { birth, death } = parseDates(w.author_dates);
  const audits: unknown[] = [];
  const rawChapters = chapters.map((c, i) => {
    const chapterId = uuidFrom(`marxists:${w.slug}#${i + 1}`);
    audits.push({
      work_id: workId, chapter_id: chapterId, chapter_number: i + 1, chapter_title: c.title,
      content_type: "translation", layout: "prose", language_name: "English", script: "latin",
      word_count_actual: c.words, has_image: false, has_source_url: true,
      source_url: c.src,
      is_generic_title: /^(BOOK|CHAPTER|PART|SECTION|LECTURE|LETTER|ESSAY) /i.test(c.title), flags: [],
    });
    return {
      id: chapterId, title: c.title, content: c.content, chapter_number: i + 1, word_count: c.words,
      is_original: false, translator: w.translator || "Marxists Internet Archive edition",
    };
  });
  const words = chapters.reduce((s, c) => s + c.words, 0);
  const transNote = w.translator ? ` Translated by ${w.translator}.` : "";
  const raw = {
    id: workId, title: w.title,
    author: {
      id: uuidFrom(`author:${w.author}`), name: w.author,
      biography: `${w.author}${w.author_dates ? ` (${w.author_dates})` : ""}${w.nationality ? `, ${w.nationality}` : ""}.`,
      birth_year: birth, death_year: death, nationality: w.nationality ?? null,
    },
    era: { name: w.era }, genre: { name: w.genre }, language: { name: "English", direction: "ltr" },
    description: `${w.title}${w.year ? ` (${w.year})` : ""}, by ${w.author}.${transNote} From the Marxists Internet Archive.`,
    difficulty: "Advanced", is_published: true, published_year: w.year ?? null,
    total_chapters: chapters.length, chapters: rawChapters,
  };
  return { raw, audits, line: `${w.author}: ${w.title} — ${chapters.length} ch, ${words.toLocaleString("en-US")} w` };
}

// ── main ─────────────────────────────────────────────────────────────────
async function ingestWork(w: WL): Promise<{ raw?: unknown; audits?: unknown[]; line?: string; skip?: string; flags: string[] }> {
  const flags: string[] = [];
  const pages: { url: string; html: string }[] = [];
  const entry = await fetchPage(w.url);
  if (!entry) return { skip: `${w.slug}: entry fetch failed`, flags };

  let chapters: Chapter[] = [];
  if (w.structure === "index" && (w.chapter_links?.length ?? 0) > 0) {
    const seen = new Set<string>();
    const links = w.chapter_links!.map((u) => u.replace(/#.*$/, "")).filter((u) => {
      if (seen.has(u) || u === w.url.replace(/#.*$/, "")) return false;
      seen.add(u); return true;
    });
    const toc = tocTitles(entry, w.url);
    for (const link of links) {
      const html = await fetchPage(link);
      if (!html) { flags.push(`fetch-failed:${link}`); continue; }
      pages.push({ url: link, html });
      const tocT = toc.get(link);
      const fallback =
        tocT && !similarTitle(tocT, w.title) && !isByline(tocT, w.author)
          ? tocT
          : pageTitle(html, `Chapter ${chapters.length + 1}`, w.title, w.author);
      const got = chapterizeSingle(html, fallback, link, w.title, w.author);
      // one page may produce several chapters (h3/h4 sections), but only
      // keep the split when the pieces have real substance
      const gotWords = got.reduce((s, c) => s + c.words, 0);
      if (got.length > 1 && gotWords >= 4000 && got.every((c) => c.words >= 200)) chapters.push(...got);
      else if (got.length) {
        const content = got.map((c) => c.content).join("\n\n");
        chapters.push({ title: fallback, content, words: content.split(/\s+/).filter(Boolean).length, src: link });
      }
      await Bun.sleep(150);
    }
  } else {
    pages.push({ url: w.url, html: entry });
    chapters = chapterizeSingle(entry, w.title, w.url, w.title, w.author);
  }

  // normalize shouting MIA chapter titles ("THE CLASS STRUGGLE" -> "The Class
  // Struggle") before disambiguating; first clean a leading enumerator glued to
  // the title by an em-dash ("I.—THE PERIOD" -> "I. The Period") so the real
  // title capitalizes correctly rather than mangling the Roman numeral.
  for (const c of chapters) {
    c.title = unshout(c.title.replace(/^\s*(\d+|[IVXLCDM]+)\s*[.)]?\s*[—–-]\s*/i, "$1. "));
  }

  // disambiguate duplicate chapter titles (book-title chrome that slipped through)
  const seenTitles = new Map<string, number>();
  for (const c of chapters) {
    const n = (seenTitles.get(c.title) ?? 0) + 1;
    seenTitles.set(c.title, n);
    if (n > 1) c.title = `${c.title} (${n})`;
  }

  // license re-verification across all fetched pages of this work
  const zoneText = [licenseZones(entry), ...pages.map((p) => licenseZones(p.html))].join("\n");
  if (RESTRICT_RE.test(zoneText) && !GRANT_RE.test(zoneText)) {
    const marker = RESTRICT_RE.exec(zoneText)?.[0];
    return { skip: `${w.slug}: restrictive license marker on page ("${marker}")`, flags };
  }

  if (chapters.length === 0) return { skip: `${w.slug}: no chapters extracted`, flags };
  const total = chapters.reduce((s, c) => s + c.words, 0);
  if (total < 800) return { skip: `${w.slug}: too thin (${total} words)`, flags };
  const built = makeWork(w, chapters);
  return { ...built, flags };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]!, 10) : Infinity;
  const slugFilter = args.includes("--slug") ? new Set(args[args.indexOf("--slug") + 1]!.split(",")) : null;

  const wl = JSON.parse(readFileSync(resolve(import.meta.dir, "marxists-worklist.json"), "utf-8")) as { works: WL[] };
  let works = wl.works;
  if (slugFilter) works = works.filter((w) => slugFilter.has(w.slug));
  works = works.slice(0, limit);

  const rawWorks: unknown[] = [];
  const audits: unknown[] = [];
  const skipped: string[] = [];
  const allFlags: string[] = [];

  // modest work-level concurrency; page fetches are sequential within a work
  const CONC = 6;
  let idx = 0;
  async function lane() {
    while (idx < works.length) {
      const w = works[idx++]!;
      try {
        const r = await ingestWork(w);
        allFlags.push(...r.flags.map((f) => `${w.slug}: ${f}`));
        if (r.skip) { skipped.push(r.skip); console.log(`  SKIP ${r.skip}`); }
        else { rawWorks.push(r.raw); audits.push(...r.audits!); console.log(`  ${r.line}`); }
      } catch (e) {
        skipped.push(`${w.slug}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, lane));

  writeFileSync(resolve(root, "marxists-works.json"),
    JSON.stringify({ works: rawWorks, source: "Marxists Internet Archive (marxists.org) — public-domain and MIA copyleft (CC BY-SA) texts" }, null, 1));
  writeFileSync(resolve(root, "marxists-audit.json"), JSON.stringify({ audited_chapters: audits }, null, 1));
  console.log(`\n${rawWorks.length} works written to marxists-works.json (${skipped.length} skipped)`);
  if (allFlags.length) { console.log(`flags (${allFlags.length}):`); for (const f of allFlags.slice(0, 40)) console.log(`  ! ${f}`); }
  if (skipped.length) { console.log("skipped:"); for (const s of skipped) console.log(`  - ${s}`); }
}

await main();
