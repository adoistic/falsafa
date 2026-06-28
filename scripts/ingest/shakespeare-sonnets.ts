#!/usr/bin/env bun
/**
 * shakespeare-sonnets.ts
 *
 * Ingests Shakespeare's Sonnets (Project Gutenberg EBook #1041) into the
 * Falsafa corpus as a single work with 154 chapters (one per sonnet).
 *
 * DATA SOURCE: t2work/shakespeare/sonnets.txt
 *   Plain-text download from https://www.gutenberg.org/cache/epub/1041/pg1041.txt
 *   Header / footer boilerplate is stripped before parsing.
 *
 * SCHEMA:
 *   - slug: "william-shakespeare-sonnets-65f289"
 *   - 154 chapters, one per sonnet, chapter dir "NNN-sonnet-N"
 *   - One variant per chapter: original.md (content_type "original", English)
 *   - Incipit (first line) recorded in chapter meta.json
 *
 * USAGE:
 *   bun run scripts/ingest/shakespeare-sonnets.ts           # dry run (default)
 *   bun run scripts/ingest/shakespeare-sonnets.ts --write   # write corpus files
 *   bun run scripts/ingest/shakespeare-sonnets.ts --manifest # write + upsert manifest.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const SOURCE_TXT = resolve(ROOT, "t2work", "shakespeare", "sonnets.txt");

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--write") && !args.includes("--manifest");
const UPDATE_MANIFEST = args.includes("--manifest");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_URL = "https://www.gutenberg.org/ebooks/1041";
const LICENSE =
  "Public domain — from Project Gutenberg (https://www.gutenberg.org)";
const AUTHOR = "William Shakespeare";
const TITLE = "Sonnets";
const ERA = "16th Century";
const GENRE = "Poetry";
const LANGUAGE = "English";
const PUBLISHED_YEAR = 1609;
const THOTHICA_ROLE = "catalog";
const NATIONALITY = "English";

// Pre-computed: deterministicUuid("shakespeare:sonnets") → 65f2891b-8b93-56a5-9167-d7354cf18e54
const WORK_UUID = "65f2891b-8b93-56a5-9167-d7354cf18e54";
const WORK_SLUG = "william-shakespeare-sonnets-65f289";

// ---------------------------------------------------------------------------
// Deterministic UUID (SHA-1 v5-style, matches ecpa-ingest.ts)
// ---------------------------------------------------------------------------

function deterministicUuid(seed: string): string {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// YAML frontmatter builder (mirrors ecpa-ingest.ts)
// ---------------------------------------------------------------------------

function yamlEscape(value: string | null | undefined): string {
  if (value == null) return '""';
  if (
    /[:#\-?@&*!|>'"%`{}\[\]\n]/.test(value) ||
    /^[\s]/.test(value) ||
    /[\s]$/.test(value)
  ) {
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
      for (const item of value) {
        lines.push(`  - ${typeof item === "string" ? yamlEscape(item) : item}`);
      }
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [childKey, childValue] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (childValue == null) continue;
        lines.push(
          `  ${childKey}: ${
            typeof childValue === "string" ? yamlEscape(childValue) : childValue
          }`
        );
      }
    } else {
      lines.push(
        `${key}: ${typeof value === "string" ? yamlEscape(value) : value}`
      );
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Roman numeral → integer
// ---------------------------------------------------------------------------

function romanToInt(roman: string): number {
  const vals: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };
  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const curr = vals[roman[i]!] ?? 0;
    const next = vals[roman[i + 1]!] ?? 0;
    if (curr < next) {
      result -= curr;
    } else {
      result += curr;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parse sonnets from plain text
// ---------------------------------------------------------------------------

type Sonnet = {
  number: number;
  lines: string[];
  incipit: string;
};

function parseSonnets(raw: string): Sonnet[] {
  // Strip everything before the first sonnet (Roman numeral "I" on its own line
  // after the THE SONNETS heading) and everything from "*** END OF" onward.
  const endMarker = raw.indexOf("*** END OF THE PROJECT GUTENBERG");
  const body = endMarker >= 0 ? raw.slice(0, endMarker) : raw;

  // Split into lines
  const allLines = body.split("\n");

  // Find the index of the first Roman-numeral-only line
  const romanRe = /^[IVXLC]+$/;
  let startIdx = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (romanRe.test((allLines[i] ?? "").trim()) &&
        romanToInt((allLines[i] ?? "").trim()) === 1) {
      startIdx = i;
      break;
    }
  }

  // Collect all sonnet boundary line indices (Roman numeral lines)
  const boundaries: number[] = [];
  for (let i = startIdx; i < allLines.length; i++) {
    const trimmed = (allLines[i] ?? "").trim();
    if (romanRe.test(trimmed) && romanToInt(trimmed) >= 1 && romanToInt(trimmed) <= 154) {
      boundaries.push(i);
    }
  }

  if (boundaries.length !== 154) {
    throw new Error(
      `Expected 154 sonnet boundaries, found ${boundaries.length}. ` +
      `Check the parser.`
    );
  }

  const sonnets: Sonnet[] = [];

  for (let b = 0; b < boundaries.length; b++) {
    const numLine = (allLines[boundaries[b]!] ?? "").trim();
    const number = romanToInt(numLine);
    const contentStart = boundaries[b]! + 1;
    const contentEnd = b + 1 < boundaries.length ? boundaries[b + 1]! : allLines.length;

    // Extract non-empty lines between this boundary and the next
    const verseLines: string[] = [];
    for (let i = contentStart; i < contentEnd; i++) {
      const line = allLines[i] ?? "";
      // Keep lines that have content (including indented couplets)
      // Skip purely blank lines at start/end but preserve internal blank lines
      verseLines.push(line);
    }

    // Trim leading/trailing blank lines
    let lo = 0;
    while (lo < verseLines.length && (verseLines[lo] ?? "").trim() === "") lo++;
    let hi = verseLines.length - 1;
    while (hi > lo && (verseLines[hi] ?? "").trim() === "") hi--;

    const trimmedLines = verseLines.slice(lo, hi + 1);

    const incipit = trimmedLines.find((l) => l.trim() !== "") ?? "";

    sonnets.push({
      number,
      lines: trimmedLines,
      incipit: incipit.trim(),
    });
  }

  return sonnets;
}

// ---------------------------------------------------------------------------
// Chapter slug helpers
// ---------------------------------------------------------------------------

function padN3(n: number): string {
  return String(n).padStart(3, "0");
}

function chapterSlug(n: number): string {
  return `${padN3(n)}-sonnet-${n}`;
}

// ---------------------------------------------------------------------------
// Write work to corpus/works/
// ---------------------------------------------------------------------------

function writeWork(sonnets: Sonnet[]): void {
  const workDir = join(CORPUS, "works", WORK_SLUG);
  const chaptersDir = join(workDir, "chapters");
  mkdirSync(chaptersDir, { recursive: true });

  const description =
    "The complete sequence of 154 sonnets by William Shakespeare, " +
    "first published in 1609. Ranging from meditations on love, time, and " +
    "beauty to enigmatic address to the 'Fair Youth' and the 'Dark Lady', " +
    "these are among the most celebrated poems in the English language.";

  // Chapter list for index.md
  const chapterLines = sonnets.map((s) => {
    const slug = chapterSlug(s.number);
    return `${padN3(s.number)}. [Sonnet ${s.number}](./chapters/${slug}/) — ${s.incipit}`;
  });

  // index.md
  const indexFm: Record<string, unknown> = {
    id: WORK_UUID,
    slug: WORK_SLUG,
    title: TITLE,
    author: {
      name: AUTHOR,
      nationality: NATIONALITY,
    },
    era: ERA,
    genre: GENRE,
    language: LANGUAGE,
    language_direction: "ltr",
    published_year: PUBLISHED_YEAR,
    description,
    source_url: SOURCE_URL,
    license: LICENSE,
    difficulty: "Intermediate",
    total_logical_chapters: sonnets.length,
    total_variant_entries: sonnets.length,
    thothica_role: THOTHICA_ROLE,
  };

  const indexMd =
    `${frontmatter(indexFm)}\n\n# ${TITLE}\n\n${description}\n\n## Chapters\n\n${chapterLines.join("\n")}\n`;
  writeFileSync(join(workDir, "index.md"), indexMd, "utf-8");
  console.log(`  Wrote index.md`);

  // Per-chapter files
  for (const sonnet of sonnets) {
    const slug = chapterSlug(sonnet.number);
    const chapterDir = join(chaptersDir, slug);
    mkdirSync(chapterDir, { recursive: true });

    const variantId = deterministicUuid(
      `shakespeare:sonnets:variant:${sonnet.number}`
    );
    const text = sonnet.lines.join("\n");
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const lineCount = sonnet.lines.filter((l) => l.trim()).length;

    // meta.json
    const meta = {
      work_slug: WORK_SLUG,
      work_title: TITLE,
      chapter_number: sonnet.number,
      chapter_title: `Sonnet ${sonnet.number}`,
      chapter_slug: slug,
      incipit: sonnet.incipit,
      layout: "verse",
      layouts_in_variants: ["verse"],
      default_variant: "original.md",
      variants: [
        {
          file: "original.md",
          content_type: "original",
          variant_id: variantId,
          language: "english",
          source_language: "English",
          script: "latin",
          word_count: wordCount,
          line_count: lineCount,
          has_image: false,
          source_url: SOURCE_URL,
          license: LICENSE,
        },
      ],
    };
    writeFileSync(
      join(chapterDir, "meta.json"),
      JSON.stringify(meta, null, 2),
      "utf-8"
    );

    // original.md variant
    const variantFm: Record<string, unknown> = {
      work_id: WORK_UUID,
      work_slug: WORK_SLUG,
      work_title: TITLE,
      author: AUTHOR,
      chapter_number: sonnet.number,
      chapter_title: `Sonnet ${sonnet.number}`,
      chapter_slug: slug,
      incipit: sonnet.incipit,
      variant_id: variantId,
      content_type: "original",
      layout: "verse",
      language: "english",
      source_language: "English",
      language_direction: "ltr",
      script: "latin",
      word_count: wordCount,
      source_url: SOURCE_URL,
      license: LICENSE,
    };

    const variantMd = `${frontmatter(variantFm)}\n\n${text}\n`;
    writeFileSync(join(chapterDir, "original.md"), variantMd, "utf-8");
  }

  console.log(`  Wrote ${sonnets.length} chapters to corpus/works/${WORK_SLUG}/`);
}

// ---------------------------------------------------------------------------
// Manifest upsert (mirrors ecpa-ingest.ts)
// ---------------------------------------------------------------------------

type ManifestWork = Record<string, unknown> & { slug: string };
type Manifest = {
  generated_at: string;
  source: string;
  counts: Record<string, number>;
  works: ManifestWork[];
  authors: Record<string, { name: string; works: string[] }>;
  eras: Record<string, { name: string; works: string[] }>;
  genres: Record<string, { name: string; works: string[] }>;
  languages: Record<string, { name: string; works: string[] }>;
};

function slugify(input: string): string {
  if (!input) return "";
  const folded = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe");
  return folded
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function addToGroup(
  group: Record<string, { name: string; works: string[] }>,
  key: string,
  name: string,
  slug: string
): void {
  const existing = group[key] ?? { name, works: [] };
  if (!existing.works.includes(slug)) existing.works.push(slug);
  group[key] = existing;
}

function upsertManifest(chapterCount: number): void {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;

  // Remove any previous entry with this slug
  manifest.works = manifest.works.filter((w) => w.slug !== WORK_SLUG);

  const authorSlug = slugify(AUTHOR);
  const eraSlug = slugify(ERA);
  const genreSlug = slugify(GENRE);
  const langSlug = slugify(LANGUAGE);

  manifest.works.push({
    slug: WORK_SLUG,
    title: TITLE,
    author: AUTHOR,
    author_slug: authorSlug,
    era: ERA,
    era_slug: eraSlug,
    genre: GENRE,
    genre_slug: genreSlug,
    language: LANGUAGE,
    language_slug: langSlug,
    language_direction: "ltr",
    published_year: PUBLISHED_YEAR,
    nationality: NATIONALITY,
    total_logical_chapters: chapterCount,
    total_variant_entries: chapterCount,
    source_url: SOURCE_URL,
    license: LICENSE,
    thothica_role: THOTHICA_ROLE,
  });

  addToGroup(manifest.authors, authorSlug, AUTHOR, WORK_SLUG);
  addToGroup(manifest.eras, eraSlug, ERA, WORK_SLUG);
  addToGroup(manifest.genres, genreSlug, GENRE, WORK_SLUG);
  addToGroup(manifest.languages, langSlug, LANGUAGE, WORK_SLUG);

  manifest.generated_at = new Date().toISOString();
  manifest.counts = {
    works: manifest.works.length,
    authors: Object.keys(manifest.authors).length,
    eras: Object.keys(manifest.eras).length,
    genres: Object.keys(manifest.genres).length,
    languages: Object.keys(manifest.languages).length,
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`\nManifest updated. Total works: ${manifest.counts.works}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Shakespeare Sonnets Ingestion ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : UPDATE_MANIFEST ? "WRITE + MANIFEST" : "WRITE"}\n`);

  if (!existsSync(SOURCE_TXT)) {
    console.error(`Source file not found: ${SOURCE_TXT}`);
    console.error(
      "Download it first:\n" +
      "  curl -sL https://www.gutenberg.org/cache/epub/1041/pg1041.txt \\\n" +
      "       -o t2work/shakespeare/sonnets.txt"
    );
    process.exit(1);
  }

  const raw = readFileSync(SOURCE_TXT, "utf-8");
  console.log(`Loaded ${raw.length} bytes from ${SOURCE_TXT}`);

  const sonnets = parseSonnets(raw);
  console.log(`Parsed ${sonnets.length} sonnets`);

  if (sonnets.length !== 154) {
    console.error(`FATAL: Expected exactly 154 sonnets, got ${sonnets.length}`);
    process.exit(1);
  }

  // Spot-check key sonnets
  const s1 = sonnets.find((s) => s.number === 1)!;
  const s18 = sonnets.find((s) => s.number === 18)!;
  const s154 = sonnets.find((s) => s.number === 154)!;

  console.log(`\nSonnet 1 incipit:   "${s1.incipit}"`);
  console.log(`Sonnet 18 incipit:  "${s18.incipit}"`);
  console.log(`Sonnet 154 incipit: "${s154.incipit}"`);
  console.log(`Sonnet 1 lines: ${s1.lines.length}`);
  console.log(`Sonnet 18 lines: ${s18.lines.length}`);

  if (DRY_RUN) {
    console.log("\n--- Sonnet 18 full text (dry-run preview) ---");
    console.log(s18.lines.join("\n"));
    console.log("\n=== DRY RUN COMPLETE — no files written ===");
    console.log("Re-run with --write to write corpus files.");
    console.log("Re-run with --manifest to write + upsert manifest.json.");
    return;
  }

  console.log("\nWriting work...");
  writeWork(sonnets);

  if (UPDATE_MANIFEST) {
    console.log("\nUpserting manifest.json...");
    upsertManifest(sonnets.length);
  }

  console.log("\n=== INGESTION COMPLETE ===");
  console.log(`Work slug:     ${WORK_SLUG}`);
  console.log(`Chapters:      ${sonnets.length}`);
  console.log(`Corpus dir:    corpus/works/${WORK_SLUG}/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
