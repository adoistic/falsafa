#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chapterSlug, slugify, workSlug } from "../lib/slug.ts";

type GretilUnit = {
  ref: string;
  translit: string;
  translation: string;
};

type GretilChapter = {
  id: string;
  title_en?: string;
  title_sa?: string;
  units: GretilUnit[];
};

type GretilWork = {
  name: string;
  title: string;
  author?: string | null;
  transliteration_scheme?: string;
  citation_scheme?: string;
  chapters: GretilChapter[];
  glossary?: Array<{ term: string; gloss: string }>;
};

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

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const INPUT = "/Users/siraj/t2work/gretil-translated";
const SELECTED = new Set([
  "sa_AdizeSa-paramArthasAra",
  "sa_Aryadeva-caryAmelAvaNapradIpa",
  "sa_Aryadeva-cittavizuddhiprakaraNa",
  "sa_IzvarakRSNa-sAMkhyakArikA",
  "sa_SimAnanda-sAMkhyatattvavivecana",
  "sa_abhinavagupta-bodhapaJcadazikA",
  "sa_abhinavagupta-paramArthasAra",
  "sa_abhinavagupta-paryantapaJcAzikA",
  "sa_abhisamayAlaMkAravivaraNa",
  "sa_annaMbhatta-tarkasaMgraha",
  "sa_asaGga-zarIrArthagAthA",
  "sa_brahmabindUpaniSad",
]);

const AUTHORS: Record<string, { birth_year: number | null; death_year: number | null; nationality: string }> = {
  "Ādiśeṣa": { birth_year: null, death_year: null, nationality: "Indian" },
  "Āryadeva": { birth_year: 170, death_year: 270, nationality: "Indian" },
  "Īśvarakṛṣṇa": { birth_year: 350, death_year: 425, nationality: "Indian" },
  "Ṣimānanda": { birth_year: null, death_year: null, nationality: "Indian" },
  "Abhinavagupta": { birth_year: 950, death_year: 1020, nationality: "Kashmiri" },
  "Annaṃbhaṭṭa": { birth_year: 1600, death_year: 1700, nationality: "Indian" },
  "Asaṅga": { birth_year: 300, death_year: 370, nationality: "Indian" },
  "Unknown": { birth_year: null, death_year: null, nationality: "Indian" },
};

const CATALOG: Record<string, { author: string; title: string; note?: string }> = {
  "sa_AdizeSa-paramArthasAra": {
    author: "Ādiśeṣa",
    title: "Paramārthasāra",
    note: "The source attributes the work to Ādiśeṣa, also identified as Śeṣa or Anantanāga.",
  },
  "sa_Aryadeva-caryAmelAvaNapradIpa": {
    author: "Āryadeva",
    title: "Caryāmelāpakapradīpa",
    note: "The source identifies this as the tantric Āryadeva of the Ārya school of the Guhyasamāja, not the early Madhyamaka Āryadeva of the Catuḥśataka.",
  },
  "sa_Aryadeva-cittavizuddhiprakaraNa": {
    author: "Āryadeva",
    title: "Cittaviśuddhiprakaraṇa",
    note: "The source identifies this as the tantric Āryadeva or Āryadevapāda, not the Madhyamaka author of the Catuḥśataka.",
  },
  "sa_SimAnanda-sAMkhyatattvavivecana": {
    author: "Ṣimānanda",
    title: "Sāṃkhyatattvavivecana",
    note: "The source identifies Ṣimānanda as Simānandadīkṣita, a Kānyakubja brāhmaṇa and son of Raghunandana of Iṣṭikāpura.",
  },
  "sa_abhisamayAlaMkAravivaraNa": {
    author: "Anonymous",
    title: "Abhisamayālaṅkāravivaraṇa",
    note: "A Tibetan-tradition padārtha digest of Maitreya's Abhisamayālaṅkāra, quoting the root kārikās, Haribhadra's Ālokā, and the Mahāyānasūtrālaṅkāra; edited by Ram Shankar Tripathi in 1977.",
  },
  "sa_brahmabindUpaniSad": {
    author: "Unknown",
    title: "Brahmabindūpaniṣad",
    note: "An Atharvaveda Upaniṣad; source edition by Rāmamaya Tarkaratna, 1872.",
  },
};

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf-8");
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

function simpleHash(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function paragraphSidecar(content: string): Array<{ id: string; offset: number; text: string }> {
  const parts = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: Array<{ id: string; offset: number; text: string }> = [];
  let offset = 0;
  for (const text of parts) {
    out.push({ id: `p-${simpleHash(text).slice(0, 6)}`, offset, text });
    offset += text.length + 2;
  }
  return out;
}

function wordCount(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

function readableTerms(text: string): string {
  return text.replace(/\{\{term:([^|}]+)\|([^}]+)\}\}/g, (_m, term, gloss) => `${term} (${gloss})`);
}

function chapterBody(chapter: GretilChapter, field: "translit" | "translation"): string {
  return chapter.units
    .map((unit) => {
      const text = field === "translation" ? readableTerms(unit.translation) : unit.translit;
      return `**${unit.ref}**\n\n${text.trim()}`;
    })
    .join("\n\n");
}

function addToGroup(group: Record<string, { name: string; works: string[] }>, key: string, name: string, slug: string): void {
  const existing = group[key] ?? { name, works: [] };
  if (!existing.works.includes(slug)) existing.works.push(slug);
  group[key] = existing;
}

function removeExistingGretil(manifest: Manifest): Set<string> {
  const removed = new Set<string>();
  manifest.works = manifest.works.filter((work) => {
    const role = work.thothica_role;
    const keep = role !== "gretil-root";
    if (!keep) removed.add(work.slug);
    return keep;
  });
  for (const group of [manifest.authors, manifest.eras, manifest.genres, manifest.languages]) {
    for (const value of Object.values(group)) {
      value.works = value.works.filter((slug) => !removed.has(slug));
    }
    for (const [key, value] of Object.entries(group)) {
      if (value.works.length === 0) delete group[key];
    }
  }
  return removed;
}

function main(): void {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const removed = removeExistingGretil(manifest);
  for (const slug of removed) rmSync(join(CORPUS, "works", slug), { recursive: true, force: true });

  const written: string[] = [];
  for (const name of [...SELECTED].sort()) {
    const inputPath = join(INPUT, `${name}.json`);
    if (!existsSync(inputPath)) throw new Error(`Missing completed translation: ${inputPath}`);
    const work = JSON.parse(readFileSync(inputPath, "utf-8")) as GretilWork;
    const catalog = CATALOG[work.name];
    const authorName = catalog?.author ?? work.author ?? "Unknown";
    const title = catalog?.title ?? work.title;
    const workId = deterministicUuid(`gretil:${work.name}`);
    const slug = workSlug(authorName, title, workId);
    const workDir = join(CORPUS, "works", slug);
    rmSync(workDir, { recursive: true, force: true });
    ensureDir(workDir);

    const authorMeta = AUTHORS[authorName] ?? AUTHORS.Unknown;
    const logicalChapters: Array<{ chapter_number: number; chapter_slug: string; chapter_title: string; variant_count: number }> = [];

    for (let i = 0; i < work.chapters.length; i++) {
      const chapter = work.chapters[i]!;
      const chapterNumber = i + 1;
      const chapterTitle = chapter.title_en || chapter.title_sa || `Chapter ${chapter.id || chapterNumber}`;
      const cSlug = chapterSlug(chapterNumber, chapterTitle, false);
      const chapterDir = join(workDir, "chapters", cSlug);
      const translitBody = chapterBody(chapter, "translit");
      const translationBody = chapterBody(chapter, "translation");
      const translitWords = wordCount(translitBody);
      const translationWords = wordCount(translationBody);
      const translitId = deterministicUuid(`${workId}:${chapter.id}:transliteration`);
      const translationId = deterministicUuid(`${workId}:${chapter.id}:translation`);

      writeFile(
        join(chapterDir, "transliteration.md"),
        `${frontmatter({
          work_id: workId,
          work_slug: slug,
          work_title: title,
          author_name: authorName,
          chapter_number: chapterNumber,
          chapter_title: chapterTitle,
          chapter_slug: cSlug,
          variant_id: translitId,
          content_type: "transliteration",
          layout: "prose",
          language: "Sanskrit",
          source_language: "Sanskrit",
          language_direction: "ltr",
          script: work.transliteration_scheme ?? "latin",
          word_count: translitWords,
          source_url: null,
          transliterator: "thothica",
        })}\n\n${translitBody}\n`,
      );
      writeFile(join(chapterDir, "transliteration.paragraphs.json"), JSON.stringify(paragraphSidecar(translitBody), null, 2));

      writeFile(
        join(chapterDir, "translation.md"),
        `${frontmatter({
          work_id: workId,
          work_slug: slug,
          work_title: title,
          author_name: authorName,
          chapter_number: chapterNumber,
          chapter_title: chapterTitle,
          chapter_slug: cSlug,
          variant_id: translationId,
          content_type: "translation",
          layout: "prose",
          language: "english",
          source_language: "Sanskrit",
          language_direction: "ltr",
          script: "latin",
          word_count: translationWords,
          source_url: null,
          translator: "thothica",
        })}\n\n${translationBody}\n`,
      );
      writeFile(join(chapterDir, "translation.paragraphs.json"), JSON.stringify(paragraphSidecar(translationBody), null, 2));

      writeFile(
        join(chapterDir, "meta.json"),
        JSON.stringify({
          work_slug: slug,
          work_title: title,
          chapter_number: chapterNumber,
          chapter_title: chapterTitle,
          chapter_slug: cSlug,
          layout: "prose",
          layouts_in_variants: ["prose"],
          default_variant: "translation.md",
          variants: [
            {
              file: "transliteration.md",
              content_type: "transliteration",
              variant_id: translitId,
              language: "Sanskrit",
              source_language: "Sanskrit",
              script: work.transliteration_scheme ?? "latin",
              word_count: translitWords,
              paragraph_count: chapter.units.length,
              has_image: false,
              source_url: null,
            },
            {
              file: "translation.md",
              content_type: "translation",
              variant_id: translationId,
              language: "english",
              source_language: "Sanskrit",
              script: "latin",
              word_count: translationWords,
              paragraph_count: chapter.units.length,
              has_image: false,
              source_url: null,
            },
          ],
        }, null, 2),
      );

      logicalChapters.push({
        chapter_number: chapterNumber,
        chapter_slug: cSlug,
        chapter_title: chapterTitle,
        variant_count: 2,
      });
    }

    if (work.glossary?.length) {
      writeFile(join(workDir, "glossary.json"), JSON.stringify(work.glossary, null, 2));
    }

    const description = `${title}, a Sanskrit philosophical text by ${authorName}, with transliteration and Thothica's English translation from the GRETIL source text.${catalog?.note ? ` ${catalog.note}` : ""}`;
    writeFile(
      join(workDir, "index.md"),
      `${frontmatter({
        id: workId,
        slug,
        title,
        author: {
          name: authorName,
          biography: null,
          birth_year: authorMeta?.birth_year ?? null,
          death_year: authorMeta?.death_year ?? null,
          nationality: authorMeta?.nationality ?? "Indian",
        },
        era: "Medieval",
        genre: "Philosophy",
        language: "Sanskrit",
        language_direction: "ltr",
        description,
        difficulty: "Advanced",
        total_logical_chapters: logicalChapters.length,
        total_variant_entries: logicalChapters.length * 2,
        thothica_role: "gretil-root",
      })}\n\n# ${title}\n\n${description}\n\nCitation scheme: ${work.citation_scheme ?? "GRETIL reference identifiers"}.\n\n## Chapters\n\n${logicalChapters
        .map((chapter) => `${String(chapter.chapter_number).padStart(2, "0")}. [${chapter.chapter_title}](./chapters/${chapter.chapter_slug}/) — prose, ${chapter.variant_count} variants`)
        .join("\n")}\n`,
    );

    const authorSlug = slugify(authorName);
    const eraSlug = slugify("Medieval");
    const genreSlug = slugify("Philosophy");
    const languageSlug = slugify("Sanskrit");
    manifest.works.push({
      slug,
      title,
      author: authorName,
      author_slug: authorSlug,
      era: "Medieval",
      era_slug: eraSlug,
      genre: "Philosophy",
      genre_slug: genreSlug,
      language: "Sanskrit",
      language_slug: languageSlug,
      language_direction: "ltr",
      total_logical_chapters: logicalChapters.length,
      total_variant_entries: logicalChapters.length * 2,
      published_year: null,
      difficulty: "Advanced",
      description,
      thothica_role: "gretil-root",
    });
    addToGroup(manifest.authors, authorSlug, authorName, slug);
    addToGroup(manifest.eras, eraSlug, "Medieval", slug);
    addToGroup(manifest.genres, genreSlug, "Philosophy", slug);
    addToGroup(manifest.languages, languageSlug, "Sanskrit", slug);
    written.push(slug);
  }

  manifest.generated_at = new Date().toISOString();
  manifest.counts = {
    works: manifest.works.length,
    authors: Object.keys(manifest.authors).length,
    eras: Object.keys(manifest.eras).length,
    genres: Object.keys(manifest.genres).length,
    languages: Object.keys(manifest.languages).length,
  };
  writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Integrated ${written.length} complete GRETIL root works.`);
  for (const slug of written) console.log(`- ${slug}`);
}

main();
