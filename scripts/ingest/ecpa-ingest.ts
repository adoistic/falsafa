#!/usr/bin/env bun
/**
 * ecpa-ingest.ts
 *
 * Ingests the Eighteenth-Century Poetry Archive (ECPA) into the Falsafa corpus.
 *
 * DATA SOURCE: t2work/ecpa-data/
 *   works/<stem>.txt          — poem plain-text
 *   works/<stem>_l.json       — per-poem prosody/metadata sidecar
 *   persons/persNNNNN.json    — author authority files
 *   meta.csv                  — author_display, title, id, author_id
 *
 * GROUPING LOGIC:
 *   - Poets with >= 3 poems → one work per poet (chapters = their poems)
 *   - Everyone else (< 3 poems, Anonymous, blank) → single assorted collection
 *
 * SCHEMA:
 *   - Per-chapter author fields in both meta.json and variant .md frontmatter
 *   - CC BY-SA 3.0 attribution on every work and variant
 *
 * USAGE:
 *   bun run scripts/ingest/ecpa-ingest.ts           # dry run (default)
 *   bun run scripts/ingest/ecpa-ingest.ts --write   # write all works
 *   bun run scripts/ingest/ecpa-ingest.ts --sample  # write only the 2 sample works
 *   bun run scripts/ingest/ecpa-ingest.ts --manifest # write + upsert manifest.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse as csvParse } from "csv-parse/sync";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const ECPA_DATA = resolve(ROOT, "t2work", "ecpa-data");

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--write") && !args.includes("--sample") && !args.includes("--manifest");
const SAMPLE_ONLY = args.includes("--sample");
const UPDATE_MANIFEST = args.includes("--manifest");
const WRITE_ALL = args.includes("--write") || UPDATE_MANIFEST;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_URL = "https://www.eighteenthcenturypoetry.org/";
const LICENSE = "CC BY-SA 3.0 — Eighteenth-Century Poetry Archive, ed. Alexander Huber (Bodleian Libraries, University of Oxford)";
const ERA = "18th Century";
const GENRE = "Poetry";
const LANGUAGE = "English";
const ASSORTED_TITLE = "An Assorted Collection of Eighteenth-Century Poetry";
const ASSORTED_AUTHOR = "Various";

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

type MetaRow = {
  author_display: string;
  title: string;
  id: string;
  author_id: string;
};

type Person = {
  id: string;
  name: string;
  nat?: string;
  viaf?: string;
  ecpa?: string;
};

type ProsodySidecar = {
  genres?: Array<{ id: string; text: string }>;
  lines?: unknown[];
  met?: string;
  number?: Array<{ id: string; text: string }>;
  real?: string | null;
  rhyme?: string;
  stanzas?: Array<{ id: string; text: string }>;
  syllab?: string;
  spos?: unknown[];
  // line-level entries keyed by e.g. "ayo19-l00005"
  [key: string]: unknown;
};

type WorkSpec = {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorSlug: string;
  nationality: string | null;
  poems: PoemSpec[];
};

type PoemSpec = {
  poemId: string;
  title: string;
  chapterNumber: number;
  chapterSlug: string;
  authorName: string;
  authorSlug: string;
  authorId: string;
  /** dominant metrical foot text, e.g. "iambic (˘′)" */
  foot: string | null;
  /** dominant foot count text, e.g. "pentameter (5 feet)" */
  footnum: string | null;
  /** poem-level genre tags */
  genres: string[];
  /** poem-level stanza form */
  stanzas: string[];
  /** rhyme scheme string */
  rhyme: string | null;
  /** syllable count pattern */
  syllab: string | null;
  /** metrical pattern string */
  met: string | null;
  /** line count (number of line-keyed entries in sidecar) */
  lineCount: number;
  /** plain-text content */
  text: string;
};

// ---------------------------------------------------------------------------
// Deterministic UUID (SHA-1 v5-style, matches register-flat.ts)
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

function uuid6(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 6);
}

// ---------------------------------------------------------------------------
// Slugify (mirrors scripts/lib/slug.ts)
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  if (!input) return "";
  const folded = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ð/gi, "d")
    .replace(/þ/gi, "th");

  const dashed = folded
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  if (dashed.length <= 64) return dashed;
  const cut = dashed.slice(0, 64);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 32 ? cut.slice(0, lastDash) : cut;
}

function padN(n: number): string {
  return String(n).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// YAML frontmatter builder (mirrors register-flat.ts)
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
// Author name normalisation: "Surname, Forename" → "Forename Surname"
// ---------------------------------------------------------------------------

function normalizeAuthorName(raw: string): string {
  const trimmed = raw.trim();
  // Strip " / Translator, Name" suffix used for attributed translations
  // e.g. "Frederick II, King of Prussia / Cooper, John Gilbert" → "Frederick II, King of Prussia"
  const withoutTranslator = trimmed.replace(/\s*\/\s*.+$/, "").trim();

  if (!withoutTranslator.toLowerCase().includes("anonymous") && /^[^,]+,\s*.+$/.test(withoutTranslator)) {
    // "Surname, Forename [, title/descriptor ...]"
    // Invert only the first two comma-parts: [Forename] [Surname]
    // Additional parts (titles, epithets like "King of Prussia") are dropped.
    const parts = withoutTranslator.split(",").map((p) => p.trim());
    const surname = parts[0]!;
    const forename = parts[1] ?? "";
    return `${forename} ${surname}`.trim();
  }
  return withoutTranslator || trimmed;
}

// ---------------------------------------------------------------------------
// Prosody extraction from sidecar
// ---------------------------------------------------------------------------

function extractProsody(sidecar: ProsodySidecar): {
  foot: string | null;
  footnum: string | null;
  genres: string[];
  stanzas: string[];
  rhyme: string | null;
  syllab: string | null;
  met: string | null;
  lineCount: number;
} {
  // Dominant foot from line-level entries (most common)
  const footCounts = new Map<string, number>();
  const footnumCounts = new Map<string, number>();
  let lineCount = 0;

  for (const [key, val] of Object.entries(sidecar)) {
    if (typeof val !== "object" || val === null) continue;
    const entry = val as Record<string, unknown>;
    // line-level entries have 'foot', 'footnum', 'met', 'content'
    if ("content" in entry && "foot" in entry) {
      lineCount++;
      const footEntry = entry.foot as { id?: string; text?: string } | null;
      if (footEntry?.text) {
        footCounts.set(footEntry.text, (footCounts.get(footEntry.text) ?? 0) + 1);
      }
      const fne = entry.footnum as { id?: string; text?: string } | null;
      if (fne?.text) {
        footnumCounts.set(fne.text, (footnumCounts.get(fne.text) ?? 0) + 1);
      }
    }
  }

  const topFoot = footCounts.size > 0
    ? [...footCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    : null;
  const topFootnum = footnumCounts.size > 0
    ? [...footnumCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    : null;

  const genres = (sidecar.genres ?? []).map((g) => g.text).filter(Boolean);
  const stanzas = (sidecar.stanzas ?? []).map((s) => s.text).filter(Boolean);
  const rhyme = sidecar.rhyme ?? null;
  const syllab = sidecar.syllab ?? null;
  const met = sidecar.met ?? null;

  return { foot: topFoot, footnum: topFootnum, genres, stanzas, rhyme, syllab, met, lineCount };
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

function loadPersons(): Map<string, Person> {
  const map = new Map<string, Person>();
  const persDir = join(ECPA_DATA, "persons");
  const files = Array.from(
    Bun.spawnSync(["ls", persDir]).stdout.toString().trim().split("\n")
  ).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const pid = file.replace(".json", "");
    try {
      const raw = JSON.parse(readFileSync(join(persDir, file), "utf-8"));
      const entry: Person = raw[pid] ?? {};
      if (entry.id || entry.name) {
        map.set(pid, {
          id: pid,
          name: entry.name ?? "",
          nat: (entry as Record<string, unknown>).nat as string | undefined,
          viaf: (entry as Record<string, unknown>).viaf as string | undefined,
          ecpa: (entry as Record<string, unknown>).ecpa as string | undefined,
        });
      }
    } catch {
      // skip malformed
    }
  }
  return map;
}

function loadMeta(): MetaRow[] {
  const raw = readFileSync(join(ECPA_DATA, "meta.csv"), "utf-8");
  return csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as MetaRow[];
}

function loadSidecar(poemId: string): ProsodySidecar | null {
  const path = join(ECPA_DATA, "works", `${poemId}_l.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ProsodySidecar;
  } catch {
    return null;
  }
}

function loadPoemText(poemId: string): string {
  const path = join(ECPA_DATA, "works", `${poemId}.txt`);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

// ---------------------------------------------------------------------------
// Nationality from ISO code
// ---------------------------------------------------------------------------

const NAT_MAP: Record<string, string> = {
  "GB-ENG": "English",
  "GB-SCT": "Scottish",
  "GB-WLS": "Welsh",
  "GB-NIR": "Northern Irish",
  IE: "Irish",
  US: "American",
  FR: "French",
  DE: "German",
  IT: "Italian",
  ES: "Spanish",
  PT: "Portuguese",
  NL: "Dutch",
  SE: "Swedish",
  NO: "Norwegian",
  DK: "Danish",
  PL: "Polish",
  RU: "Russian",
  "?": "Unknown",
};

function natName(nat: string | undefined): string {
  if (!nat) return "British";
  return NAT_MAP[nat] ?? "British";
}

// ---------------------------------------------------------------------------
// Build all WorkSpecs from raw data
// ---------------------------------------------------------------------------

function buildWorkSpecs(
  rows: MetaRow[],
  persons: Map<string, Person>
): { poetWorks: WorkSpec[]; assortedWork: WorkSpec } {
  // Count poems per author_id (using first id in comma-lists for grouping)
  const countByAuthorId = new Map<string, number>();
  for (const row of rows) {
    const primaryId = row.author_id.split(",")[0]!.trim();
    countByAuthorId.set(primaryId, (countByAuthorId.get(primaryId) ?? 0) + 1);
  }

  // Identify anonymous author ids
  const anonIds = new Set<string>();
  for (const [pid, person] of persons.entries()) {
    if (person.name === "Anonymous") anonIds.add(pid);
  }

  // Classify each poem
  const poetPoems = new Map<string, MetaRow[]>(); // authorId → poems
  const assortedRows: MetaRow[] = [];

  for (const row of rows) {
    const primaryId = row.author_id.split(",")[0]!.trim();
    const count = countByAuthorId.get(primaryId) ?? 0;
    const isAnon = anonIds.has(primaryId) || row.author_display.toLowerCase().includes("anonymous");

    if (isAnon || count < 3) {
      assortedRows.push(row);
    } else {
      if (!poetPoems.has(primaryId)) poetPoems.set(primaryId, []);
      poetPoems.get(primaryId)!.push(row);
    }
  }

  // Build individual poet WorkSpecs
  const poetWorks: WorkSpec[] = [];

  for (const [authorId, poetRows] of poetPoems.entries()) {
    const person = persons.get(authorId);
    // Author name: from persons file, normalized from surname-first
    const rawName = person?.name ?? poetRows[0]!.author_display;
    const authorName = normalizeAuthorName(rawName);
    const authorSlug = slugify(authorName);
    const nationality = natName(person?.nat);

    const workTitle = "Poems";
    const workId = deterministicUuid(`ecpa:poet:${authorId}`);
    const slug = `${slugify(authorName).slice(0, 32)}-poems-${uuid6(workId)}`;

    const poems: PoemSpec[] = [];
    // Sort poems by their id for stable chapter order
    const sortedRows = [...poetRows].sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < sortedRows.length; i++) {
      const row = sortedRows[i]!;
      const sidecar = loadSidecar(row.id);
      const prosody = sidecar ? extractProsody(sidecar) : {
        foot: null, footnum: null, genres: [], stanzas: [], rhyme: null, syllab: null, met: null, lineCount: 0,
      };

      const poemTitle = row.title.trim();
      const chapterNumber = i + 1;
      const chapterSlug = `${padN(chapterNumber)}-${slugify(poemTitle).slice(0, 48)}`;

      // Per-poem true author — from meta.csv author_display
      const poemAuthorDisplay = row.author_display.trim();
      const poemAuthorName = normalizeAuthorName(poemAuthorDisplay);

      poems.push({
        poemId: row.id,
        title: poemTitle,
        chapterNumber,
        chapterSlug,
        authorName: poemAuthorName,
        authorSlug: slugify(poemAuthorName),
        authorId,
        ...prosody,
        text: loadPoemText(row.id),
      });
    }

    poetWorks.push({
      workId,
      slug,
      title: workTitle,
      authorName,
      authorSlug,
      nationality,
      poems,
    });
  }

  // Sort poet works alphabetically by author slug
  poetWorks.sort((a, b) => a.authorSlug.localeCompare(b.authorSlug));

  // Build assorted WorkSpec
  const assortedId = deterministicUuid("ecpa:assorted:eighteenth-century-poetry");
  const assortedSlug = `assorted-eighteenth-century-poetry-${uuid6(assortedId)}`;

  const assortedPoems: PoemSpec[] = [];
  for (let i = 0; i < assortedRows.length; i++) {
    const row = assortedRows[i]!;
    const sidecar = loadSidecar(row.id);
    const prosody = sidecar ? extractProsody(sidecar) : {
      foot: null, footnum: null, genres: [], stanzas: [], rhyme: null, syllab: null, met: null, lineCount: 0,
    };

    const poemTitle = row.title.trim();
    const chapterNumber = i + 1;
    const chapterSlug = `${padN(chapterNumber)}-${slugify(poemTitle).slice(0, 48)}`;

    const primaryId = row.author_id.split(",")[0]!.trim();
    const person = persons.get(primaryId);
    const rawName = person?.name ?? row.author_display;
    const poemAuthorName = normalizeAuthorName(rawName);

    assortedPoems.push({
      poemId: row.id,
      title: poemTitle,
      chapterNumber,
      chapterSlug,
      authorName: poemAuthorName,
      authorSlug: slugify(poemAuthorName),
      authorId: row.author_id,
      ...prosody,
      text: loadPoemText(row.id),
    });
  }

  const assortedWork: WorkSpec = {
    workId: assortedId,
    slug: assortedSlug,
    title: ASSORTED_TITLE,
    authorName: ASSORTED_AUTHOR,
    authorSlug: "various",
    nationality: null,
    poems: assortedPoems,
  };

  return { poetWorks, assortedWork };
}

// ---------------------------------------------------------------------------
// Write a single work to corpus/works/
// ---------------------------------------------------------------------------

function writeWork(work: WorkSpec, isAssorted: boolean): void {
  const workDir = join(CORPUS, "works", work.slug);
  const chaptersDir = join(workDir, "chapters");

  mkdirSync(chaptersDir, { recursive: true });

  const description = isAssorted
    ? `A collection of eighteenth-century poems by various authors, drawn from the Eighteenth-Century Poetry Archive (ECPA). Includes poets represented by fewer than three works in the archive as well as anonymous verse.`
    : `Collected poems by ${work.authorName}, drawn from the Eighteenth-Century Poetry Archive (ECPA).`;

  // Work-level index.md
  const chapterLines = work.poems.map((poem) => {
    const authorNote = isAssorted ? ` — ${poem.authorName}` : "";
    return `${padN(poem.chapterNumber)}. [${poem.title}](./chapters/${poem.chapterSlug}/)${authorNote} — verse, 1 variant`;
  });

  const indexFm: Record<string, unknown> = {
    id: work.workId,
    slug: work.slug,
    title: work.title,
    author: isAssorted
      ? { name: ASSORTED_AUTHOR }
      : {
          name: work.authorName,
          nationality: work.nationality,
        },
    era: ERA,
    genre: GENRE,
    language: LANGUAGE,
    language_direction: "ltr",
    description,
    source_url: SOURCE_URL,
    license: LICENSE,
    difficulty: "Intermediate",
    total_logical_chapters: work.poems.length,
    total_variant_entries: work.poems.length,
    thothica_role: "ecpa-root",
  };

  const indexMd =
    `${frontmatter(indexFm)}\n\n# ${work.title}\n\n${description}\n\n## Chapters\n\n${chapterLines.join("\n")}\n`;
  writeFileSync(join(workDir, "index.md"), indexMd, "utf-8");

  // Per-chapter files
  for (const poem of work.poems) {
    const chapterDir = join(chaptersDir, poem.chapterSlug);
    mkdirSync(chapterDir, { recursive: true });

    const variantId = deterministicUuid(`ecpa:variant:${work.workId}:${poem.poemId}`);
    const wordCount = poem.text.split(/\s+/).filter(Boolean).length;
    const lineCount = poem.text.split("\n").filter((l) => l.trim()).length;

    // meta.json
    const meta = {
      work_slug: work.slug,
      work_title: work.title,
      chapter_number: poem.chapterNumber,
      chapter_title: poem.title,
      chapter_slug: poem.chapterSlug,
      // per-chapter author — key schema addition
      author: poem.authorName,
      author_slug: poem.authorSlug,
      ecpa_poem_id: poem.poemId,
      layout: "verse",
      layouts_in_variants: ["verse"],
      default_variant: "original.md",
      // prosody metadata from sidecar
      prosody: {
        ...(poem.genres.length > 0 && { genres: poem.genres }),
        ...(poem.foot && { foot: poem.foot }),
        ...(poem.footnum && { footnum: poem.footnum }),
        ...(poem.stanzas.length > 0 && { stanzas: poem.stanzas }),
        ...(poem.rhyme && { rhyme: poem.rhyme }),
        ...(poem.syllab && { syllable_pattern: poem.syllab }),
        ...(poem.met && { metrical_pattern: poem.met }),
        ...(poem.lineCount > 0 && { line_count: poem.lineCount }),
      },
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
      work_id: work.workId,
      work_slug: work.slug,
      work_title: work.title,
      // per-chapter author in variant frontmatter
      author: poem.authorName,
      author_slug: poem.authorSlug,
      ecpa_poem_id: poem.poemId,
      chapter_number: poem.chapterNumber,
      chapter_title: poem.title,
      chapter_slug: poem.chapterSlug,
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
    // Add prosody fields to variant frontmatter if present
    if (poem.genres.length > 0) variantFm["genres"] = poem.genres;
    if (poem.foot) variantFm["metrical_foot"] = poem.foot;
    if (poem.footnum) variantFm["metrical_count"] = poem.footnum;
    if (poem.stanzas.length > 0) variantFm["stanza_form"] = poem.stanzas;
    if (poem.rhyme) variantFm["rhyme_scheme"] = poem.rhyme;
    if (poem.syllab) variantFm["syllable_pattern"] = poem.syllab;

    const variantMd = `${frontmatter(variantFm)}\n\n${poem.text}\n`;
    writeFileSync(join(chapterDir, "original.md"), variantMd, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Manifest upsert
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

function upsertManifest(works: WorkSpec[], isAssortedFlags: boolean[]): void {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;

  for (let i = 0; i < works.length; i++) {
    const work = works[i]!;
    const isAssorted = isAssortedFlags[i]!;

    manifest.works = manifest.works.filter((w) => w.slug !== work.slug);

    const authorSlug = work.authorSlug;
    const eraSlug = slugify(ERA);
    const genreSlug = slugify(GENRE);
    const langSlug = slugify(LANGUAGE);

    manifest.works.push({
      slug: work.slug,
      title: work.title,
      author: work.authorName,
      author_slug: authorSlug,
      era: ERA,
      era_slug: eraSlug,
      genre: GENRE,
      genre_slug: genreSlug,
      language: LANGUAGE,
      language_slug: langSlug,
      language_direction: "ltr",
      total_logical_chapters: work.poems.length,
      total_variant_entries: work.poems.length,
      source_url: SOURCE_URL,
      license: LICENSE,
      thothica_role: "ecpa-root",
      ...(isAssorted ? { is_assorted: true } : {}),
    });

    addToGroup(manifest.authors, authorSlug, work.authorName, work.slug);
    addToGroup(manifest.eras, eraSlug, ERA, work.slug);
    addToGroup(manifest.genres, genreSlug, GENRE, work.slug);
    addToGroup(manifest.languages, langSlug, LANGUAGE, work.slug);
  }

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
  console.log("=== ECPA Ingestion ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : SAMPLE_ONLY ? "SAMPLE ONLY" : UPDATE_MANIFEST ? "WRITE + MANIFEST" : "WRITE ALL"}\n`);

  // Load data
  console.log("Loading persons...");
  const persons = loadPersons();
  console.log(`  ${persons.size} persons loaded`);

  console.log("Loading meta.csv...");
  const rows = loadMeta();
  console.log(`  ${rows.length} poem rows loaded`);

  // Build work specs
  console.log("Building work specs...");
  const { poetWorks, assortedWork } = buildWorkSpecs(rows, persons);

  const totalWorks = poetWorks.length + 1;
  const totalPoemsInPoetWorks = poetWorks.reduce((s, w) => s + w.poems.length, 0);
  const totalPoems = totalPoemsInPoetWorks + assortedWork.poems.length;

  // Stats report
  console.log("\n=== DRY RUN STATS ===");
  console.log(`Distinct author IDs in persons files:  ${persons.size}`);
  console.log(`Distinct author IDs in meta.csv:       ${new Set(rows.map((r) => r.author_id.split(",")[0]!.trim())).size}`);
  console.log(`Poets with >= 3 poems (individual works): ${poetWorks.length}`);
  console.log(`Poems in individual poet works:           ${totalPoemsInPoetWorks}`);
  console.log(`Poems in assorted collection:             ${assortedWork.poems.length}`);
  console.log(`Total works to be created:                ${totalWorks} (${poetWorks.length} poet + 1 assorted)`);
  console.log(`Total poems (must equal 3762):            ${totalPoems} ${totalPoems === 3762 ? "✓" : "✗ MISMATCH"}`);

  console.log("\nTop 15 poets by poem count:");
  const top15 = [...poetWorks]
    .sort((a, b) => b.poems.length - a.poems.length)
    .slice(0, 15);
  for (const w of top15) {
    console.log(`  ${String(w.poems.length).padStart(3)}  ${w.authorName}  (slug: ${w.slug})`);
  }

  if (DRY_RUN) {
    console.log("\n=== DRY RUN COMPLETE — no files written ===");
    console.log("Re-run with --sample to write the two sample works.");
    console.log("Re-run with --write to write all works (no manifest).");
    console.log("Re-run with --manifest to write all works + upsert manifest.json.");
    return;
  }

  // Find Thomas Gray work
  const grayWork = poetWorks.find((w) =>
    w.authorName.toLowerCase().includes("gray") &&
    w.authorName.toLowerCase().includes("thomas")
  );

  if (SAMPLE_ONLY) {
    // Write sample: Thomas Gray + first 5 chapters of assorted
    if (!grayWork) {
      console.error("Could not find Thomas Gray work — check pers00039 in meta.csv");
      process.exit(1);
    }

    console.log(`\nWriting Thomas Gray sample: ${grayWork.slug}`);
    writeWork(grayWork, false);
    console.log(`  Written ${grayWork.poems.length} chapters`);

    // Assorted: first 5 poems only
    const assortedSample: WorkSpec = {
      ...assortedWork,
      poems: assortedWork.poems.slice(0, 5),
    };
    console.log(`\nWriting assorted sample (5 chapters): ${assortedWork.slug}`);
    writeWork(assortedSample, true);
    console.log("  Written 5 chapters");

    console.log("\n=== SAMPLE WRITE COMPLETE ===");
    console.log(`Thomas Gray: corpus/works/${grayWork.slug}/`);
    console.log(`Assorted (5 ch): corpus/works/${assortedWork.slug}/`);
    return;
  }

  // Full write
  console.log("\nWriting all poet works...");
  let written = 0;
  for (const work of poetWorks) {
    writeWork(work, false);
    written++;
    if (written % 20 === 0) {
      console.log(`  ${written}/${poetWorks.length} poet works written...`);
    }
  }
  console.log(`  ${poetWorks.length} poet works written`);

  console.log("Writing assorted collection...");
  writeWork(assortedWork, true);
  console.log(`  Assorted collection written (${assortedWork.poems.length} chapters)`);

  if (UPDATE_MANIFEST) {
    console.log("\nUpserting manifest.json...");
    upsertManifest(
      [...poetWorks, assortedWork],
      [...poetWorks.map(() => false), true]
    );
  }

  console.log("\n=== INGESTION COMPLETE ===");
  console.log(`Total works written: ${totalWorks}`);
  console.log(`Total poems: ${totalPoems}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
