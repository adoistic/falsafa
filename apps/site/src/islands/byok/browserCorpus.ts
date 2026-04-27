/**
 * Browser-side corpus reader.
 *
 * Fetches Falsafa corpus assets via static HTTP from /corpus/* on the
 * site's own origin. Mirrors the file layout of the on-disk corpus,
 * which is exposed by apps/site/scripts/prepare-corpus.ts (a build-time
 * symlink from apps/site/public/corpus to ../../corpus at the repo root).
 *
 * Same-origin fetches only — no CORS surface, no API keys, no server.
 * Fits the static-deployment model exactly.
 *
 * Caches results in memory for the lifetime of the page so repeated
 * tool calls during one BYOK session don't re-fetch the same chapter.
 */

// ── Manifest types (subset; matches corpus/manifest.json shape) ────────

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
  total_logical_chapters: number;
  total_variant_entries: number;
  description: string;
  difficulty?: string;
  thothica_role?: string;
}

export interface Manifest {
  generated_at: string;
  source: string;
  counts: {
    works: number;
    authors: number;
    eras: number;
    genres: number;
    languages: number;
  };
  works: ManifestWork[];
  // The full manifest has many more keys (eras, authors, etc.) we don't
  // need from the browser. Cast as Record<string, unknown> elsewhere if
  // those become useful.
}

export interface ChapterMeta {
  chapter_number: number;
  chapter_slug: string;
  /** The on-disk meta.json field is `chapter_title`. We carry it as `title` too for code that prefers the shorter name. */
  chapter_title: string;
  title: string;
  default_variant: string; // e.g. "translation.md"
  variants: Array<{
    content_type: "original" | "transliteration" | "translation";
    file: string; // e.g. "translation.md"
    language?: string;
    direction?: string;
  }>;
}

export interface ParagraphRecord {
  paragraph_id: string;
  index: number;
  text: string;
}

/**
 * Raw shape on disk uses {id, offset, text}. We normalize to
 * {paragraph_id, index, text} in readParagraphs so consumers don't have
 * to know about both shapes.
 */
interface RawParagraphRecord {
  id: string;
  offset: number;
  text: string;
}

// ── Cache ────────────────────────────────────────────────────────────────

const cache = {
  manifest: null as Manifest | null,
  workIndex: new Map<string, string>(), // slug → raw markdown
  chapterMeta: new Map<string, ChapterMeta[]>(), // slug → array of all chapter metas
  chapterMd: new Map<string, string>(), // "slug/01/translation" → md
  paragraphs: new Map<string, ParagraphRecord[]>(), // "slug/01/translation" → records
  crossLinks: null as unknown,
};

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return await res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return (await res.json()) as T;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function loadManifest(): Promise<Manifest> {
  if (cache.manifest) return cache.manifest;
  cache.manifest = await fetchJson<Manifest>("/corpus/manifest.json");
  return cache.manifest;
}

/** Read the per-work index.md (raw markdown including frontmatter). */
export async function loadWorkIndex(slug: string): Promise<string> {
  const cached = cache.workIndex.get(slug);
  if (cached) return cached;
  const md = await fetchText(`/corpus/works/${slug}/index.md`);
  cache.workIndex.set(slug, md);
  return md;
}

/**
 * List all chapter metadata for a work.
 *
 * Chapter directories on disk are named one of two ways depending on the
 * work shape:
 *   - Single-chapter works: `chapters/01/` (no title slug)
 *   - Multi-chapter works: `chapters/01-{title-slug}/` (title slug appended)
 *
 * The browser can't list directories, so we discover the actual chapter
 * directory names by parsing the work's index.md, which contains a markdown
 * list of links like:
 *   01. [Title](./chapters/01-some-title-slug/) — verse, 3 variants
 *
 * From those links we extract the real directory names, then fetch
 * meta.json for each.
 */
export async function listChapterMetas(slug: string): Promise<ChapterMeta[]> {
  const cached = cache.chapterMeta.get(slug);
  if (cached) return cached;

  const indexMd = await loadWorkIndex(slug);
  const dirs = extractChapterDirs(indexMd);

  // Fall back to numeric padding if index parsing yields nothing
  // (defensive — should never happen with current corpus shape).
  if (dirs.length === 0) {
    const manifest = await loadManifest();
    const work = manifest.works.find((w) => w.slug === slug);
    const total = work?.total_logical_chapters ?? 0;
    for (let i = 1; i <= total; i++) {
      dirs.push(String(i).padStart(2, "0"));
    }
  }

  const metas: ChapterMeta[] = [];
  for (const dir of dirs) {
    try {
      const raw = await fetchJson<Record<string, unknown>>(
        `/corpus/works/${slug}/chapters/${dir}/meta.json`,
      );
      // Normalize the meta.json shape so callers can rely on `title` even
      // though the on-disk schema uses `chapter_title`.
      const title = (raw["chapter_title"] as string) ?? (raw["title"] as string) ?? `Chapter ${raw["chapter_number"] ?? "?"}`;
      const meta: ChapterMeta = {
        chapter_number: Number(raw["chapter_number"] ?? 0),
        chapter_slug: (raw["chapter_slug"] as string) ?? dir,
        chapter_title: title,
        title,
        default_variant: (raw["default_variant"] as string) ?? "translation.md",
        variants: (raw["variants"] as ChapterMeta["variants"]) ?? [],
      };
      metas.push(meta);
    } catch {
      // Skip silently and continue — a missing meta.json shouldn't kill
      // the whole list.
    }
  }
  cache.chapterMeta.set(slug, metas);
  return metas;
}

/** Parse markdown chapter links from a work's index.md. */
function extractChapterDirs(md: string): string[] {
  // Matches `[Title](./chapters/01-some-slug/)` or `[Title](./chapters/01/)`.
  const re = /\]\(\.\/chapters\/([^/)\s]+)\/?\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const dir = m[1];
    if (dir && !out.includes(dir)) out.push(dir);
  }
  return out;
}

export async function getChapterMeta(
  slug: string,
  chapterNumber: number,
): Promise<ChapterMeta> {
  const list = await listChapterMetas(slug);
  const m = list.find((c) => c.chapter_number === chapterNumber);
  if (!m) {
    const valid = list.map((c) => c.chapter_number).join(", ");
    throw new Error(`chapter ${chapterNumber} not in ${slug}. Valid: ${valid}`);
  }
  return m;
}

/**
 * Read the full markdown body of a chapter variant. Strips YAML
 * frontmatter so the LLM only sees the prose.
 */
export async function readChapterBody(
  slug: string,
  chapterNumber: number,
  variantType?: "original" | "transliteration" | "translation",
): Promise<{ meta: ChapterMeta; body: string; variantFile: string }> {
  const meta = await getChapterMeta(slug, chapterNumber);
  const variantFile = variantType
    ? meta.variants.find((v) => v.content_type === variantType)?.file
    : meta.default_variant;
  if (!variantFile) {
    const available = meta.variants.map((v) => v.content_type).join(", ");
    throw new Error(
      `variant '${variantType ?? "default"}' missing for ${slug}/${chapterNumber}. Available: ${available}`,
    );
  }

  const cacheKey = `${slug}/${meta.chapter_slug}/${variantFile}`;
  let raw = cache.chapterMd.get(cacheKey);
  if (!raw) {
    raw = await fetchText(
      `/corpus/works/${slug}/chapters/${meta.chapter_slug}/${variantFile}`,
    );
    cache.chapterMd.set(cacheKey, raw);
  }
  return { meta, body: stripFrontmatter(raw), variantFile };
}

export async function readParagraphs(
  slug: string,
  chapterNumber: number,
  variantFile: string,
): Promise<ParagraphRecord[]> {
  const meta = await getChapterMeta(slug, chapterNumber);
  const sidecar = variantFile.replace(/\.md$/, ".paragraphs.json");
  const cacheKey = `${slug}/${meta.chapter_slug}/${sidecar}`;
  const cached = cache.paragraphs.get(cacheKey);
  if (cached) return cached;
  try {
    const raw = await fetchJson<RawParagraphRecord[]>(
      `/corpus/works/${slug}/chapters/${meta.chapter_slug}/${sidecar}`,
    );
    // Normalize the on-disk shape (id, offset, text) into our canonical
    // shape (paragraph_id, index, text). `index` is the array position;
    // `offset` is the character offset in the source variant, not a
    // paragraph index — the model's paragraph_range queries treat 0-N as
    // sequential paragraph numbers, so we use array position as `index`.
    const records: ParagraphRecord[] = raw.map((r, i) => ({
      paragraph_id: r.id,
      index: i,
      text: r.text,
    }));
    cache.paragraphs.set(cacheKey, records);
    return records;
  } catch {
    cache.paragraphs.set(cacheKey, []);
    return [];
  }
}

export async function loadCrossLinks(): Promise<unknown> {
  if (cache.crossLinks !== null) return cache.crossLinks;
  try {
    cache.crossLinks = await fetchJson<unknown>("/corpus/cross-links.json");
  } catch {
    cache.crossLinks = {};
  }
  return cache.crossLinks;
}

// ── Frontmatter stripper ────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER_RE, "").trimStart();
}
