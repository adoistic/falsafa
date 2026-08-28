/**
 * Falsafa corpus reader (server-side, used at build time by Astro).
 *
 * Reads corpus/manifest.json + per-work index.md + per-chapter meta.json
 * + per-chapter variant .md files. Same on-disk schema as @falsafa/mcp,
 * but with a node-fs flavor and Astro-friendly types.
 *
 * Astro's getStaticPaths consumes these to generate pages.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to corpus/, relative to apps/site/src/lib/ → ../../../corpus */
export const CORPUS_ROOT = resolve(__dirname, "..", "..", "..", "..", "corpus");

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
  era: string;
  era_slug: string;
  genre: string;
  genre_slug: string;
  language: string;
  language_slug: string;
  language_direction: string;
  total_logical_chapters: number;
  total_variant_entries: number;
  published_year: number | null;
  difficulty: string | null;
  description: string;
  thothica_role: string;
}

export interface Manifest {
  generated_at: string;
  source: string;
  counts: { works: number; authors: number; eras: number; genres: number; languages: number };
  works: ManifestWork[];
  authors: Record<string, { name: string; works: string[] }>;
  eras: Record<string, { name: string; works: string[] }>;
  genres: Record<string, { name: string; works: string[] }>;
  languages: Record<string, { name: string; works: string[] }>;
}

export type Layout = "prose" | "verse" | "manuscript";
export type ContentType = "original" | "transliteration" | "translation" | "unknown";

export interface ChapterVariant {
  file: string;
  content_type: ContentType;
  variant_id: string;
  language: string;
  source_language: string;
  script: string;
  word_count: number;
  paragraph_count: number;
  has_image: boolean;
  source_url: string | null;
}

export interface ChapterMeta {
  work_slug: string;
  work_title: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  layout: Layout;
  layouts_in_variants: Layout[];
  default_variant: string;
  variants: ChapterVariant[];
}

export interface ChapterFrontmatter {
  work_id: string;
  work_slug: string;
  work_title: string;
  author_name: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  variant_id: string;
  content_type: ContentType;
  layout: Layout;
  language: string;
  source_language: string;
  language_direction: string;
  script: string;
  word_count: number;
  estimated_read_time: number | null;
  source_url: string | null;
  translator?: string;
  transliterator?: string;
  curator?: string;
  chapter_image?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Manifest + work-level access
// ─────────────────────────────────────────────────────────────────────────

let _manifest: Manifest | null = null;

export function manifest(): Manifest {
  if (!_manifest) {
    _manifest = JSON.parse(readFileSync(join(CORPUS_ROOT, "manifest.json"), "utf-8")) as Manifest;
  }
  return _manifest;
}

export function works(): ManifestWork[] {
  return manifest().works;
}

export function findWork(slug: string): ManifestWork | undefined {
  return works().find((w) => w.slug === slug);
}

// ─────────────────────────────────────────────────────────────────────────
// Chapters
// ─────────────────────────────────────────────────────────────────────────

/**
 * Per-work chapter list cache. Populated once per process — fine for
 * `astro build` (one-shot) but stale-prone for `astro dev` because Astro's
 * HMR doesn't re-import this module when corpus/.../meta.json changes on
 * disk (those aren't Vite-tracked source modules). Bypassing the cache in
 * dev keeps file rewrites (e.g. scripts/reclassify-variants.ts) visible
 * without a server restart.
 */
const _chapterCache = new Map<string, ChapterMeta[]>();
const IS_DEV = import.meta.env?.DEV === true;

export function listChapters(workSlug: string): ChapterMeta[] {
  if (!IS_DEV && _chapterCache.has(workSlug)) return _chapterCache.get(workSlug)!;
  const chaptersDir = join(CORPUS_ROOT, "works", workSlug, "chapters");
  if (!existsSync(chaptersDir)) return [];
  const entries = readdirSync(chaptersDir).filter((e) =>
    statSync(join(chaptersDir, e)).isDirectory(),
  );
  const metas = entries
    .map((e) => {
      const p = join(chaptersDir, e, "meta.json");
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, "utf-8")) as ChapterMeta;
    })
    .filter((m): m is ChapterMeta => m !== null)
    .sort((a, b) => a.chapter_number - b.chapter_number);
  if (!IS_DEV) _chapterCache.set(workSlug, metas);
  return metas;
}

export function getChapterMeta(workSlug: string, chapterSlug: string): ChapterMeta | undefined {
  return listChapters(workSlug).find((c) => c.chapter_slug === chapterSlug);
}

// ─────────────────────────────────────────────────────────────────────────
// Variant content
// ─────────────────────────────────────────────────────────────────────────

export interface ChapterVariantContent {
  meta: ChapterMeta;
  variant: ChapterVariant;
  frontmatter: ChapterFrontmatter;
  body: string;
}

export function readChapterVariant(
  workSlug: string,
  chapterSlug: string,
  variantContentType: ContentType,
): ChapterVariantContent | undefined {
  const meta = getChapterMeta(workSlug, chapterSlug);
  if (!meta) return undefined;
  const variant = meta.variants.find((v) => v.content_type === variantContentType);
  if (!variant) return undefined;
  const path = join(CORPUS_ROOT, "works", workSlug, "chapters", chapterSlug, variant.file);
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return { meta, variant, frontmatter: frontmatter as unknown as ChapterFrontmatter, body };
}

/**
 * One entry in a chapter variant's *.paragraphs.json sidecar.
 *
 * The sidecar is generated by the corpus build pipeline alongside the
 * markdown variant file. Each entry corresponds to one blank-line-
 * separated chunk of the source markdown (a heading, paragraph, list,
 * blockquote, etc.). The `id` is a content-hash; `offset` is the byte
 * offset into the markdown body (post-frontmatter); `text` is the
 * exact source markdown for that chunk.
 *
 * ChapterBody uses these to inject id="p-xxx" attributes onto the
 * rendered HTML so citation URLs can scroll to and highlight specific
 * paragraphs.
 */
export interface ParagraphSidecarEntry {
  id: string;
  offset: number;
  text: string;
}

/**
 * Read the *.paragraphs.json sidecar for a given chapter variant.
 * Returns [] if the sidecar is missing or unreadable — callers should
 * gracefully fall back to rendering without paragraph anchors.
 *
 * The sidecar filename is derived from the variant's `file` (e.g.
 * "translation.md" → "translation.paragraphs.json"), NOT the
 * content_type — they sometimes differ (translation-2.md exists in
 * a few chapters with content_type: "translation").
 */
export function readParagraphSidecar(
  workSlug: string,
  chapterSlug: string,
  variantFile: string,
): ParagraphSidecarEntry[] {
  const sidecarFile = variantFile.replace(/\.md$/, ".paragraphs.json");
  const path = join(CORPUS_ROOT, "works", workSlug, "chapters", chapterSlug, sidecarFile);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ParagraphSidecarEntry[];
  } catch {
    return [];
  }
}

/**
 * Read whichever variant the meta declares as the default. Used when the URL
 * doesn't specify a variant.
 */
export function readDefaultVariant(
  workSlug: string,
  chapterSlug: string,
): ChapterVariantContent | undefined {
  const meta = getChapterMeta(workSlug, chapterSlug);
  if (!meta) return undefined;
  const variant = meta.variants.find((v) => v.file === meta.default_variant);
  if (!variant) return undefined;
  return readChapterVariant(workSlug, chapterSlug, variant.content_type);
}

// ─────────────────────────────────────────────────────────────────────────
// Work index
// ─────────────────────────────────────────────────────────────────────────

export interface WorkIndex {
  frontmatter: Record<string, unknown>;
  body: string;
  cover_url: string | null;
}

export function readWorkIndex(workSlug: string): WorkIndex | undefined {
  const indexPath = join(CORPUS_ROOT, "works", workSlug, "index.md");
  if (!existsSync(indexPath)) return undefined;
  const raw = readFileSync(indexPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  // Cover URL: served from /covers/{slug}.webp by Astro, copied at build time
  const coverDiskPath = join(CORPUS_ROOT, "works", workSlug, "cover.webp");
  const coverUrl = existsSync(coverDiskPath) ? `/covers/${workSlug}.webp` : null;
  return { frontmatter, body, cover_url: coverUrl };
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter parser (minimal)
// ─────────────────────────────────────────────────────────────────────────

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const yamlRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const frontmatter = parseSimpleYaml(yamlRaw);
  return { frontmatter, body };
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = input.split("\n");
  let currentObj: Record<string, unknown> | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("  ") && currentObj !== null) {
      const m = line.trimStart().match(/^([\w_]+):\s*(.*)$/);
      if (m) currentObj[m[1]!] = parseYamlValue(m[2]!);
      continue;
    }
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === "" || v === undefined) {
        currentObj = {};
        result[k!] = currentObj;
      } else {
        result[k!] = parseYamlValue(v);
        currentObj = null;
      }
    }
  }
  return result;
}

function parseYamlValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────
// Convenience: every (work, chapter, variant) tuple — for getStaticPaths
// ─────────────────────────────────────────────────────────────────────────

export interface AllPathsEntry {
  work_slug: string;
  chapter_slug: string;
  variant_content_type: ContentType;
  is_default_variant: boolean;
}

export function allChapterVariantPaths(): AllPathsEntry[] {
  const entries: AllPathsEntry[] = [];
  for (const w of works()) {
    for (const c of listChapters(w.slug)) {
      const defaultVariant = c.variants.find((v) => v.file === c.default_variant);
      for (const v of c.variants) {
        entries.push({
          work_slug: w.slug,
          chapter_slug: c.chapter_slug,
          variant_content_type: v.content_type,
          is_default_variant: v.file === c.default_variant,
        });
      }
    }
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────
// Route-existence predicates
//
// Derived data (the atlas harvest, the eval set) carries work/chapter/variant
// references that can drift out of step with the corpus: a work is re-split,
// a chapter re-slugged, a variant dropped. Linking those blind produces dead
// deep links, which Search Console reports as "Not found (404)". Every
// generated deep link runs through here first.
// ─────────────────────────────────────────────────────────────────────────

let _variantPathSet: Set<string> | undefined;
let _chapterPathSet: Set<string> | undefined;
let _workSlugSet: Set<string> | undefined;

function pathSets() {
  if (_variantPathSet === undefined) {
    _variantPathSet = new Set();
    _chapterPathSet = new Set();
    _workSlugSet = new Set(works().map((w) => w.slug));
    for (const e of allChapterVariantPaths()) {
      _chapterPathSet.add(`${e.work_slug}/${e.chapter_slug}`);
      _variantPathSet.add(`${e.work_slug}/${e.chapter_slug}/${e.variant_content_type}`);
    }
  }
  return {
    variants: _variantPathSet,
    chapters: _chapterPathSet!,
    workSlugs: _workSlugSet!,
  };
}

/** Does /works/<work>/ exist? */
export function workExists(work: string): boolean {
  return pathSets().workSlugs.has(work);
}

/** Does /works/<work>/<chapter>/ exist (any variant)? */
export function chapterExists(work: string, chapter: string): boolean {
  return pathSets().chapters.has(`${work}/${chapter}`);
}

/** Does /works/<work>/<chapter>/<variant>/ exist as a built page? */
export function chapterVariantExists(
  work: string,
  chapter: string,
  variant: string,
): boolean {
  return pathSets().variants.has(`${work}/${chapter}/${variant}`);
}

/**
 * Best real URL for a (work, chapter, variant) reference, degrading rather
 * than 404ing: the exact variant if it exists, else another variant of the
 * same chapter, else the work page, else null (unknown work — render the
 * label unlinked).
 */
export function bestWorkHref(
  work: string,
  chapter?: string,
  variant?: string,
): string | null {
  if (!workExists(work)) return null;
  if (chapter && chapterExists(work, chapter)) {
    if (variant && chapterVariantExists(work, chapter, variant)) {
      return `/works/${work}/${chapter}/${variant}/`;
    }
    for (const v of ["translation", "transliteration", "original"]) {
      if (chapterVariantExists(work, chapter, v)) return `/works/${work}/${chapter}/${v}/`;
    }
  }
  return `/works/${work}/`;
}

// ─────────────────────────────────────────────────────────────────────────
// Work shape + chapter naming
//
// The single-chapter test was computed inline in three places and shared by
// none of them (works/[slug]/index.astro, [chapter]/[variant].astro, and a
// third reimplementation in plain JS at lib/sitemap-exclude.mjs). All of
// them converge here.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A work whose chapter IS the work. `/works/<slug>/` for these is a
 * `location.replace()` stub, not a page: 1,013 of 2,018 works, and — the
 * fact that shapes this whole feature — 269 of 357 harvested works and
 * 228 of 312 works that cite anything.
 */
export function isSingleChapterWork(slug: string): boolean {
  return listChapters(slug).length === 1;
}

/**
 * Where "the text" of a work actually opens, without a bounce. Multi-chapter
 * works get the work page; single-chapter works get the reader directly,
 * because the work page would only redirect there.
 */
export function workEntryHref(slug: string): string {
  const chs = listChapters(slug);
  if (chs.length !== 1) return `/works/${slug}/`;
  const c = chs[0];
  const t =
    c.variants.find((v) => v.file === c.default_variant)?.content_type ??
    c.variants[0]?.content_type ??
    "translation";
  return `/works/${slug}/${c.chapter_slug}/${t}/`;
}

/** "contents" for a table of contents; "the text" when there isn't one. */
export function workEntryLabel(slug: string): "contents" | "the text" {
  return isSingleChapterWork(slug) ? "the text" : "contents";
}

const _chapterTitleCache = new Map<string, Map<string, ChapterMeta>>();
function chapterMap(work: string): Map<string, ChapterMeta> {
  let m = _chapterTitleCache.get(work);
  if (!m || IS_DEV) {
    m = new Map(listChapters(work).map((c) => [c.chapter_slug, c]));
    _chapterTitleCache.set(work, m);
  }
  return m;
}

/** The chapter's own title from the corpus. Never a slug. */
export function chapterTitleOf(work: string, chapter: string): string | null {
  return chapterMap(work).get(chapter)?.chapter_title ?? null;
}

/** 1-based position in the work, for ordering loci in reading order. */
export function chapterNumberOf(work: string, chapter: string): number {
  return chapterMap(work).get(chapter)?.chapter_number ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The SHORT citation form of a chapter, for an index run: "book 1",
 * "letter 108", "ch. 12". Never the raw slug — the atlas currently prints
 * `capvt viii iure gentium inter quosvis liberam esse ¶` as a chapter label.
 * The full title is used wherever there is room for it (section heads,
 * the reader panel); this is for runs.
 */
const NUMBERED =
  /^(book|letter|chapter|part|canto|sonnet|ode|hymn|oration|epistle|discourse|section|fragment|volume|act|scene|tractate|sura|surah|kanda|parva|adhyaya|sarga|prasna|valli)[-_ ]?(\d+|[ivxlcdm]+)$/i;

export function locusLabel(work: string, chapter: string): string {
  const meta = chapterMap(work).get(chapter);
  const tail = chapter.replace(/^\d+[-–]/, "");
  const m = NUMBERED.exec(tail);
  if (m) return `${m[1].toLowerCase()} ${m[2].toLowerCase()}`;
  if (meta) {
    const t = meta.chapter_title.trim();
    if (t.length > 0 && t.length <= 28) return t.toLowerCase();
    return `ch. ${meta.chapter_number}`;
  }
  const n = parseInt(chapter, 10);
  return Number.isFinite(n) ? `ch. ${n}` : chapter.replace(/-/g, " ");
}
