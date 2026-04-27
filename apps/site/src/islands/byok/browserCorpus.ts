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
 * List all chapter metadata for a work. Falls back to scanning chapter
 * dirs 01..total_logical_chapters since the per-work index doesn't always
 * carry full chapter metadata in the form we need.
 */
export async function listChapterMetas(slug: string): Promise<ChapterMeta[]> {
  const cached = cache.chapterMeta.get(slug);
  if (cached) return cached;

  // Need total chapter count from manifest.
  const manifest = await loadManifest();
  const work = manifest.works.find((w) => w.slug === slug);
  if (!work) {
    throw new Error(`work not in manifest: ${slug}`);
  }

  const metas: ChapterMeta[] = [];
  for (let i = 1; i <= work.total_logical_chapters; i++) {
    const chapterSlug = String(i).padStart(2, "0");
    try {
      const meta = await fetchJson<ChapterMeta>(
        `/corpus/works/${slug}/chapters/${chapterSlug}/meta.json`,
      );
      metas.push(meta);
    } catch (err) {
      // Some works may have non-zero-padded slugs or other quirks.
      // Skip silently and continue.
      continue;
    }
  }
  cache.chapterMeta.set(slug, metas);
  return metas;
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
    const records = await fetchJson<ParagraphRecord[]>(
      `/corpus/works/${slug}/chapters/${meta.chapter_slug}/${sidecar}`,
    );
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
