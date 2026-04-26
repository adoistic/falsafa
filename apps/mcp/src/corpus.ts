/**
 * Corpus reader — filesystem-backed access to the Falsafa markdown corpus.
 *
 * The MCP server reads markdown directly from disk. No DB, no index, no LLM
 * inference. Just a fast librarian that knows where every file lives.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────
// Corpus root resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find the corpus root. Order:
 * 1. FALSAFA_CORPUS env var
 * 2. ./corpus relative to this file (when bundled with the npm package)
 * 3. ../../corpus relative to this file (when running from monorepo source)
 * 4. ./corpus relative to process.cwd() (fallback)
 */
export function resolveCorpusRoot(): string {
  if (process.env["FALSAFA_CORPUS"]) {
    const p = resolve(process.env["FALSAFA_CORPUS"]);
    if (existsSync(join(p, "manifest.json"))) return p;
  }
  // When bundled into npm tarball: corpus/ lives next to dist/
  const distDir = dirname(fileURLToPath(import.meta.url));
  const bundled = resolve(distDir, "..", "corpus");
  if (existsSync(join(bundled, "manifest.json"))) return bundled;
  // Monorepo source layout: apps/mcp/src/corpus.ts → ../../../corpus
  const monorepo = resolve(distDir, "..", "..", "..", "corpus");
  if (existsSync(join(monorepo, "manifest.json"))) return monorepo;
  // Last fallback: cwd
  const cwd = resolve(process.cwd(), "corpus");
  if (existsSync(join(cwd, "manifest.json"))) return cwd;
  throw new Error(
    "Falsafa corpus not found. Set FALSAFA_CORPUS env var to the corpus directory path.",
  );
}

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

export interface ChapterMeta {
  work_slug: string;
  work_title: string;
  chapter_number: number;
  chapter_title: string;
  chapter_slug: string;
  layout: "prose" | "verse" | "manuscript";
  layouts_in_variants: string[];
  default_variant: string;
  variants: ChapterVariant[];
}

export interface ChapterVariant {
  file: string;
  content_type: "original" | "transliteration" | "translation" | "unknown";
  variant_id: string;
  language: string;
  source_language: string;
  script: string;
  word_count: number;
  paragraph_count: number;
  has_image: boolean;
  source_url: string | null;
}

export interface ParagraphRecord {
  id: string;
  offset: number;
  text: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────

export class MCPError extends Error {
  constructor(
    public code:
      | "WORK_NOT_FOUND"
      | "CHAPTER_NOT_FOUND"
      | "VARIANT_NOT_FOUND"
      | "CHAPTER_OUT_OF_RANGE"
      | "PASSAGE_OUT_OF_RANGE"
      | "BAD_QUERY"
      | "INTERNAL",
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = "MCPError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Corpus accessor
// ─────────────────────────────────────────────────────────────────────────

export class Corpus {
  private root: string;
  private _manifest: Manifest | null = null;
  // Lazy caches
  private workChapterListCache = new Map<string, ChapterMeta[]>();

  constructor(root?: string) {
    this.root = root ?? resolveCorpusRoot();
  }

  get rootPath(): string {
    return this.root;
  }

  manifest(): Manifest {
    if (!this._manifest) {
      const path = join(this.root, "manifest.json");
      this._manifest = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
    }
    return this._manifest;
  }

  works(): ManifestWork[] {
    return this.manifest().works;
  }

  findWork(slug: string): ManifestWork | undefined {
    return this.works().find((w) => w.slug === slug);
  }

  /**
   * List all logical chapters of a work. Returns sorted by chapter_number.
   */
  listChapters(workSlug: string): ChapterMeta[] {
    if (this.workChapterListCache.has(workSlug)) {
      return this.workChapterListCache.get(workSlug)!;
    }
    const work = this.findWork(workSlug);
    if (!work) throw new MCPError("WORK_NOT_FOUND", `Work not found: ${workSlug}`);
    const chaptersDir = join(this.root, "works", workSlug, "chapters");
    if (!existsSync(chaptersDir)) {
      throw new MCPError("INTERNAL", `Chapters directory missing for ${workSlug}`);
    }
    const entries = readdirSync(chaptersDir).filter((e) =>
      statSync(join(chaptersDir, e)).isDirectory(),
    );
    const metas = entries
      .map((e) => {
        const metaPath = join(chaptersDir, e, "meta.json");
        if (!existsSync(metaPath)) return null;
        return JSON.parse(readFileSync(metaPath, "utf-8")) as ChapterMeta;
      })
      .filter((m): m is ChapterMeta => m !== null)
      .sort((a, b) => a.chapter_number - b.chapter_number);
    this.workChapterListCache.set(workSlug, metas);
    return metas;
  }

  getChapterMeta(workSlug: string, chapterNumber: number): ChapterMeta {
    const list = this.listChapters(workSlug);
    const m = list.find((c) => c.chapter_number === chapterNumber);
    if (!m)
      throw new MCPError(
        "CHAPTER_OUT_OF_RANGE",
        `Chapter ${chapterNumber} not found in ${workSlug}`,
        `Valid chapter numbers: ${list.map((c) => c.chapter_number).join(", ")}`,
      );
    return m;
  }

  /**
   * Read a chapter variant. variantType=null returns the default variant.
   */
  readChapter(
    workSlug: string,
    chapterNumber: number,
    variantType?: "original" | "transliteration" | "translation",
  ): { meta: ChapterMeta; variant: ChapterVariant; body: string; frontmatter: Record<string, unknown> } {
    const meta = this.getChapterMeta(workSlug, chapterNumber);
    const variantFile = variantType
      ? meta.variants.find((v) => v.content_type === variantType)?.file
      : meta.default_variant;
    if (!variantFile) {
      throw new MCPError(
        "VARIANT_NOT_FOUND",
        `Variant '${variantType ?? "default"}' not found in ${workSlug} chapter ${chapterNumber}`,
        `Available variants: ${meta.variants.map((v) => v.content_type).join(", ")}`,
      );
    }
    const variant = meta.variants.find((v) => v.file === variantFile)!;
    const filePath = join(this.root, "works", workSlug, "chapters", meta.chapter_slug, variantFile);
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    return { meta, variant, body, frontmatter };
  }

  /**
   * Read paragraph records for a variant. Used for stable citations.
   */
  readParagraphs(workSlug: string, chapterNumber: number, variantFile: string): ParagraphRecord[] {
    const meta = this.getChapterMeta(workSlug, chapterNumber);
    const sidecarFile = variantFile.replace(/\.md$/, ".paragraphs.json");
    const path = join(this.root, "works", workSlug, "chapters", meta.chapter_slug, sidecarFile);
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8")) as ParagraphRecord[];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter parser (minimal — enough for our YAML shape)
// ─────────────────────────────────────────────────────────────────────────

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: raw };
  const yamlRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const frontmatter = parseSimpleYaml(yamlRaw);
  return { frontmatter, body };
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  // Minimal YAML — handles flat key:value, JSON-quoted strings, numbers,
  // nulls, and one level of nesting. Sufficient for our frontmatter.
  const result: Record<string, unknown> = {};
  const lines = input.split("\n");
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("  ") && currentObj !== null) {
      const m = line.trimStart().match(/^([\w_]+):\s*(.*)$/);
      if (m) currentObj[m[1]!] = parseValue(m[2]!);
      continue;
    }
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (v === "" || v === undefined) {
        // Object follows on indented lines
        currentKey = k!;
        currentObj = {};
        result[k!] = currentObj;
      } else {
        result[k!] = parseValue(v);
        currentKey = null;
        currentObj = null;
      }
    }
  }
  return result;
}

function parseValue(s: string): unknown {
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
