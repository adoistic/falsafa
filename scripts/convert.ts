#!/usr/bin/env bun
/**
 * Phase 1 — Convert works.json to Markdown corpus
 *
 * Reads works.json + corpus-audit.json, emits the on-disk corpus structure:
 *
 *   corpus/
 *     manifest.json
 *     works/
 *       {author-slug}-{title-slug}-{uuid6}/
 *         index.md
 *         chapters/
 *           {NN}-{title-slug}/
 *             original.md           (when present)
 *             transliteration.md    (when present)
 *             translation.md        (when present)
 *             translation-2.md      (subsequent variants of the same type)
 *             meta.json
 *
 * Run: bun run convert
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { slugify, padChapterNumber, uuid6, workSlug, chapterSlug } from "./lib/slug.ts";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface RawAuthor {
  id?: string;
  name?: string;
  biography?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  nationality?: string | null;
  photo_url?: string | null;
}

interface RawWork {
  id: string;
  title: string;
  subtitle?: string | null;
  author?: RawAuthor;
  era?: { id?: string; name?: string; start_year?: number; end_year?: number; description?: string };
  genre?: { id?: string; name?: string; description?: string };
  language?: { id?: string; code?: string; name?: string; direction?: string };
  description?: string;
  difficulty?: string;
  is_published?: boolean;
  is_featured?: boolean;
  has_sections?: boolean;
  published_year?: number | null;
  cover_image_url?: string | null;
  total_chapters?: number;
  chapters: RawChapter[];
}

interface RawChapter {
  id: string;
  title?: string;
  content: string;
  chapter_number: number;
  word_count?: number;
  chapter_type?: string;
  is_original?: boolean;
  language_id?: string;
  image_url?: string | null;
  estimated_read_time?: number | null;
}

interface RawCorpus {
  works: RawWork[];
  source?: string;
  exported_at?: string;
}

type ContentType = "original" | "transliteration" | "translation" | "unknown";
type Layout = "prose" | "verse" | "manuscript";

interface AuditedChapter {
  work_id: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  content_type: ContentType;
  layout: Layout;
  language_name: string;
  script: string;
  word_count_actual: number;
  has_image: boolean;
  has_source_url: boolean;
  source_url: string | null;
  is_generic_title: boolean;
  flags: string[];
}

interface AuditData {
  audited_chapters: AuditedChapter[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf-8");
}

function yamlEscape(value: string | null | undefined): string {
  if (value == null) return '""';
  // Quote strings that contain YAML special chars or could be misinterpreted
  if (/[:#\-?@&*!|>'"%`{}\[\]\n]/.test(value) || /^[\s]/.test(value) || /[\s]$/.test(value)) {
    return JSON.stringify(value); // JSON-quote handles escaping
  }
  return value;
}

function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${typeof item === "string" ? yamlEscape(item) : item}`);
    } else if (typeof v === "object") {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 == null) continue;
        lines.push(`  ${k2}: ${typeof v2 === "string" ? yamlEscape(v2) : v2}`);
      }
    } else {
      lines.push(`${k}: ${typeof v === "string" ? yamlEscape(v) : v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Compute paragraph IDs for stable citation. A paragraph ID is a hash of the
 * paragraph's content, so it's deterministic across re-runs unless the content
 * itself changes.
 */
function computeParagraphIds(content: string): { content: string; ids: { id: string; offset: number; text: string }[] } {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
  const ids: { id: string; offset: number; text: string }[] = [];
  let offset = 0;
  let result = "";
  for (const para of paragraphs) {
    const trimmed = para.trim();
    // 6-char hash of the paragraph content
    const hash = simpleHash(trimmed).slice(0, 6);
    const id = `p-${hash}`;
    ids.push({ id, offset, text: trimmed });
    // Don't actually inject the IDs into the markdown body — we keep the
    // markdown clean and store the mapping in meta.json. Astro can compute
    // the same hashes at render time, or we precompute the rendered HTML
    // with anchor IDs and store separately.
    if (result) result += "\n\n";
    result += trimmed;
    offset += trimmed.length + 2;
  }
  return { content: result, ids };
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit, hex-encoded
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ─────────────────────────────────────────────────────────────────────────
// Variant filename allocation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Given multiple variants in the same logical chapter group, allocate
 * filenames. Multiple variants of the same type get suffixed: translation.md,
 * translation-2.md, translation-3.md.
 */
function allocateVariantFilenames(variants: { content_type: ContentType }[]): string[] {
  const counts = new Map<ContentType, number>();
  return variants.map((v) => {
    const seen = (counts.get(v.content_type) ?? 0) + 1;
    counts.set(v.content_type, seen);
    if (seen === 1) return `${v.content_type}.md`;
    return `${v.content_type}-${seen}.md`;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Conversion
// ─────────────────────────────────────────────────────────────────────────

interface ConvertSummary {
  works_written: number;
  logical_chapters_written: number;
  variant_files_written: number;
  errors: string[];
}

function convert(corpus: RawCorpus, audit: AuditData, outputDir: string): ConvertSummary {
  const summary: ConvertSummary = {
    works_written: 0,
    logical_chapters_written: 0,
    variant_files_written: 0,
    errors: [],
  };

  // Build audit lookup map: chapter_id -> AuditedChapter
  const auditByChapterId = new Map<string, AuditedChapter>();
  for (const a of audit.audited_chapters) {
    auditByChapterId.set(a.chapter_id, a);
  }

  // Manifest accumulators
  const manifest = {
    generated_at: new Date().toISOString(),
    source: corpus.source ?? "unknown",
    works: [] as Record<string, unknown>[],
    authors: new Map<string, { name: string; works: string[] }>(),
    eras: new Map<string, { name: string; works: string[] }>(),
    genres: new Map<string, { name: string; works: string[] }>(),
    languages: new Map<string, { name: string; works: string[] }>(),
  };

  // Wipe and recreate output directory
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  ensureDir(outputDir);

  for (const work of corpus.works) {
    if (!work.id || !work.title) {
      summary.errors.push(`Work missing id or title: ${JSON.stringify(work).slice(0, 100)}`);
      continue;
    }

    const authorName = work.author?.name ?? "Unknown";
    const wSlug = workSlug(authorName, work.title, work.id);
    const workDir = resolve(outputDir, "works", wSlug);
    ensureDir(workDir);

    // Group chapters by chapter_number → logical chapters
    const chapterGroups = new Map<number, RawChapter[]>();
    for (const ch of work.chapters ?? []) {
      const arr = chapterGroups.get(ch.chapter_number) ?? [];
      arr.push(ch);
      chapterGroups.set(ch.chapter_number, arr);
    }

    const logicalChapters: Record<string, unknown>[] = [];

    // Write each logical chapter directory
    for (const [chapterNumber, variants] of [...chapterGroups.entries()].sort((a, b) => a[0] - b[0])) {
      // Use the first variant's title as the canonical chapter title
      const canonicalTitle = variants[0]?.title ?? `Chapter ${chapterNumber}`;
      const auditFirst = auditByChapterId.get(variants[0]!.id);
      const isGeneric = auditFirst?.is_generic_title ?? false;
      const cSlug = chapterSlug(chapterNumber, canonicalTitle, isGeneric);
      const chapterDir = resolve(workDir, "chapters", cSlug);
      ensureDir(chapterDir);

      // Pull audit data for each variant; sort by content_type priority
      // (original, transliteration, translation) for stable filename allocation
      const variantsWithAudit = variants.map((v) => {
        const a = auditByChapterId.get(v.id);
        return {
          variant: v,
          audit: a,
          content_type: a?.content_type ?? "unknown",
        };
      });
      variantsWithAudit.sort((a, b) => {
        const order: ContentType[] = ["original", "transliteration", "translation", "unknown"];
        return order.indexOf(a.content_type) - order.indexOf(b.content_type);
      });

      const filenames = allocateVariantFilenames(
        variantsWithAudit.map((v) => ({ content_type: v.content_type as ContentType })),
      );

      const variantIndex: Record<string, unknown>[] = [];
      const layoutsDetected = new Set<Layout>();

      // Write each variant file
      for (let i = 0; i < variantsWithAudit.length; i++) {
        const { variant, audit: a, content_type } = variantsWithAudit[i]!;
        const filename = filenames[i]!;
        const layout = (a?.layout ?? "prose") as Layout;
        layoutsDetected.add(layout);

        const { content: cleanedContent, ids: paragraphIds } = computeParagraphIds(variant.content ?? "");

        // Derive variant-specific language: translations are English, originals
        // and transliterations are the work's source language.
        const workLanguage = work.language?.name ?? "unknown";
        const variantLanguage =
          content_type === "translation"
            ? "english"
            : workLanguage;
        // Direction follows language: English is ltr, original Urdu would be rtl,
        // but transliterations are always rendered in Latin so ltr.
        const variantDirection =
          content_type === "translation" || content_type === "transliteration"
            ? "ltr"
            : work.language?.direction ?? "ltr";

        // Build frontmatter
        const frontmatter: Record<string, unknown> = {
          work_id: work.id,
          work_slug: wSlug,
          work_title: work.title,
          author_name: authorName,
          chapter_number: chapterNumber,
          chapter_title: canonicalTitle,
          chapter_slug: cSlug,
          variant_id: variant.id,
          content_type,
          layout,
          language: variantLanguage,
          source_language: workLanguage,
          language_direction: variantDirection,
          script: a?.script ?? "unknown",
          word_count: a?.word_count_actual ?? variant.content?.split(/\s+/).filter(Boolean).length ?? 0,
          estimated_read_time: variant.estimated_read_time ?? null,
          source_url: a?.source_url ?? null,
        };

        // Add the appropriate Thothica credit byline based on content_type
        if (content_type === "translation") frontmatter.translator = "thothica";
        if (content_type === "transliteration") frontmatter.transliterator = "thothica";
        if (content_type === "original") frontmatter.curator = "thothica";

        // Manuscript pages
        if (variant.image_url) frontmatter.chapter_image = variant.image_url;

        const fm = buildFrontmatter(frontmatter);
        const body = `${fm}\n\n${cleanedContent}\n`;

        writeFile(resolve(chapterDir, filename), body);
        summary.variant_files_written++;

        variantIndex.push({
          file: filename,
          content_type,
          variant_id: variant.id,
          language: variantLanguage,
          source_language: workLanguage,
          script: a?.script ?? "unknown",
          word_count: frontmatter.word_count,
          paragraph_count: paragraphIds.length,
          has_image: !!variant.image_url,
          source_url: a?.source_url ?? null,
        });

        // Write the paragraph-id sidecar for this variant
        writeFile(
          resolve(chapterDir, filename.replace(/\.md$/, ".paragraphs.json")),
          JSON.stringify(paragraphIds, null, 2),
        );
      }

      // Pick the layout for the logical chapter (collapse if all match, else use the first)
      const primaryLayout: Layout = layoutsDetected.size === 1 ? [...layoutsDetected][0]! : "prose";

      // Determine the default variant (translation > transliteration > original)
      const defaultVariant = variantsWithAudit.find((v) => v.content_type === "translation")
        ? "translation.md"
        : variantsWithAudit.find((v) => v.content_type === "original")
        ? "original.md"
        : filenames[0]!;

      // Write meta.json for the logical chapter
      const meta = {
        work_slug: wSlug,
        work_title: work.title,
        chapter_number: chapterNumber,
        chapter_title: canonicalTitle,
        chapter_slug: cSlug,
        layout: primaryLayout,
        layouts_in_variants: [...layoutsDetected],
        default_variant: defaultVariant,
        variants: variantIndex,
      };
      writeFile(resolve(chapterDir, "meta.json"), JSON.stringify(meta, null, 2));

      logicalChapters.push({
        chapter_number: chapterNumber,
        chapter_slug: cSlug,
        chapter_title: canonicalTitle,
        layout: primaryLayout,
        variant_count: variantIndex.length,
      });

      summary.logical_chapters_written++;
    }

    // Write the work's index.md
    const workIndexFm: Record<string, unknown> = {
      id: work.id,
      slug: wSlug,
      title: work.title,
      subtitle: work.subtitle ?? null,
      author: {
        name: authorName,
        biography: work.author?.biography ?? null,
        birth_year: work.author?.birth_year ?? null,
        death_year: work.author?.death_year ?? null,
        nationality: work.author?.nationality ?? null,
      },
      era: work.era?.name ?? "Unknown",
      genre: work.genre?.name ?? "Unknown",
      language: work.language?.name ?? "unknown",
      language_direction: work.language?.direction ?? "ltr",
      description: work.description ?? "",
      difficulty: work.difficulty ?? null,
      published_year: work.published_year ?? null,
      total_logical_chapters: logicalChapters.length,
      total_variant_entries: (work.chapters ?? []).length,
      cover_image_url: work.cover_image_url ?? null,
      thothica_role: "catalog",
    };
    const workIndexBody =
      buildFrontmatter(workIndexFm) +
      "\n\n# " +
      work.title +
      "\n\n" +
      (work.description ?? "*No description available.*") +
      "\n\n## Chapters\n\n" +
      logicalChapters
        .map(
          (c) =>
            `${padChapterNumber(c.chapter_number as number)}. [${c.chapter_title}](./chapters/${c.chapter_slug}/) — ${c.layout}, ${c.variant_count} variant${c.variant_count === 1 ? "" : "s"}`,
        )
        .join("\n") +
      "\n";
    writeFile(resolve(workDir, "index.md"), workIndexBody);

    // Update manifest accumulators
    const eraSlug = slugify(work.era?.name ?? "unknown");
    const genreSlug = slugify(work.genre?.name ?? "unknown");
    const languageSlug = slugify(work.language?.name ?? "unknown");
    const authorSlug = slugify(authorName);

    manifest.works.push({
      slug: wSlug,
      title: work.title,
      author: authorName,
      author_slug: authorSlug,
      era: work.era?.name ?? "Unknown",
      era_slug: eraSlug,
      genre: work.genre?.name ?? "Unknown",
      genre_slug: genreSlug,
      language: work.language?.name ?? "unknown",
      language_slug: languageSlug,
      language_direction: work.language?.direction ?? "ltr",
      total_logical_chapters: logicalChapters.length,
      total_variant_entries: (work.chapters ?? []).length,
      published_year: work.published_year ?? null,
      difficulty: work.difficulty ?? null,
      description: work.description ?? "",
      thothica_role: "catalog",
    });

    const updateMap = (
      m: Map<string, { name: string; works: string[] }>,
      key: string,
      name: string,
      slug: string,
    ) => {
      const e = m.get(key) ?? { name, works: [] };
      e.works.push(slug);
      m.set(key, e);
    };
    updateMap(manifest.authors, authorSlug, authorName, wSlug);
    updateMap(manifest.eras, eraSlug, work.era?.name ?? "Unknown", wSlug);
    updateMap(manifest.genres, genreSlug, work.genre?.name ?? "Unknown", wSlug);
    updateMap(manifest.languages, languageSlug, work.language?.name ?? "unknown", wSlug);

    summary.works_written++;
  }

  // Write the manifest
  const manifestObject = {
    generated_at: manifest.generated_at,
    source: manifest.source,
    counts: {
      works: manifest.works.length,
      authors: manifest.authors.size,
      eras: manifest.eras.size,
      genres: manifest.genres.size,
      languages: manifest.languages.size,
    },
    works: manifest.works,
    authors: Object.fromEntries(manifest.authors),
    eras: Object.fromEntries(manifest.eras),
    genres: Object.fromEntries(manifest.genres),
    languages: Object.fromEntries(manifest.languages),
  };
  writeFile(resolve(outputDir, "manifest.json"), JSON.stringify(manifestObject, null, 2));

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

function main(): void {
  const root = resolve(import.meta.dir, "..");
  const worksJsonPath = resolve(root, "works.json");
  const auditJsonPath = resolve(root, "corpus-audit.json");
  const outputDir = resolve(root, "corpus");

  console.log(`Reading ${worksJsonPath} ...`);
  const corpus = JSON.parse(readFileSync(worksJsonPath, "utf-8")) as RawCorpus;

  console.log(`Reading ${auditJsonPath} ...`);
  const audit = JSON.parse(readFileSync(auditJsonPath, "utf-8")) as AuditData;

  console.log(`Converting ${corpus.works.length} works → ${outputDir}`);
  const start = Date.now();
  const summary = convert(corpus, audit, outputDir);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  console.log(`Convert finished in ${elapsed}s`);
  console.log(`  Works written:           ${summary.works_written}`);
  console.log(`  Logical chapters:        ${summary.logical_chapters_written}`);
  console.log(`  Variant files:           ${summary.variant_files_written}`);
  if (summary.errors.length > 0) {
    console.log(`  Errors:                  ${summary.errors.length}`);
    for (const err of summary.errors) console.log(`    - ${err}`);
  }
}

main();
