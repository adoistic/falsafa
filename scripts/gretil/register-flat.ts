#!/usr/bin/env bun
/**
 * register-flat.ts
 *
 * Registers already-assembled on-disk GRETIL works (rigveda-aufrecht,
 * valmiki-ramayana) into corpus/manifest.json without needing a monolithic
 * translated JSON file.  Reads the existing translation.paragraphs.json and
 * transliteration.paragraphs.json per chapter, writes transliteration.md,
 * prepends frontmatter to the existing translation.md body, writes meta.json
 * and index.md per work, then upserts both works into the manifest.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { slugify } from "../lib/slug.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParagraphEntry = { id: string; ref: string; text: string };

type Manifest = {
  generated_at: string;
  source: string;
  counts: Record<string, number>;
  works: Array<Record<string, unknown> & { slug: string }>;
  authors: Record<string, { name: string; works: string[] }>;
  eras: Record<string, { name: string; works: string[] }>;
  genres: Record<string, { name: string; works: string[] }>;
  languages: Record<string, { name: string; works: string[] }>;
};

type WorkDef = {
  /** Directory name inside corpus/works/ — used as the manifest slug. */
  slug: string;
  title: string;
  author: string;
  era: string;
  genre: string;
  language: string;
  layout: "verse" | "prose";
  transliteration_scheme: string;
  thothica_role: string;
  /** Template string; replace {N} with the chapter number. */
  chapterTitleTemplate: string;
  /** How to extract the ordinal from a chapter dir name, e.g. "01-mandala-1" → 1. */
  chapterDirPattern: RegExp;
};

// ---------------------------------------------------------------------------
// Work definitions (hardcoded per task spec)
// ---------------------------------------------------------------------------

const WORKS: WorkDef[] = [
  {
    slug: "rigveda-aufrecht",
    title: "Rigveda",
    author: "Aufrecht (ed.)",
    era: "Ancient",
    genre: "Vedic Literature",
    language: "Sanskrit",
    layout: "verse",
    transliteration_scheme: "latin",
    thothica_role: "gretil-root",
    chapterTitleTemplate: "Maṇḍala {N}",
    chapterDirPattern: /^(\d+)-mandala-\d+$/,
  },
  {
    slug: "valmiki-ramayana",
    title: "Vālmīki Rāmāyaṇa",
    author: "Vālmīki",
    era: "Ancient",
    genre: "Epic",
    language: "Sanskrit",
    layout: "verse",
    transliteration_scheme: "latin",
    thothica_role: "gretil-root",
    chapterTitleTemplate: "Kāṇḍa {N}",
    chapterDirPattern: /^(\d+)-kanda-\d+$/,
  },
  {
    slug: "atharvaveda-ps",
    title: "Atharvaveda (Paippalāda)",
    author: "Anonymous (Vedic)",
    era: "Ancient",
    genre: "Vedic Literature",
    language: "Sanskrit",
    layout: "verse",
    transliteration_scheme: "latin",
    thothica_role: "gretil-root",
    chapterTitleTemplate: "Kāṇḍa {N}",
    chapterDirPattern: /^(\d+)-kanda-\d+$/,
  },
  {
    slug: "samaveda",
    title: "Sāmaveda",
    author: "Anonymous (Vedic)",
    era: "Ancient",
    genre: "Vedic Literature",
    language: "Sanskrit",
    layout: "verse",
    transliteration_scheme: "latin",
    thothica_role: "gretil-root",
    chapterTitleTemplate: "Prapāṭhaka {N}",
    chapterDirPattern: /^(\d+)-prapathaka-\d+$/,
  },
];

// ---------------------------------------------------------------------------
// Helpers (exact copies / ports from apply-complete.ts)
// ---------------------------------------------------------------------------

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf-8");
}

function deterministicUuid(seed: string): string {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

function yamlEscape(value: string | null | undefined): string {
  if (value == null) return '""';
  if (/[:#\-?@&*!|>'"%`{}\[\]\n]/.test(value) || /^[\s]/.test(value) || /[\s]$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function frontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${typeof item === "string" ? yamlEscape(item) : item}`);
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (childValue == null) continue;
        lines.push(`  ${childKey}: ${typeof childValue === "string" ? yamlEscape(childValue) : childValue}`);
      }
    } else {
      lines.push(`${key}: ${typeof value === "string" ? yamlEscape(value) : value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function wordCount(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

function addToGroup(
  group: Record<string, { name: string; works: string[] }>,
  key: string,
  name: string,
  slug: string,
): void {
  const existing = group[key] ?? { name, works: [] };
  if (!existing.works.includes(slug)) existing.works.push(slug);
  group[key] = existing;
}

// ---------------------------------------------------------------------------
// Build a transliteration body from paragraphs.json entries.
// Same format as apply-complete chapterBody: **{ref}**\n\n{text}
// ---------------------------------------------------------------------------

function translitBody(paras: ParagraphEntry[]): string {
  return paras
    .map((p) => `**${p.ref}**\n\n${p.text.trim()}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;

  const registeredSlugs: string[] = [];

  for (const workDef of WORKS) {
    const workDir = join(CORPUS, "works", workDef.slug);
    if (!existsSync(workDir)) {
      throw new Error(`Work directory does not exist: ${workDir}`);
    }

    const workId = deterministicUuid(`gretil-flat:${workDef.slug}`);

    // -----------------------------------------------------------------------
    // Enumerate chapters in numeric order
    // -----------------------------------------------------------------------
    const chaptersBaseDir = join(workDir, "chapters");
    const allDirs = readdirSync(chaptersBaseDir).filter((d) =>
      workDef.chapterDirPattern.test(d),
    );
    allDirs.sort(); // lexicographic = numeric because dirs are zero-padded

    const logicalChapters: Array<{
      chapter_number: number;
      chapter_slug: string;
      chapter_title: string;
      variant_count: number;
    }> = [];

    for (const chapterDir of allDirs) {
      const match = workDef.chapterDirPattern.exec(chapterDir);
      if (!match) continue;
      const chapterNumber = parseInt(match[1]!, 10);
      const chapterTitle = workDef.chapterTitleTemplate.replace("{N}", String(chapterNumber));
      const cSlug = chapterDir; // already on disk — use as-is

      const chapterPath = join(chaptersBaseDir, chapterDir);

      // Read paragraphs
      const translitParasPath = join(chapterPath, "transliteration.paragraphs.json");
      const translationParasPath = join(chapterPath, "translation.paragraphs.json");

      if (!existsSync(translitParasPath)) {
        throw new Error(`Missing transliteration.paragraphs.json in ${chapterPath}`);
      }
      if (!existsSync(translationParasPath)) {
        throw new Error(`Missing translation.paragraphs.json in ${chapterPath}`);
      }

      const translitParas = JSON.parse(readFileSync(translitParasPath, "utf-8")) as ParagraphEntry[];
      const translationParas = JSON.parse(readFileSync(translationParasPath, "utf-8")) as ParagraphEntry[];

      // Deterministic variant IDs (using chapter slug as in apply-complete pattern)
      const translitId = deterministicUuid(`${workId}:${cSlug}:transliteration`);
      const translationId = deterministicUuid(`${workId}:${cSlug}:translation`);

      // Word counts
      const tBody = translitBody(translitParas);
      const translitWords = wordCount(tBody);

      // For translation word count, read existing body from translation.md
      const translationMdPath = join(chapterPath, "translation.md");
      if (!existsSync(translationMdPath)) {
        throw new Error(`Missing translation.md in ${chapterPath}`);
      }
      const existingTranslationContent = readFileSync(translationMdPath, "utf-8");

      // Strip any existing frontmatter (idempotent re-run support)
      let translationBody: string;
      if (existingTranslationContent.startsWith("---")) {
        // Find closing ---
        const closingIdx = existingTranslationContent.indexOf("\n---", 3);
        if (closingIdx !== -1) {
          translationBody = existingTranslationContent.slice(closingIdx + 4).replace(/^\n/, "");
        } else {
          translationBody = existingTranslationContent;
        }
      } else {
        translationBody = existingTranslationContent;
      }
      const translationWords = wordCount(translationBody);

      // ------------------------------------------------------------------
      // Write transliteration.md
      // ------------------------------------------------------------------
      writeFile(
        join(chapterPath, "transliteration.md"),
        `${frontmatter({
          work_id: workId,
          work_slug: workDef.slug,
          work_title: workDef.title,
          author_name: workDef.author,
          chapter_number: chapterNumber,
          chapter_title: chapterTitle,
          chapter_slug: cSlug,
          variant_id: translitId,
          content_type: "transliteration",
          layout: workDef.layout,
          language: workDef.language,
          source_language: workDef.language,
          language_direction: "ltr",
          script: workDef.transliteration_scheme,
          word_count: translitWords,
          source_url: null,
          transliterator: "thothica",
        })}\n\n${tBody}\n`,
      );

      // ------------------------------------------------------------------
      // Prepend frontmatter to existing translation.md
      // ------------------------------------------------------------------
      writeFile(
        translationMdPath,
        `${frontmatter({
          work_id: workId,
          work_slug: workDef.slug,
          work_title: workDef.title,
          author_name: workDef.author,
          chapter_number: chapterNumber,
          chapter_title: chapterTitle,
          chapter_slug: cSlug,
          variant_id: translationId,
          content_type: "translation",
          layout: workDef.layout,
          language: "english",
          source_language: workDef.language,
          language_direction: "ltr",
          script: "latin",
          word_count: translationWords,
          source_url: null,
          translator: "thothica",
        })}\n\n${translationBody}`,
      );

      // ------------------------------------------------------------------
      // Write meta.json
      // ------------------------------------------------------------------
      writeFile(
        join(chapterPath, "meta.json"),
        JSON.stringify(
          {
            work_slug: workDef.slug,
            work_title: workDef.title,
            chapter_number: chapterNumber,
            chapter_title: chapterTitle,
            chapter_slug: cSlug,
            layout: workDef.layout,
            layouts_in_variants: [workDef.layout],
            default_variant: "translation.md",
            variants: [
              {
                file: "transliteration.md",
                content_type: "transliteration",
                variant_id: translitId,
                language: workDef.language,
                source_language: workDef.language,
                script: workDef.transliteration_scheme,
                word_count: translitWords,
                paragraph_count: translitParas.length,
                has_image: false,
                source_url: null,
              },
              {
                file: "translation.md",
                content_type: "translation",
                variant_id: translationId,
                language: "english",
                source_language: workDef.language,
                script: "latin",
                word_count: translationWords,
                paragraph_count: translationParas.length,
                has_image: false,
                source_url: null,
              },
            ],
          },
          null,
          2,
        ),
      );

      logicalChapters.push({
        chapter_number: chapterNumber,
        chapter_slug: cSlug,
        chapter_title: chapterTitle,
        variant_count: 2,
      });
    }

    // -----------------------------------------------------------------------
    // Write index.md
    // -----------------------------------------------------------------------
    const description = `${workDef.title}, a Sanskrit ${workDef.genre} by ${workDef.author}, with transliteration and Thothica's English translation from the GRETIL source text.`;
    writeFile(
      join(workDir, "index.md"),
      `${frontmatter({
        id: workId,
        slug: workDef.slug,
        title: workDef.title,
        author: {
          name: workDef.author,
          biography: null,
          birth_year: null,
          death_year: null,
          nationality: "Indian",
        },
        era: workDef.era,
        genre: workDef.genre,
        language: workDef.language,
        language_direction: "ltr",
        description,
        difficulty: "Advanced",
        total_logical_chapters: logicalChapters.length,
        total_variant_entries: logicalChapters.length * 2,
        thothica_role: workDef.thothica_role,
      })}\n\n# ${workDef.title}\n\n${description}\n\n## Chapters\n\n${logicalChapters
        .map(
          (ch) =>
            `${String(ch.chapter_number).padStart(2, "0")}. [${ch.chapter_title}](./chapters/${ch.chapter_slug}/) — ${workDef.layout}, ${ch.variant_count} variants`,
        )
        .join("\n")}\n`,
    );

    // -----------------------------------------------------------------------
    // Upsert into manifest: filter out any existing entry, push new one
    // -----------------------------------------------------------------------
    manifest.works = manifest.works.filter((w) => w.slug !== workDef.slug);

    const authorSlug = slugify(workDef.author);
    const eraSlug = slugify(workDef.era);
    const genreSlug = slugify(workDef.genre);
    const languageSlug = slugify(workDef.language);

    manifest.works.push({
      slug: workDef.slug,
      title: workDef.title,
      author: workDef.author,
      author_slug: authorSlug,
      era: workDef.era,
      era_slug: eraSlug,
      genre: workDef.genre,
      genre_slug: genreSlug,
      language: workDef.language,
      language_slug: languageSlug,
      language_direction: "ltr",
      total_logical_chapters: logicalChapters.length,
      total_variant_entries: logicalChapters.length * 2,
      published_year: null,
      difficulty: "Advanced",
      description,
      thothica_role: workDef.thothica_role,
    });

    addToGroup(manifest.authors, authorSlug, workDef.author, workDef.slug);
    addToGroup(manifest.eras, eraSlug, workDef.era, workDef.slug);
    addToGroup(manifest.genres, genreSlug, workDef.genre, workDef.slug);
    addToGroup(manifest.languages, languageSlug, workDef.language, workDef.slug);

    registeredSlugs.push(workDef.slug);
    console.log(`Registered: ${workDef.slug} (${logicalChapters.length} chapters)`);
  }

  // -------------------------------------------------------------------------
  // Recompute manifest aggregate counts + timestamp
  // -------------------------------------------------------------------------
  manifest.generated_at = new Date().toISOString();
  manifest.counts = {
    works: manifest.works.length,
    authors: Object.keys(manifest.authors).length,
    eras: Object.keys(manifest.eras).length,
    genres: Object.keys(manifest.genres).length,
    languages: Object.keys(manifest.languages).length,
  };

  writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest updated. Total works: ${manifest.counts.works}`);
  console.log("Registered slugs:", registeredSlugs);
}

main();
